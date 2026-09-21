import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuditRepository } from "../../audit/audit.repository";
import { TenantAccessService } from "../../authz/tenant-access.service";
import type { Actor } from "../../authz/actor";
import type { AgeBand } from "../../domain/enums";
import { EsisRepository } from "./esis.repository";
import { EsisRosterImportRepository } from "./esis-roster-import.repository";
import { EsisService } from "./esis.service";

/**
 * ESIS's own level code → the age band this product files a group under.
 *
 * ★ **By the numeric code, not the name.** `academicLevelName` is Mongolian
 * free-ish text the ministry may reword; the code is the key. Verified live
 * against institution 42778 on 2026-09-20 — it returns exactly these four and
 * nothing else:
 *
 *     17=Ахлах  15=Бага  16=Дунд  18=Бэлтгэл
 *
 * ★★ The band names and the level names are **off by one**, and that is not a
 * mistake to "fix": ESIS's Бага is this product's NURSERY, its Дунд is JUNIOR,
 * and so on up. `seed-esis.ts` carries the same table with the same comment;
 * changing one without the other would silently refile every group.
 */
const AGE_BAND_BY_LEVEL: Record<string, AgeBand> = {
  "15": "NURSERY",
  "16": "JUNIOR",
  "17": "MIDDLE",
  "18": "SENIOR",
};

export interface RosterImportOutcome {
  groups: { created: number; updated: number; skipped: string[] };
  children: { created: number; updated: number };
  enrollments: { created: number; moved: number; unplaced: string[] };
}

/**
 * Pulls a kindergarten's groups and children out of ESIS and into this
 * database — 2026-09-20, the client: "esis ees shuud buleg bolon buleg dotorh
 * huuhduud ni irehgui ymuu? tged irwel shuud hadgalchmaar baina."
 *
 * ★ **Why this exists at all.** ESIS's groups and students were already on
 * screen — `/admin/groups` and `/children` both draw them — but only as a
 * panel to read. Nothing crossed into `Group` / `Child` / `Enrollment`, so a
 * director who could *see* their ninety-three children still had to type each
 * one in before a single observation could be written. The panels said the
 * data was there; the product behaved as though it were not.
 *
 * ★★ **Add and update, never remove.** A group or a child that ESIS has
 * stopped listing is left exactly as it is. The reasons are in
 * `EsisRosterImportRepository`'s doc comment; the rule is absolute, and it is
 * what makes a second press of the button safe.
 *
 * ★★★ **Idempotent by two stable keys.** Groups match on `esisGroupId` and
 * fall back to name-within-the-year; children match on `esisPersonId`, which
 * `@@unique([kindergartenId, esisPersonId])` guarantees is one row. Running
 * this twice changes nothing the first run did not — which matters because the
 * client asked for no preview step, so repeatability is the only safety
 * property the feature has.
 *
 * ★★★★ **Synchronous, like `refreshStaffRosterCore`.** Two ESIS reads and a
 * few hundred small writes; a director presses the button and is told what
 * happened. Putting it on BullMQ (§6) would buy nothing and cost the answer.
 */
@Injectable()
export class EsisRosterImportService {
  constructor(
    private readonly tenants: TenantAccessService,
    private readonly esisRepo: EsisRepository,
    private readonly repo: EsisRosterImportRepository,
    private readonly esis: EsisService,
    private readonly audit: AuditRepository,
  ) {}

