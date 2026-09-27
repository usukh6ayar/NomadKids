import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AuditRepository } from "../../audit/audit.repository";
import { TenantAccessService } from "../../authz/tenant-access.service";
import type { Actor } from "../../authz/actor";
import { EsisRepository } from "./esis.repository";
import {
  EsisGroupSyncRepository,
  type EsisGroupInput,
  type EsisYearInput,
} from "./esis-group-sync.repository";
import { AGE_BAND_BY_LEVEL, esisDate } from "./esis-roster.shared";
import { EsisService } from "./esis.service";

export interface GroupSyncOutcome {
  schoolYears: { created: number; updated: number };
  groups: { created: number; updated: number };
  warnings: string[];
  syncedAt: string;
}

/**
 * The «ESIS татах» button on «Анги, бүлэг» — 2026-09-28, the client: school
 * years and groups come from ESIS in one press, and «Хичээлийн жил» and
 * «Улирал» leave the menu.
 *
 * ★ **Years first, then groups.** Every ESIS group names the `academicYear`
 * it belongs to, and a group can only be filed under a year that exists here.
 * `academicYearStatuses` is ESIS's own list of them, so the years are read
 * from it rather than invented from whatever the groups happen to mention.
 *
 * ★★ **Terms are not synced.** ESIS has no service for them; a term stays a
 * thing the kindergarten defines.
 *
 * ★★★ Children are not touched. `POST …/esis/roster-import` is the button
 * that moves people; this one moves the structure they are filed under, and
 * keeping them apart means pressing this can never enrol or re-enrol a child.
 */
@Injectable()
export class EsisGroupSyncService {
  constructor(
    private readonly tenants: TenantAccessService,
    private readonly esisRepo: EsisRepository,
    private readonly repo: EsisGroupSyncRepository,
    private readonly esis: EsisService,
    private readonly audit: AuditRepository,
  ) {}

  async syncGroups(actor: Actor, kindergartenId: string): Promise<GroupSyncOutcome> {
    this.tenants.assertAdmin(actor, kindergartenId);

    const kindergarten = await this.esisRepo.findKindergarten(kindergartenId);
    if (!kindergarten || !kindergarten.esisInstitutionId) throw new NotFoundException();

    if (!this.esis.isConfigured) {
      throw new ServiceUnavailableException(
        "ESIS холболт тохируулагдаагүй байна. Платформын оператор байгууллагын кодыг холбосны дараа ажиллана.",
      );
    }

    const institutionId = kindergarten.esisInstitutionId;

    // One `EsisResource` row per read, before it — see `importRoster`.
    for (const resource of ["academicYearStatuses", "groups"] as const) {
      await this.audit.append({
        action: "VIEW",
        kindergartenId,
        actorUserId: actor.userId,
        objectType: "EsisResource",
        objectId: resource,
        metadata: { purpose: "group-sync" },
      });
    }

    /*
     * ★ Both reads before the transaction opens. An ESIS call inside it would
     * hold a Postgres connection for as long as the ministry takes to answer,
     * and an ESIS failure here writes nothing at all — the whole-or-nothing
     * the client asked for.
     */
    const [yearResponse, groupResponse] = await Promise.all([
      this.esis.read("academicYearStatuses", {}, institutionId),
      this.esis.read("groups", {}, institutionId),
    ]);

    const warnings: string[] = [];
    const years: EsisYearInput[] = [];
    for (const raw of yearResponse.data as Record<string, unknown>[]) {
      const year = parseYear(raw);
      if (year) years.push(year);
      else
        warnings.push(`ESIS-ийн хичээлийн жил «${String(raw.academicYear ?? "?")}» уншигдсангүй.`);
    }

    const groups: EsisGroupInput[] = [];
    for (const raw of groupResponse.data as Record<string, unknown>[]) {
      const name = String(raw.studentGroupName ?? "").trim();
      const esisGroupId = String(raw.studentGroupId ?? "");
      const ageBand = AGE_BAND_BY_LEVEL[String(raw.academicLevel ?? "")];
      const academicYear = String(raw.academicYear ?? "").trim();
      /*
       * ★ A level with no band here is skipped and named, as the roster
       * import does: `Group.ageBand` is required and guessing one files
       * somebody's children under the wrong programme.
       */
      if (!esisGroupId || !name || !ageBand || !academicYear) {
        warnings.push(`«${name || esisGroupId || "?"}» бүлгийн мэдээлэл дутуу тул алгасав.`);
        continue;
      }
      groups.push({ esisGroupId, name, ageBand, academicYear });
    }

    const counts = await this.repo.sync(kindergartenId, years, groups);
    const outcome: GroupSyncOutcome = {
      schoolYears: counts.schoolYears,
      groups: counts.groups,
      warnings: [...warnings, ...counts.warnings],
      syncedAt: new Date().toISOString(),
    };

    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisGroupSync",
      objectId: kindergartenId,
      metadata: {
        schoolYears: outcome.schoolYears,
        groups: outcome.groups,
        warnings: outcome.warnings.length,
      },
    });

    return outcome;
  }
}

/**
 * One `academicYearStatuses` row → the year this product keeps.
 *
 * Live 42778, 2026-09-28:
 *
 *     {"academicYear":"2026","currentAcademicYearFlag":"Y",
 *      "openDate":"2026-04-01","closedDate":"2027-07-31","academicYearStatus":"ACTIVE"}
 *
 * ★ The name is "2026-2027", the form every year typed here already uses, so
 * a hand-made year is found by name before any date is compared.
 */
function parseYear(raw: Record<string, unknown>): EsisYearInput | null {
  const academicYear = String(raw.academicYear ?? "").trim();
  const opens = Number(academicYear);
  const startsOn = esisDate(raw.openDate);
  const endsOn = esisDate(raw.closedDate);
  if (!/^\d{4}$/.test(academicYear) || !startsOn || !endsOn || endsOn <= startsOn) return null;

  return {
    academicYear,
    name: `${opens}-${opens + 1}`,
    startsOn,
    endsOn,
    isCurrent: String(raw.currentAcademicYearFlag ?? "").toUpperCase() === "Y",
  };
}
