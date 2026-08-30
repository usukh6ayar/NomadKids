import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { UsersService } from "../users/users.service";
import { ChildrenRepository, type CreateChildData } from "./children.repository";
import { childKey, parseChildWorkbook } from "./child-import";
import { buildChildWorkbook } from "./child-export";
import { UploadRejected, validateSpreadsheetUpload } from "../media/upload-validation";
import type {
  AddGuardianDto,
  CreateChildDto,
  EndEnrollmentDto,
  EnrollDto,
  InviteGuardianDto,
  ListChildrenQuery,
  UpdateChildDto,
  UpdateGuardianshipDto,
} from "./children.dto";

@Injectable()
export class ChildrenService {
  constructor(
    private readonly repo: ChildrenRepository,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly authz: AuthzRepository,
    private readonly users: UsersService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The children this actor may see.
   *
   * The visibility filter is built by `AuthzRepository` — the same definition
   * the detail path uses, kept identical by `test/authz-consistency.test.ts`.
   * Building it separately here is how a list and a detail page come to
   * disagree about who exists.
   */
  async list(actor: Actor, query: ListChildrenQuery) {
    const visible = await this.authz.visibleChildrenWhere(actor);
    const page: PageParams = { page: query.page, pageSize: query.pageSize };

    const { items, total } = await this.repo.listChildren(visible, childFilters(query), page, {
      sort: query.sort,
      order: query.order,
    });

    return paginate(items, total, page);
  }

  /**
   * The roster's headline numbers — RFP §12.1's "нийт хүүхэд" and mean age.
   *
   * ★ Over the whole filtered roster, not the page on screen.
   *
   * The list is paginated at 25, so an average computed on the client would be
   * the mean age of whichever 25 children happened to be visible — a number
   * that changes when you press "next" and describes nothing. It takes the same
   * query the list does, so filtering by group narrows both together.
   *
   * ★★ Months, not years, and that is a domain decision rather than precision
   * for its own sake. A kindergarten's roster spans roughly 2 to 5 years old;
   * rounded to whole years the mean is "3" for most of a school year and the
   * number stops moving. `formatAge` already reasons the same way about a child
   * under two.
   */
  async rosterSummary(actor: Actor, query: ListChildrenQuery) {
    const visible = await this.authz.visibleChildrenWhere(actor);
    const rows = await this.repo.rosterFacts(visible, childFilters(query));

    const now = new Date();
    const months = rows
      .map((row) => monthsBetween(row.dateOfBirth, now))
      .filter((m): m is number => m !== null);

    return {
      total: rows.length,
      /*
       * ★ Counted, not derived from one another.
       *
       * `Sex` is a two-value enum today, so `girls = total - boys` would be
       * correct — and would silently start counting children with no recorded
       * sex as girls the day the column becomes nullable or gains a third
       * value. Two counts that can disagree with `total` are more honest than
       * one that cannot.
       */
      boys: rows.filter((row) => row.sex === "MALE").length,
      girls: rows.filter((row) => row.sex === "FEMALE").length,
      // Null rather than 0 where nothing is countable: a roster of children
      // with no recorded birthday has no average age, and "0 нас" is a claim.
      averageAgeMonths:
        months.length === 0
          ? null
          : Math.round(months.reduce((sum, m) => sum + m, 0) / months.length),
    };
  }

  async get(actor: Actor, childId: string) {
    // Throws 404 when absent or unauthorized — indistinguishable, by design.
    await this.childAccess.assertCanAccess(actor, childId);

    const child = await this.repo.findChild(childId);
    if (!child) throw new NotFoundException();

    // Opening a child's record is auditable: RFP §971 asks who viewed what.
    await this.audit.append({
      action: "VIEW",
      kindergartenId: child.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Child",
      objectId: childId,
      childId,
    });

    return child;
  }

  /**
   * Registers a child.
   *
   * Enrolling immediately is optional: a child may be registered before their
   * group is decided. Until an enrollment exists, `Child.kindergartenId` is the
   * only thing granting the registering staff access — the documented D8
   * fallback, and the reason it exists.
   */
  async create(actor: Actor, kindergartenId: string, dto: CreateChildDto) {
    this.tenants.assertStaff(actor, kindergartenId);

    if (dto.nationalId) {
      const clash = await this.repo.findByNationalId(kindergartenId, dto.nationalId);
      if (clash) throw new ConflictException("Энэ регистрийн дугаартай хүүхэд бүртгэлтэй байна");
    }

    const child = await this.repo.createChild({
      kindergartenId,
      lastName: dto.lastName,
      firstName: dto.firstName,
      nationalId: dto.nationalId ?? null,
      sex: dto.sex,
      dateOfBirth: dto.dateOfBirth,
      healthNotes: dto.healthNotes ?? null,
    });

    if (dto.groupId) {
      await this.enrollInternal(kindergartenId, child.id, dto.groupId, new Date());
    }

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Child",
      objectId: child.id,
      childId: child.id,
    });

