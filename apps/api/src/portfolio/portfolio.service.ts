import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ageInYears, birthFacts } from "@kinder/contracts";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { PortfolioRepository } from "./portfolio.repository";
import { rejectedAgeProfileFields } from "./portfolio-fields";
import type { UpdateAboutMeDto, UpdateAgeProfileDto, UpdateBirthdayNoteDto } from "./portfolio.dto";

/**
 * The child's portfolio: "Миний тухай", ages 2–5, birthday notes.
 *
 * ★ Every method authorizes with `assertCanAccess`, **not** `assertCanRecord`.
 *
 * That is the verified reference behaviour: the portfolio is a family record
 * that guardians contribute to, and the reference system's `save_about_me`,
 * `save_age_profile` and `save_birthday_note` all gate on read access. Using
 * the stricter check that governs observations and assessments would silently
 * make every parent read-only and remove a feature the client already has.
 *
 * The one narrowing that survives is field-level, in `updateAgeProfile`.
 */
@Injectable()
export class PortfolioService {
  constructor(
    private readonly repo: PortfolioRepository,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The overview — "what is in this child's portfolio?"
   *
   * Presence and counts, not content. Opening a section fetches that section.
   * Returning everything here is how an overview becomes a dashboard.
   */
  async getOverview(actor: Actor, childId: string) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    const data = await this.repo.loadOverview(childId);
    if (!data.child) throw new NotFoundException();

    const filledAges = new Set(data.ageProfiles.map((p) => p.age));

    return {
      child: data.child,
      sections: {
        aboutMe: {
          filled: data.aboutMe !== null,
          updatedAt: data.aboutMe?.updatedAt ?? null,
        },
        ages: [2, 3, 4, 5].map((age) => ({
          age,
          filled: filledAges.has(age),
          updatedAt: data.ageProfiles.find((p) => p.age === age)?.updatedAt ?? null,
        })),
        birthdays: data.birthdayNotes.map((n) => ({ age: n.age, hasNote: Boolean(n.note) })),
        photos: { count: data.photoCount },
      },
      // Lets the UI show the parent's own note field rather than the teacher's,
      // without a second request or a guess based on role.
      viewerIsGuardian: isGuardianOf(actor, facts),
    };
  }

  // ── About Me ──────────────────────────────────────────────────────────────

  /**
   * "Миний тухай", or an empty shape when it has never been saved.
   *
   * Returning `null` would send an empty HTTP body, which is ambiguous — the
   * client cannot tell "not filled in yet" from a failed response, and a form
   * binding to `res.aboutMe.dream` crashes rather than rendering blank. A row
   * that does not exist yet is a portfolio section nobody has written, which is
   * a normal state, so it gets a normal shape.
   */
  async getAboutMe(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    const aboutMe = await this.repo.findAboutMe(childId);

    return (
      aboutMe ?? {
        childId,
        exists: false,
        introduction: null,
        nameMeaning: null,
        memorableSayings: null,
        dream: null,
        distinguishingTraits: null,
        heightCm: null,
        weightKg: null,
        recordedOn: null,
      }
    );
  }

  async updateAboutMe(actor: Actor, childId: string, dto: UpdateAboutMeDto) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);

    // Undefined keys mean "unchanged"; a Zod-parsed body would otherwise write
    // nulls over every field the form did not include.
    const data = definedOnly(dto);

    const saved = await this.repo.upsertAboutMe(childId, facts.childKindergartenId, data);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "ChildProfile",
      objectId: saved.id,
      childId,
      metadata: { fields: Object.keys(data) },
    });

    return saved;
  }

  // ── Age profiles ──────────────────────────────────────────────────────────

  async listAgeProfiles(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    return this.repo.listAgeProfiles(childId);
  }

  /** Same reasoning as `getAboutMe`: an unwritten age is a normal state. */
  async getAgeProfile(actor: Actor, childId: string, age: number) {
    await this.childAccess.assertCanAccess(actor, childId);
    const profile = await this.repo.findAgeProfile(childId, age);

    return profile ?? { childId, age, exists: false, schoolYear: null };
  }

  /**
   * ★ The two-voices rule, RFP §4.3.
   *
   * A guardian writes `parentNote`; a teacher writes `teacherNote`; neither may
   * overwrite the other's. The branch is chosen by **relationship to this
   * child**, not by role — a teacher whose own child attends the same
   * kindergarten writes the parent note for their own child.
   *
   * A rejected field is a 400 naming it, not a silent strip: the UI never
   * renders the other side's field, so reaching this means a crafted request,
   * and a silent strip would look to the caller like a save that worked.
   */
  async updateAgeProfile(actor: Actor, childId: string, age: number, dto: UpdateAgeProfileDto) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);

    const data = definedOnly(dto);
    const rejected = rejectedAgeProfileFields(data, isGuardianOf(actor, facts));
    if (rejected.length > 0) {
      throw new BadRequestException(`Энэ талбарыг засах эрхгүй: ${rejected.sort().join(", ")}`);
    }

    const schoolYearId = await this.repo.currentSchoolYearId(childId);
    const saved = await this.repo.upsertAgeProfile(
      childId,
      facts.childKindergartenId,
      age,
      data,
      schoolYearId,
    );

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "ChildAgeProfile",
      objectId: saved.id,
      childId,
      metadata: { age, fields: Object.keys(data) },
    });

    return saved;
  }

  // ── Birthday notes ────────────────────────────────────────────────────────

  /**
   * The birthday section — RFP §4.2: the birth date, the age, the өрнийн орд,
   * the монгол жилийн амьтан and the per-year notes.
   *
   * The two derived facts come from `@kinder/contracts`, which is also what the
   * PDF templates read. Computing them here and only here would leave the
   * printed portfolio — the artefact the family keeps — without the section.
   */
  async listBirthdayNotes(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);

    const { child, notes } = await this.repo.loadBirthdaySection(childId);
    if (!child) throw new NotFoundException();

    return {
      ...birthFacts(child.dateOfBirth),
      // Prisma's `@db.Date` is UTC midnight, so slicing the ISO string is the
      // date that was recorded — not a timezone-shifted neighbour of it.
      dateOfBirth: child.dateOfBirth.toISOString().slice(0, 10),
      ageYears: ageInYears(child.dateOfBirth),
      notes,
    };
  }

  async updateBirthdayNote(actor: Actor, childId: string, age: number, dto: UpdateBirthdayNoteDto) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);

    const saved = await this.repo.upsertBirthdayNote(
      childId,
      facts.childKindergartenId,
      age,
      dto.note,
    );

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "BirthdayNote",
      objectId: saved.id,
      childId,
      metadata: { age },
    });

    return saved;
  }
}

/**
 * Drops keys the caller did not send.
 *
 * A PATCH body parsed by Zod contains `undefined` for every optional field the
 * client omitted. Passing those straight to Prisma is harmless for `update`
 * but would write explicit nulls on `create`, wiping the rest of a form on
 * first save. Filtering here means "absent" and "explicitly cleared" stay
 * distinguishable — `null` still clears a field, as the UI intends.
 */
function definedOnly<T extends object>(dto: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
}
