import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { AgeBand } from "../../domain/enums";

/**
 * The writes an ESIS roster import makes: groups, children and their
 * enrolments.
 *
 * ★ **Separate from `EsisRepository`.** That one reads the tenant's mapping and
 * owns `EsisStaffRoster` — a cache of what the ministry said, which the product
 * replaces wholesale on every refresh. This one writes into `Group`, `Child`
 * and `Enrollment`, which are the product's own records and are **never**
 * replaced wholesale. Two very different relationships with the same upstream,
 * and putting them in one class would invite `replaceStaffRoster`'s delete-then-
 * insert shape to be copied onto children.
 *
 * ★★ **Nothing here deletes or soft-deletes.** A child ESIS has stopped listing
 * is a child who left, or a child whose record the ministry is mid-edit; either
 * way that is a decision for a director, made on the child's own screen with
 * the audit trail that belongs to it. An import that could empty a group by
 * being run at the wrong moment is not a button anybody should press twice.
 */
@Injectable()
export class EsisRosterImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The year a newly imported group and enrolment belong to. */
  findCurrentSchoolYear(kindergartenId: string) {
    return this.prisma.schoolYear.findFirst({
      where: { kindergartenId, isCurrent: true, deletedAt: null },
      select: { id: true, name: true, startsOn: true },
    });
  }

  /**
   * The group this ESIS id already produced, if any.
   *
   * ★ `esisGroupId` is not unique in the schema, so this is a `findFirst`
   * rather than a `findUnique` — and it is scoped to the kindergarten, because
   * an unscoped lookup on a non-unique column is the shape that eventually
   * returns another tenant's row.
   */
  findGroupByEsisId(kindergartenId: string, esisGroupId: string) {
    return this.prisma.group.findFirst({
      where: { kindergartenId, esisGroupId, deletedAt: null },
      select: { id: true, name: true, ageBand: true },
    });
  }

  /**
   * A group of this name in this year — the `@@unique([schoolYearId, name])`
   * the import would otherwise collide with.
   *
   * ★ This is how a group created **by hand** before the first import gets
   * adopted rather than duplicated. The director typed "ахлах бүлэг"; ESIS
   * calls it "ахлах бүлэг"; creating a second one would split the roster
   * between two rows that look identical on screen.
   */
  findGroupByName(schoolYearId: string, name: string) {
    return this.prisma.group.findFirst({
      where: { schoolYearId, name, deletedAt: null },
      select: { id: true, esisGroupId: true },
    });
  }

  createGroup(input: {
    kindergartenId: string;
    schoolYearId: string;
    name: string;
    ageBand: AgeBand;
    esisGroupId: string;
  }) {
    return this.prisma.group.create({ data: input, select: { id: true } });
  }

  /**
   * Adopts an existing group, or follows a rename ESIS made.
   *
   * ★ The name is written from ESIS deliberately. The ministry's register is
   * the one a director is reconciled against, and two systems disagreeing about
   * the name of the same group is the confusion this import exists to remove.
   */
  updateGroup(id: string, data: { name?: string; ageBand?: AgeBand; esisGroupId?: string }) {
    return this.prisma.group.update({ where: { id }, data, select: { id: true } });
  }

  findChildByEsisPersonId(kindergartenId: string, esisPersonId: string) {
    return this.prisma.child.findFirst({
      where: { kindergartenId, esisPersonId, deletedAt: null },
      select: { id: true },
    });
  }

  createChild(input: {
    kindergartenId: string;
    esisPersonId: string;
    lastName: string;
    firstName: string;
    sex: "MALE" | "FEMALE";
    dateOfBirth: Date;
  }) {
    return this.prisma.child.create({ data: input, select: { id: true } });
  }

  /**
   * ★ Name and date of birth only.
   *
   * An import must not touch a photograph, a health note, a consent flag or
   * anything else a teacher has entered here — ESIS holds none of them and an
   * update built from `...row` would blank every one. The three fields written
   * are the three ESIS is authoritative for.
   */
  updateChild(
    id: string,
    data: { lastName: string; firstName: string; sex: "MALE" | "FEMALE"; dateOfBirth: Date },
  ) {
    return this.prisma.child.update({ where: { id }, data, select: { id: true } });
  }

  /** The child's live enrolment in this year, whichever group it names. */
  findActiveEnrollment(childId: string, schoolYearId: string) {
    return this.prisma.enrollment.findFirst({
      where: { childId, schoolYearId, status: "ACTIVE", deletedAt: null },
      select: { id: true, groupId: true },
    });
  }

  createEnrollment(input: {
    kindergartenId: string;
    childId: string;
    groupId: string;
    schoolYearId: string;
    startedOn: Date;
  }) {
    return this.prisma.enrollment.create({ data: input, select: { id: true } });
  }

  /**
   * Moves a live enrolment to another group.
   *
   * ★ The row is moved rather than ended and replaced. `Enrollment` carries the
   * child's history and `/children/:id/enrollment-archive` reads it, but a
   * group correction made in ESIS on the day of registration is not history —
   * it is the same enrolment, recorded correctly. A director moving a child
   * between groups on purpose goes through the child's own screen, which ends
   * one row and opens another with the dates that make the move legible.
   */
  moveEnrollment(id: string, groupId: string) {
    return this.prisma.enrollment.update({
      where: { id },
      data: { groupId },
      select: { id: true },
    });
  }
}