  async importRoster(actor: Actor, kindergartenId: string): Promise<RosterImportOutcome> {
    this.tenants.assertAdmin(actor, kindergartenId);

    const kindergarten = await this.esisRepo.findKindergarten(kindergartenId);
    if (!kindergarten || !kindergarten.esisInstitutionId) throw new NotFoundException();

    if (!this.esis.isConfigured) {
      throw new ServiceUnavailableException(
        "ESIS холболт тохируулагдаагүй байна. Платформын оператор байгууллагын кодыг холбосны дараа ажиллана.",
      );
    }

    /*
     * ★ A school year first, and a refusal rather than one invented.
     *
     * Every group and every enrolment this writes belongs to a year, and which
     * year is a decision about the kindergarten's calendar — not something an
     * import should guess from ESIS's `academicYear`. The message names the
     * screen that fixes it, because "no current school year" is not a sentence
     * a director should have to translate into an action.
     */
    const year = await this.repo.findCurrentSchoolYear(kindergartenId);
    if (!year) {
      throw new ConflictException(
        "Одоогийн хичээлийн жил тохируулаагүй байна. «Хичээлийн жил» хэсэгт жил үүсгэж, идэвхтэй болгоно уу.",
      );
    }

    const institutionId = kindergarten.esisInstitutionId;
    const [groupResponse, studentResponse] = await Promise.all([
      this.esis.read("groups", {}, institutionId),
      this.esis.read("students", {}, institutionId),
    ]);

    const outcome: RosterImportOutcome = {
      groups: { created: 0, updated: 0, skipped: [] },
      children: { created: 0, updated: 0 },
      enrollments: { created: 0, moved: 0, unplaced: [] },
    };

    /** ESIS's group id → ours. Built as the groups are written, used below. */
    const groupIdByEsisId = new Map<string, string>();

    for (const raw of groupResponse.data as Record<string, unknown>[]) {
      const esisGroupId = String(raw.studentGroupId ?? "");
      const name = String(raw.studentGroupName ?? "").trim();
      const ageBand = AGE_BAND_BY_LEVEL[String(raw.academicLevel ?? "")];

      /*
       * ★ A level this product has no band for is **skipped and named**, not
       * guessed at. `Group.ageBand` is required, so importing one would mean
       * inventing an age band for somebody else's children; the director gets
       * the group's name back and can create it by hand in one step. Live 42778
       * returns only the four mapped levels, so this is a guard against the
       * ministry adding a fifth rather than a case seen in practice.
       */
      if (!esisGroupId || !name || !ageBand) {
        if (name) outcome.groups.skipped.push(name);
        continue;
      }

      const byEsisId = await this.repo.findGroupByEsisId(kindergartenId, esisGroupId);
      if (byEsisId) {
        if (byEsisId.name !== name || byEsisId.ageBand !== ageBand) {
          await this.repo.updateGroup(byEsisId.id, { name, ageBand });
          outcome.groups.updated += 1;
        }
        groupIdByEsisId.set(esisGroupId, byEsisId.id);
        continue;
      }

      /*
       * ★★ Adoption before creation. A group the director typed by hand before
       * the first import carries the same name ESIS uses, and
       * `@@unique([schoolYearId, name])` would refuse a second one anyway — so
       * the choice is between adopting it and failing the whole import on a
       * constraint. Adopting also means the children already enrolled in it
       * stay where they are.
       */
      const byName = await this.repo.findGroupByName(year.id, name);
      if (byName) {
        await this.repo.updateGroup(byName.id, { ageBand, esisGroupId });
        outcome.groups.updated += 1;
        groupIdByEsisId.set(esisGroupId, byName.id);
        continue;
      }

      const created = await this.repo.createGroup({
        kindergartenId,
        schoolYearId: year.id,
        name,
        ageBand,
        esisGroupId,
      });
      outcome.groups.created += 1;
      groupIdByEsisId.set(esisGroupId, created.id);
    }

    for (const raw of studentResponse.data as Record<string, unknown>[]) {
      const esisPersonId = String(raw.personId ?? "");
      const dateOfBirth = esisDate(raw.dateOfBirth);
      if (!esisPersonId || !dateOfBirth) continue;

      const fields = {
        lastName: String(raw.lastName ?? "").trim(),
        firstName: String(raw.firstName ?? "").trim(),
        sex: String(raw.genderCode ?? "") === "F" ? ("FEMALE" as const) : ("MALE" as const),
        dateOfBirth,
      };

      const existing = await this.repo.findChildByEsisPersonId(kindergartenId, esisPersonId);
      let childId: string;
      if (existing) {
        await this.repo.updateChild(existing.id, fields);
        outcome.children.updated += 1;
        childId = existing.id;
      } else {
        const created = await this.repo.createChild({
          kindergartenId,
          esisPersonId,
          ...fields,
        });
        outcome.children.created += 1;
        childId = created.id;
      }

      const groupId = groupIdByEsisId.get(String(raw.studentGroupId ?? ""));
      if (!groupId) {
        /*
         * ★ A child ESIS places in a group this import skipped. They exist
         * here now — which is the point, they can be found and edited — but
         * nothing pretends to know which group they belong to.
         */
        outcome.enrollments.unplaced.push(`${fields.lastName} ${fields.firstName}`.trim());
        continue;
      }

      const enrollment = await this.repo.findActiveEnrollment(childId, year.id);
      if (!enrollment) {
        /*
         * ★★ `startedOn` is ESIS's own `actionDate` where it sends one — the
         * day the enrolment was recorded there, even when that predates the
         * school year's start; several of 42778's were entered in May. The
         * year's start is the fallback, not the default: clamping a real date
         * to it would invent a fact.
         *
         * ★★★ This row is what authorization reads, not `Child.kindergartenId`
         * (§1.2). A child imported without one falls through to the single
         * documented fallback, which exists for a child somebody just
         * registered by hand — not for ninety-three arriving at once.
         */
        await this.repo.createEnrollment({
          kindergartenId,
          childId,
          groupId,
          schoolYearId: year.id,
          startedOn: esisDate(raw.actionDate) ?? year.startsOn,
        });
        outcome.enrollments.created += 1;
      } else if (enrollment.groupId !== groupId) {
        await this.repo.moveEnrollment(enrollment.id, groupId);
        outcome.enrollments.moved += 1;
      }
    }

    /*
     * ★ Counts, and the names of what could not be placed. No register
     * numbers, no person ids, no dates of birth — the same rule
     * `refreshStaffRosterCore` states for its own audit row: say what happened
     * without saying it about somebody.
     *
     * The skipped and unplaced names are here because they are the half of
     * this operation a director has to act on, and an audit row that recorded
     * only "93 children" would not say which two nobody can find.
     */
    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisRosterImport",
      objectId: kindergartenId,
      metadata: {
        schoolYear: year.name,
        groups: outcome.groups,
        children: outcome.children,
        enrollments: {
          created: outcome.enrollments.created,
          moved: outcome.enrollments.moved,
          unplaced: outcome.enrollments.unplaced.length,
        },
      },
    });

    return outcome;
  }
}

/**
 * ESIS's date strings → a `Date`, or null.
 *
 * ★ Null rather than `new Date("")`, which is `Invalid Date` and reaches
 * Postgres as an error a hundred rows later, naming neither the row nor the
 * field. A child with no readable birth date is skipped where they are read.
 */
function esisDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value.slice(0, 10));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