    return child;
  }

  /**
   * Edits a child.
   *
   * `assertCanRecord`, not `assertCanAccess` — a guardian may read their
   * child's record and, through *this* endpoint, may still not edit it. The
   * reference suite tests exactly this (`test_a_guardian_cannot_edit_their_
   * own_child`), and that guarantee is unchanged here: `nationalId`,
   * `healthNotes`, `status` and a group transfer all still require staff.
   *
   * ★ 2026-08-28, on the client's instruction: a guardian *can* now change
   * four of these same columns — `lastName`, `firstName`, `dateOfBirth`,
   * `sex` — through a second, narrower path,
   * `PortfolioService.updateAboutMe`. That is a deliberate, scoped reversal
   * of the rule above for those four fields only, not a hole in it — see
   * that method's own doc comment for the reasoning and
   * `updateAboutMeSchema`'s for where the fields are declared.
   */
  async update(actor: Actor, childId: string, dto: UpdateChildDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    if (dto.nationalId) {
      const clash = await this.repo.findByNationalId(facts.childKindergartenId, dto.nationalId);
      if (clash && clash.id !== childId) {
        throw new ConflictException("Энэ регистрийн дугаартай хүүхэд бүртгэлтэй байна");
      }
    }

    const updated = await this.repo.updateChild(childId, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "Child",
      objectId: childId,
      childId,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  /** Archives a child. Admins only — this is an administrative action. */
  async archive(actor: Actor, childId: string) {
    const facts = await this.childAccess.assertCanAdminister(actor, childId);

    const archived = await this.repo.softDeleteChild(childId);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "Child",
      objectId: childId,
      childId,
    });
    return archived;
  }

  /** A parent's own children — the parent home screen's only query. */
  async listOwnChildren(actor: Actor) {
    return this.repo.listChildrenForGuardian(actor.userId);
  }

  // ── Guardianships ─────────────────────────────────────────────────────────

  async listGuardians(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    const child = await this.repo.findChild(childId);
    return child?.guardianships ?? [];
  }

  async addGuardian(actor: Actor, childId: string, dto: AddGuardianDto) {
    const facts = await this.childAccess.assertCanAdminister(actor, childId);

    const existing = await this.repo.findGuardianshipFor(childId, dto.guardianUserId);
    if (existing) {
      // Restoring a revoked guardian is a normal operation — a custody change
      // reversing — and should not be an error.
      if (!existing.canView) {
        const restored = await this.repo.updateGuardianship(existing.id, { canView: true });
        await this.auditGuardianship(
          actor,
          facts.childKindergartenId,
          childId,
          existing.id,
          "restored",
        );
        return restored;
      }
      throw new ConflictException("Энэ асран хамгаалагч аль хэдийн холбогдсон байна");
    }

    const guardianship = await this.repo.createGuardianship({
      kindergartenId: facts.childKindergartenId,
      childId,
      guardianUserId: dto.guardianUserId,
      relation: dto.relation,
      isPrimary: dto.isPrimary,
    });

    await this.auditGuardianship(
      actor,
      facts.childKindergartenId,
      childId,
      guardianship.id,
      "granted",
    );
    return guardianship;
  }

  /**
   * Invites a guardian who has no account yet, for one child.
   *
   * ★ A teacher may do this; linking an *existing* account still may not.
   *
   * `addGuardian` needs `assertCanAdminister` because it hands an account that
   * already has an owner access to a child — a real authorization decision, and
   * an administrator's. This creates a new account that nobody can open until
   * the invitation is accepted, for a child the teacher already writes about.
   * `assertCanRecord` is the same bar as posting an observation about them.
   *
   * ★★ The guardianship is created **now**, not when the invitation is
   * accepted.
   *
   * The alternative is carrying a `childId` on the token and creating the link
   * on redemption. That would mean the authorization decision — "this person may
   * see this child" — is made by whoever holds the link rather than by the
   * teacher who issued it, and it would put a second guardianship-creating path
   * behind an unauthenticated endpoint. Creating it here keeps the decision, the
   * audit entry and the check in one place. The account it points at cannot be
   * opened by anyone, so an unaccepted invitation grants nothing.
   *
   * A duplicate username, email or phone is a 409 rather than a silent link to
   * the existing account: giving an account somebody already owns access to a
   * child is exactly the decision this endpoint is not allowed to make.
   */
  async inviteGuardian(actor: Actor, childId: string, dto: InviteGuardianDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    const created = await this.users.createPlaceholderGuardianAccount(
      actor,
      facts.childKindergartenId,
    );

    const guardianship = await this.repo.createGuardianship({
      kindergartenId: facts.childKindergartenId,
      childId,
      guardianUserId: created.user.id,
      /*
        ★ `OTHER` until the guardian says otherwise.
        
        The relationship is the guardian's own fact — "аав", "ээж" — and asking
        a teacher to guess it is how a father ends up recorded as a mother. It
        is set when the invitation is accepted, alongside their name and phone.
        The enum has no "unknown" member and adding one would mean a migration
        plus every consumer learning to render it; `OTHER` already means "not
        one of the named relationships", which is exactly true here.
      */
      relation: "OTHER",
      isPrimary: dto.isPrimary,
    });

    await this.auditGuardianship(
      actor,
      facts.childKindergartenId,
      childId,
      guardianship.id,
      "invited",
    );

    // The token is returned so the caller can deliver it — as a QR code on
    // screen, or read out. Never logged.
    return { user: created.user, guardianship, invitationToken: created.invitationToken };
  }

  /**
   * Updates a guardianship — including revoking it with `canView: false`.
   *
   * ★ Revocation is a field, never a deletion. Custody arrangements change back,
   * and the record of who was a guardian is part of the child's history.
   */
  async updateGuardianship(actor: Actor, guardianshipId: string, dto: UpdateGuardianshipDto) {
    const guardianship = await this.repo.findGuardianship(guardianshipId);
    if (!guardianship) throw new NotFoundException();

    await this.childAccess.assertCanAdminister(actor, guardianship.childId);

    const updated = await this.repo.updateGuardianship(guardianshipId, dto);
    await this.auditGuardianship(
      actor,
      guardianship.child.kindergartenId,
      guardianship.childId,
      guardianshipId,
      dto.canView === false ? "revoked" : "updated",
    );
    return updated;
  }

  // ── Enrollment ────────────────────────────────────────────────────────────

  async listEnrollments(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    return this.repo.listEnrollments(childId);
  }

  /**
   * Enrols a child in a group, transferring them if they are already placed.
   *
   * The group determines the kindergarten and the school year, so neither is
   * taken from the request — a body-supplied kindergarten id would let an admin
   * move a child into a tenant they do not administer.
   */
  async enroll(actor: Actor, childId: string, dto: EnrollDto) {
    await this.childAccess.assertCanAdminister(actor, childId);

    // The target group must be in a kindergarten this actor administers.
    const adminKindergartens = this.tenants.adminKindergartenIds(actor);
    let group = null;
    for (const kindergartenId of adminKindergartens) {
      group = await this.repo.findGroupInKindergarten(dto.groupId, kindergartenId);
      if (group) break;
    }
    if (!group) throw new BadRequestException("Бүлэг олдсонгүй");

    const enrollment = await this.enrollInternal(
      group.kindergartenId,
      childId,
      group.id,
      dto.startedOn ?? new Date(),
    );

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: group.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Enrollment",
      objectId: enrollment.id,
      childId,
      metadata: { groupId: group.id, change: "enrolled" },
    });
    return enrollment;
  }

  async endEnrollment(actor: Actor, enrollmentId: string, dto: EndEnrollmentDto) {
    const enrollment = await this.repo.findEnrollment(enrollmentId);
    if (!enrollment) throw new NotFoundException();

    await this.childAccess.assertCanAdminister(actor, enrollment.childId);

    const ended = await this.repo.endEnrollment(enrollmentId, dto.status);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: enrollment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Enrollment",
      objectId: enrollmentId,
      childId: enrollment.childId,
      metadata: { change: "ended", status: dto.status },
    });
    return ended;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async enrollInternal(
    kindergartenId: string,
    childId: string,
    groupId: string,
    startedOn: Date,
  ) {
    const group = await this.repo.findGroupInKindergarten(groupId, kindergartenId);
    if (!group) throw new BadRequestException("Бүлэг олдсонгүй");

    return this.repo.enrollChild({
      kindergartenId,
      childId,
      groupId,
      schoolYearId: group.schoolYear.id,
      startedOn,
    });
  }

  private async auditGuardianship(
    actor: Actor,
    kindergartenId: string,
    childId: string,
    guardianshipId: string,
    change: string,
  ) {
    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Guardianship",
      objectId: guardianshipId,
      childId,
      metadata: { change },
    });
  }

  /**
   * The roster as a spreadsheet — RFP §12.3.
   *
   * ★ Scoped by `visibleChildrenWhere`, exactly like the paginated list.
   *
   * This is the whole authorization story and it must stay that way: a teacher
   * exports the children they can see, not the kindergarten's. Reusing the
   * filter rather than writing a second one is what stops the two answers
   * drifting apart — an export that showed more than the screen would be a
   * silent leak nobody would think to look for.
   */
  async exportRoster(actor: Actor, kindergartenId: string, query: ListChildrenQuery) {
    this.tenants.assertStaff(actor, kindergartenId);

    const visible = await this.authz.visibleChildrenWhere(actor);
    const children = await this.repo.listChildrenForExport(visible, childFilters(query));
    const kindergartenName = await this.repo.kindergartenName(kindergartenId);

    const buffer = await buildChildWorkbook(
      children.map((child) => ({
        lastName: child.lastName,
        firstName: child.firstName,
        sex: child.sex,
        dateOfBirth: child.dateOfBirth ? child.dateOfBirth.toISOString() : null,
        nationalId: child.nationalId,
        groupName: child.enrollments[0]?.group?.name ?? null,
        healthNotes: child.healthNotes,
        status: child.status,
      })),
      kindergartenName,
    );

    // A file with every child's name, national id and health notes in it. RFP
    // §2.1 wants that on the record, and this is the same `DOWNLOAD` action the
    // survey export and the report download already use.
    await this.audit.append({
      action: "DOWNLOAD",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "ChildExport",
      objectId: kindergartenId,
      metadata: { format: "xlsx", children: children.length },
    });

    return { buffer, filename: "khuukhduud.xlsx" };
  }

  // ── Excel import — RFP §3.4 ───────────────────────────────────────────────

  /**
   * Imports a roster from a spreadsheet.
   *
   * ★ Two passes over one parser: `dryRun` reports what *would* happen and
   * writes nothing. The commit runs the identical validation and then writes.
   *
   * An import that only tells you what went wrong after it has half-written
   * the file is the failure mode this shape exists to prevent — and sharing the
   * parser is what stops the preview from disagreeing with the result.
   *
   * ★★ The kindergarten comes from the route and the actor's membership, never
   * from the file. A "kindergarten" column would let whoever edits the
   * spreadsheet choose which tenant a child lands in.
   */
  async importFromWorkbook(actor: Actor, kindergartenId: string, file: Buffer, dryRun: boolean) {
    this.tenants.assertStaff(actor, kindergartenId);

    /*
     * `UploadRejected` is a plain `Error`, not an HTTP exception — every caller
     * translates it, so that `upload-validation.ts` stays free of Nest. Without
     * this catch a file that is not a spreadsheet answers 500, which reads as
     * "the server is broken" rather than "this is the wrong file".
     */
    try {
      validateSpreadsheetUpload(file);
    } catch (error) {
      if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
      throw error;
    }

    const { rows, problems } = await parseChildWorkbook(file);

    const groups = await this.repo.groupsForImport(kindergartenId);
    const groupByName = new Map(groups.map((group) => [group.name.trim().toLowerCase(), group]));

    const existing = await this.repo.existingChildKeys(kindergartenId);

    const accepted: {
      child: CreateChildData;
      groupId: string | null;
      schoolYearId: string | null;
      rowNumber: number;
      label: string;
    }[] = [];

    const allProblems = [...problems];

    for (const row of rows) {
      /*
       * A child already registered here is skipped, not overwritten.
       *
       * ★ An import must never silently edit an existing record. The
       * spreadsheet is very often last year's file re-uploaded, and a stale
       * cell in it would quietly rewrite a health note or a date of birth that
       * somebody has since corrected in the system.
       */
      if (row.nationalId !== null && existing.nationalIds.has(row.nationalId)) {
        allProblems.push({
          rowNumber: row.rowNumber,
          message: "Энэ регистрийн дугаартай хүүхэд аль хэдийн бүртгэлтэй — алгасав",
        });
        continue;
      }

      /*
       * A register-less row matching a child already here.
       *
       * ★ Skipped, and this is the case that makes the export/import pair
       * usable. A file from the ministry — or this system's own export —
       * routinely has an empty register column, and matching on the id alone
       * meant re-uploading it created every one of those children a second
       * time.
       *
       * Skipping rather than merging keeps the wrong answer cheap: a genuinely
       * new child who collides costs one manual entry, where an overwrite would
       * silently rewrite a record somebody has since corrected.
       */
      if (
        row.nationalId === null &&
        existing.nameAndDate.has(childKey(row.lastName, row.firstName, row.dateOfBirth))
      ) {
        allProblems.push({
          rowNumber: row.rowNumber,
          message: "Ижил нэр, төрсөн огноотой хүүхэд бүртгэлтэй байна — алгасав",
        });
        continue;
      }

      let groupId: string | null = null;
      let schoolYearId: string | null = null;

      if (row.groupName) {
        const group = groupByName.get(row.groupName.trim().toLowerCase());
        if (!group) {
          // Refused rather than imported group-less: a roster whose group names
          // are wrong is a roster somebody needs to look at, and a child
          // silently left unassigned is invisible on every group screen.
          allProblems.push({
            rowNumber: row.rowNumber,
            message: `"${row.groupName}" нэртэй бүлэг олдсонгүй`,
          });
          continue;
        }

        groupId = group.id;
        schoolYearId = group.schoolYear.id;
      }

      accepted.push({
        rowNumber: row.rowNumber,
        label: `${row.lastName} ${row.firstName}`,
        groupId,
        schoolYearId,
        child: {
          kindergartenId,
          lastName: row.lastName,
          firstName: row.firstName,
          nationalId: row.nationalId,
          sex: row.sex,
          // The parser hands back `YYYY-MM-DD`; the column is a `@db.Date`.
          // Parsed as UTC midnight so the stored day is the one that was
          // typed, whatever timezone the server happens to run in.
          dateOfBirth: new Date(`${row.dateOfBirth}T00:00:00.000Z`),
          healthNotes: row.healthNotes,
        },
      });
    }

    const summary = {
      dryRun,
      willImport: accepted.length,
      skipped: allProblems.length,
      problems: allProblems.sort((a, b) => a.rowNumber - b.rowNumber),
      preview: accepted.slice(0, 20).map((row) => ({
        rowNumber: row.rowNumber,
        name: row.label,
        group: row.groupId ? (groups.find((g) => g.id === row.groupId)?.name ?? null) : null,
      })),
    };

    if (dryRun) return { ...summary, imported: [] };

    if (accepted.length === 0) throw new BadRequestException("Оруулах мөр олдсонгүй");

    const imported = await this.repo.importChildren(
      accepted.map(({ child, groupId, schoolYearId }) => ({ child, groupId, schoolYearId })),
    );

    /*
     * One audit row for the import, plus one per child.
     *
     * The per-child rows are what make a child's own history complete — "where
     * did this record come from" is answerable from the child's page. The
     * summary row is what an administrator scanning the audit browser sees.
     * нэмэлт.md §15 asks for exactly this provenance on imported data.
     */
    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "ChildImport",
      objectId: kindergartenId,
      metadata: { imported: imported.length, skipped: allProblems.length, source: "xlsx" },
    });

    for (const child of imported) {
      await this.audit.append({
        action: "CREATE",
        kindergartenId,
        actorUserId: actor.userId,
        objectType: "Child",
        objectId: child.id,
        childId: child.id,
        metadata: { source: "xlsx" },
      });
    }

    return { ...summary, willImport: imported.length, imported };
  }
}

