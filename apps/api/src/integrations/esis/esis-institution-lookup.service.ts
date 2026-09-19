import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { EsisInstitutionLookup } from "@kinder/contracts";
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
 */
@Injectable()
export class EsisInstitutionLookupService {
  constructor(
    private readonly esis: EsisService,
    private readonly repo: EsisRepository,
  ) {}

  async lookup(institutionId: string): Promise<EsisInstitutionLookup> {
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
    const [organizationResponse, staffResponse] = await Promise.all([
      this.esis.read("organization", {}, institutionId),
      this.esis.read("staff", {}, institutionId),
    ]);

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
