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
  /**
   * A group of this year whose name is the ministry's, give or take how it was
   * typed.
   *
   * ★ **Normalised, not exact — corrected 2026-09-25.** This matched `name`
   * literally, and `@@unique([schoolYearId, name])` is case-sensitive under
   * Postgres's default collation, so the two could both exist. On the live
   * deployment they did: a director had typed «Бэлтгэл бүлэг» and the ministry
   * sends «бэлтгэл бүлэг», one capital letter apart. The import could not see
   * that they were the same class, created a second one, and left the
   * hand-made group sitting empty beside the imported one holding 22 children.
   *
   * ★★ Compared in memory rather than in the query. Prisma's `mode:
   * "insensitive"` would fix the capital and not the spaces, and a name typed
   * with a trailing space is the same mistake one keystroke along. A school
   * year holds a handful of groups, so reading them and comparing normalised
   * strings costs nothing and handles both.
   *
   * ★★★ `toLocaleLowerCase("mn-MN")`, as every other comparison in this
   * product does. Cyrillic Ө and Ү case-fold correctly only under the
   * Mongolian locale — the letters this kindergarten's group names are full of.
   */
  async findGroupByName(schoolYearId: string, name: string) {
    const wanted = normaliseName(name);
    if (!wanted) return null;

    const groups = await this.prisma.group.findMany({
      where: { schoolYearId, deletedAt: null },
      select: { id: true, name: true, esisGroupId: true },
    });

    /*
     * ★ A group already carrying an `esisGroupId` is preferred when two names
     * normalise the same — which is exactly the shape of the mess this fix
     * prevents, and the shape already sitting in the live database. Adopting
     * the linked one keeps the children where they are; adopting the empty
     * one would move the ministry's id onto a group nobody is enrolled in.
     */
    const matches = groups.filter((group) => normaliseName(group.name) === wanted);
    const linked = matches.find((group) => group.esisGroupId !== null);
    const chosen = linked ?? matches[0];

    return chosen ? { id: chosen.id, esisGroupId: chosen.esisGroupId } : null;
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

  /**
   * Children of this kindergarten not yet linked to any ESIS person who carry
   * the ministry's name and date of birth — the candidates for adoption.
   *
   * ★ **Only unlinked rows.** A child already carrying an `esisPersonId` is
   * somebody the ministry has named; handing them a second id would merge two
   * people.
   *
   * ★★ Narrowed by the date in the query, compared by name in memory — the
   * same normalisation `findGroupByName` uses, for the same reason: a capital
   * letter or a stray space is how two people type one name. A date of birth
   * is shared by a handful of children at most, so the read costs nothing.
   *
   * Every match is returned, not the first. Two candidates is an answer the
   * service needs — it means "do not guess".
   */
  async findUnlinkedChildren(
    kindergartenId: string,
    identity: { lastName: string; firstName: string; dateOfBirth: Date },
  ) {
    const children = await this.prisma.child.findMany({
      where: {
        kindergartenId,
        esisPersonId: null,
        dateOfBirth: identity.dateOfBirth,
        deletedAt: null,
      },
      select: { id: true, lastName: true, firstName: true },
    });
    const last = normaliseName(identity.lastName);
    const first = normaliseName(identity.firstName);
    if (!last || !first) return [];
    return children
      .filter(
        (child) =>
          normaliseName(child.lastName) === last && normaliseName(child.firstName) === first,
      )
      .map((child) => ({ id: child.id }));
  }

  /**
   * Adopts a child typed here before the import: gives the row the ministry's
   * id and ESIS's spelling of the three fields `updateChild` writes.
   *
   * ★ `esisPersonId: null` in the `where` is the guard, not decoration. The
   * lookup above and this write are two statements; a row linked in between
   * by a concurrent import is not overwritten — the update matches nothing
   * and `@@unique([kindergartenId, esisPersonId])` refuses the rest.
   */
  async linkChild(
    id: string,
    data: {
      esisPersonId: string;
      lastName: string;
      firstName: string;
      sex: "MALE" | "FEMALE";
      dateOfBirth: Date;
    },
  ) {
    const { count } = await this.prisma.child.updateMany({
      where: { id, esisPersonId: null, deletedAt: null },
      data,
    });
    return count === 1;
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

/**
 * A name reduced to what two people typing the same class, or the same
 * child, agree on.
 *
 * Case and surrounding space are the two differences seen in practice; the
 * inner spacing is left alone, because «бага бүлэг» and «багабүлэг» are not
 * obviously the same name and guessing that they are would merge two real
 * classes — or two real children.
 */
function normaliseName(name: string): string {
  return name.trim().toLocaleLowerCase("mn-MN");
}