/**
 * Completed months between a birth date and now; null when unusable.
 *
 * Mirrors the web's `formatAge`: the month only counts once its day has passed,
 * so a child two days from their birthday is not yet a year older.
 */
function monthsBetween(dateOfBirth: Date | null | undefined, now: Date): number | null {
  if (!dateOfBirth) return null;

  let months =
    (now.getFullYear() - dateOfBirth.getFullYear()) * 12 +
    (now.getMonth() - dateOfBirth.getMonth());
  if (now.getDate() < dateOfBirth.getDate()) months -= 1;

  return months < 0 ? null : months;
}

/**
 * The query's filter half, shared by the list and its summary.
 *
 * ★ Written once because these two must agree.
 *
 * `rosterSummary` reports the total and the mean age *of the filtered roster*,
 * and it did so from a second hand-copied object literal. Adding `sex` and the
 * age range to one and not the other is how a header comes to say "12 children"
 * over a list showing 4 — and the repository already extracted `childWhere` to
 * prevent exactly this, one layer down.
 *
 * Sorting is deliberately not here: it changes the order of a list and means
 * nothing to an aggregate.
 */
function childFilters(query: ListChildrenQuery) {
  return {
    q: query.q,
    status: query.status,
    groupId: query.groupId,
    schoolYearId: query.schoolYearId,
    sex: query.sex,
    ageMin: query.ageMin,
    ageMax: query.ageMax,
  };
}
