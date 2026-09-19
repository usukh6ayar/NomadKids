import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { EsisInstitutionLookup } from "@kinder/contracts";
import type { Actor } from "../../authz/actor";
import { PlatformAccessService } from "../../authz/platform-access.service";
import { EsisError } from "./esis.client";
import { EsisRepository } from "./esis.repository";
import { EsisService } from "./esis.service";
import { normalizeRegisterNumber, roleForJobCode } from "./esis.roster";

/**
 * Everything the create-a-kindergarten screen needs about an institution,
 * before any kindergarten exists to scope the question to.
 *
 * ★ Both reads go through `EsisService.read`, so they inherit the catalogue's
 * path, its response schema, its logging and its error classification. A
 * hand-written `fetch` here would reach the ministry and bypass all four.
 *
 * ★★ The staff projection is a **whitelist**. `school/staff` carries
 * `microsoftEmailPass` and `googleEmailPass` — real passwords — and naming the
 * seven fields that may leave cannot be got wrong the way removing the two
 * that may not can.
 *
 * ★★★ **`lookup` asserts for itself, even though `@SuperAdmin()` sits on
 * `PlatformEsisInstitutionController`.** That decorator is a coarse filter in
 * front of the decision, never the decision — its own docblock says so, and
 * every sibling here does both (`EsisAdminService.overview`,
 * `.updateMapping`). It is not redundant and must not be deleted as such:
 * there is already a **second** caller with no controller of its own,
 * `PlatformService.create`, which reaches this service to check an institution
 * while registering a kindergarten. A guard on one route protects nothing the
 * other route goes around. CLAUDE.md §1.1, docs/SECURITY.md §4.
 */
@Injectable()
export class EsisInstitutionLookupService {
  constructor(
    private readonly esis: EsisService,
    private readonly repo: EsisRepository,
    private readonly platform: PlatformAccessService,
  ) {}

  /**
   * ★ `assertSuperAdmin` is the **first** statement, ahead of the
   * `isConfigured` 503. A caller who may not ask must not learn whether this
   * deployment has an ESIS token — the state of the deployment is an answer,
   * and 404 has to come first for it to stay unreadable. CLAUDE.md §1.7.
   */
  async lookup(actor: Actor, institutionId: string): Promise<EsisInstitutionLookup> {
    this.platform.assertSuperAdmin(actor);

    if (!this.esis.isConfigured) {
      throw new ServiceUnavailableException("ESIS холболт тохируулагдаагүй байна.");
    }

    /*
     * ★ `this.esis.read("organization"/"staff", …)` rather than the
     * `organization()` / `staff()` wrappers, for the reason
     * `refreshStaffRosterCore` gives: a test that mocks `EsisService` as an
     * object literal reaches the generic `read` and never the wrappers, which
     * are separate functions on the real class.
     */
    const [organizationResponse, staffResponse] = await this.readBoth(institutionId);

    const row = (organizationResponse.data as unknown as Record<string, unknown>[])[0];
    // An institution the ministry does not have answers 200 with no rows.
    if (!row) throw new NotFoundException("Ийм institutionId олдсонгүй.");

    const existing = await this.repo.findKindergartenByInstitutionId(institutionId);
    const classification = (row.institutionClassificationName as string | null) ?? null;

    return {
      institutionId: String(row.institutionId ?? institutionId),
      name: String(row.institutionName ?? ""),
      longName: String(row.longName ?? row.institutionName ?? ""),
      address: (row.institutionAddress as string | null) ?? null,
      classification,
      propertyType: (row.propertyTypeName as string | null) ?? null,
      isKindergarten: classification === "Цэцэрлэг",
      alreadyUsed: existing !== null,
      staff: this.projectStaff(staffResponse.data as unknown as Record<string, unknown>[]),
    };
  }

  /**
   * The two reads, and nothing else, inside the translation.
   *
   * ★ Deliberately narrower than the whole method. The `NotFoundException` for
   * an empty `RESULT` is thrown *after* these resolve; a method-wide catch
   * would see it too, and one `instanceof` slip would turn a working 404 into
   * a 502.
   */
  private async readBoth(institutionId: string) {
    try {
      return await Promise.all([
        this.esis.read("organization", {}, institutionId),
        this.esis.read("staff", {}, institutionId),
      ]);
    } catch (error) {
      throw this.translate(error);
    }
  }

  /**
   * What the operator is told when the ministry does not answer.
   *
   * ★ **A ministry refusal becomes 409, not the 403 ESIS sent.**
   *
   * An institution this company account has not been granted answers HTTP 403
   * «Таны компанид энэ institutionId дээр эрх байхгүй байна.» (measured
   * 2026-09-14 against ids 40284 and 42779). That is a fact about the
   * *ministry's grant*, not about this actor's authorization — the caller is a
   * superadmin and has already passed `@SuperAdmin()`. Forwarding the 403
   * would give the one status this product reserves a second meaning:
   * CLAUDE.md §1.7 makes 404 the answer for "you may not reach this", and 403
   * is kept out of the vocabulary precisely so that it can never be read as
   * one. 409 says what is true — the request is well formed and the state of
   * the world refuses it — and the message says who can change that state.
   *
   * ★★ A timeout or a dead connection is 502: the operator's own request was
   * fine and the thing it needs did not answer, which is a different next move
   * from "ask the ministry for the grant". `code` keeps the two apart for a
   * log while `detail` reads as one sentence either way.
   *
   * ★★★ Every other kind falls through unchanged, to the filter's 500. A 401
   * on the deployment's own token or an unreadable body is not a case anybody
   * designed a sentence for, and inventing a status would claim an
   * understanding this product does not have.
   */
  private translate(error: unknown): unknown {
    if (!(error instanceof EsisError)) return error;

    if (error.kind === "http" && error.detail.status === 403) {
      return new ConflictException({
        message: "Яам энэ институцид эрх олгоогүй байна. Гэрээний дараа яамнаас нэмүүлнэ үү.",
        code: "SCOPE_DENIED",
      });
    }

    if (error.kind === "timeout" || error.kind === "network") {
      return new BadGatewayException({
        message: "ESIS хариу өгсөнгүй.",
        code: error.kind.toUpperCase(),
      });
    }

    return error;
  }

  /**
   * ★ A row with no register number is dropped rather than shown. The register
   * number is how a member of staff proves who they are at self-registration,
   * so a row without one is a person this screen cannot make an account for —
   * the same reason `refreshStaffRosterCore` counts it as `skipped`.
   */
  private projectStaff(rows: Record<string, unknown>[]): EsisInstitutionLookup["staff"] {
    const projected: EsisInstitutionLookup["staff"] = [];
    for (const raw of rows) {
      const registerNumber = normalizeRegisterNumber(raw.personRegNumber as string | null);
      if (!registerNumber) continue;
      const jobCode = (raw.jobCode as string | null | undefined) ?? null;
      projected.push({
        personId: String(raw.personId),
        registerNumber,
        lastName: String(raw.lastName ?? ""),
        firstName: String(raw.firstName ?? ""),
        positionName: (raw.positionName as string | null | undefined) ?? null,
        jobCode,
        suggestedRole: roleForJobCode(jobCode),
      });
    }
    return projected;
  }
}
