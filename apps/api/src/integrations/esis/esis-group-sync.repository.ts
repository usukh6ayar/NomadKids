import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { AgeBand } from "../../domain/enums";
import { normaliseName } from "./esis-roster.shared";

/** One row of ESIS's `academicYearStatuses`, already parsed by the service. */
export interface EsisYearInput {
  /** ESIS's key — the year the school year opens in, "2026". */
  academicYear: string;
  /** "2026-2027", the name this product gives it. */
  name: string;
  startsOn: Date;
  endsOn: Date;
  isCurrent: boolean;
}

/** One row of ESIS's `group/list`, already parsed by the service. */
export interface EsisGroupInput {
  esisGroupId: string;
  name: string;
  ageBand: AgeBand;
  academicYear: string;
}

export interface GroupSyncCounts {
  schoolYears: { created: number; updated: number };
  groups: { created: number; updated: number };
  warnings: string[];
}

type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/**
 * The writes `POST …/esis/sync-groups` makes: school years, then the groups
 * that belong to them.
 *
 * ★ **One transaction for the whole sync.** The task asks for a transaction or
 * a clear partial result; the transaction is the one a director can reason
 * about. A failure half way through would otherwise leave a year created with
 * none of its groups, and the next press would count that year as "updated"
 * while the first press had said nothing at all.
 *
 * ★★ **Add and update, never remove** — the same rule as
 * `EsisRosterImportRepository`, for the same reasons. A year or a group ESIS
 * has stopped listing stays exactly as it is.
 *
 * ★★★ **`updated` counts rows whose values changed**, not rows that were
 * looked at. A second press against an unchanged ESIS answers all zeros, and
 * that is the only proof a director has that the button does not duplicate.
 */
@Injectable()
export class EsisGroupSyncRepository {
  constructor(private readonly prisma: PrismaService) {}

  sync(
    kindergartenId: string,
    years: EsisYearInput[],
    groups: EsisGroupInput[],
  ): Promise<GroupSyncCounts> {
    return this.prisma.$transaction(async (tx) => {
      const counts: GroupSyncCounts = {
        schoolYears: { created: 0, updated: 0 },
        groups: { created: 0, updated: 0 },
        warnings: [],
      };

      /*
       * Years are counted by row, not by write: one adopted and then made
       * current is one year updated, which is what the director reads — and
       * one created and then made current is one year created, not also one
       * updated.
       */
      const yearsUpdated = new Set<string>();
      const yearsCreated = new Set<string>();
      const yearIdByEsis = new Map<string, string>();
      for (const year of years) {
        const id = await this.upsertYear(
          tx,
          kindergartenId,
          year,
          counts,
          yearsUpdated,
          yearsCreated,
        );
        if (id) yearIdByEsis.set(year.academicYear, id);
      }

      await this.markCurrent(
        tx,
        kindergartenId,
        years,
        yearIdByEsis,
        counts,
        yearsUpdated,
        yearsCreated,
      );
      counts.schoolYears.updated = yearsUpdated.size;

      for (const group of groups) {
        const schoolYearId = yearIdByEsis.get(group.academicYear);
        if (!schoolYearId) {
          counts.warnings.push(
            `«${group.name}» бүлгийн хичээлийн жил (${group.academicYear}) ESIS-ийн жилийн жагсаалтад алга тул алгасав.`,
          );
          continue;
        }
        await this.upsertGroup(tx, kindergartenId, schoolYearId, group, counts);
      }

      return counts;
    });
  }

  /**
   * Finds or creates the local year for one ESIS year.
   *
   * ★ **Three ways to match, in order**, because the local years were typed
   * by hand before ESIS existed here and a miss is expensive: a second
   * "current" year would pull every group, the roster import and the access
   * fee onto an empty copy.
   *
   *  1. the row already linked by `esisAcademicYear`;
   *  2. an unlinked row with the same name, normalised;
   *  3. an unlinked row whose name begins with ESIS's year **and** whose start
   *     falls inside ESIS's open–close window — how "2026/2027" or
   *     "2026 – 2027" is still recognised as 2026. Both, because ESIS's
   *     windows overlap by four months (2025 closes in July 2026, 2026 opens
   *     in April), so a date alone could hand 2026-2027 to 2025.
   *
   * ★★ **An adopted year keeps its own dates.** ESIS opens 2026 on 1 April;
   * the kindergarten's year starts in September, and that calendar is the
   * director's. ESIS's dates are used only for a year this creates.
   */
  private async upsertYear(
    tx: Tx,
    kindergartenId: string,
    year: EsisYearInput,
    counts: GroupSyncCounts,
    yearsUpdated: Set<string>,
    yearsCreated: Set<string>,
  ): Promise<string | null> {
    const linked = await tx.schoolYear.findFirst({
      where: { kindergartenId, esisAcademicYear: year.academicYear, deletedAt: null },
      select: { id: true },
    });
    if (linked) return linked.id;

    const unlinked = await tx.schoolYear.findMany({
      where: { kindergartenId, esisAcademicYear: null, deletedAt: null },
      select: { id: true, name: true, startsOn: true },
    });
    const wanted = normaliseName(year.name);
    const adopted =
      unlinked.find((row) => normaliseName(row.name) === wanted) ??
      unlinked.find(
        (row) =>
          row.name.trim().startsWith(year.academicYear) &&
          row.startsOn >= year.startsOn &&
          row.startsOn <= year.endsOn,
      );

    if (adopted) {
      await tx.schoolYear.update({
        where: { id: adopted.id },
        data: { esisAcademicYear: year.academicYear },
      });
      yearsUpdated.add(adopted.id);
      return adopted.id;
    }

    /*
     * ★ `@@unique([kindergartenId, name])` counts soft-deleted rows too, so a
     * year a director deleted still owns its name. Creating would fail the
     * whole transaction on a constraint; saying so lets the rest go through.
     */
    const deleted = await tx.schoolYear.findFirst({
      where: { kindergartenId, name: year.name, deletedAt: { not: null } },
      select: { id: true },
    });
    if (deleted) {
      counts.warnings.push(
        `«${year.name}» хичээлийн жил өмнө нь устгагдсан тул дахин үүсгэсэнгүй.`,
      );
      return null;
    }

    /*
     * Created not current: `markCurrent` below decides that for every year at
     * once, after the partial unique index has had the old one cleared.
     */
    const created = await tx.schoolYear.create({
      data: {
        kindergartenId,
        name: year.name,
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        isCurrent: false,
        esisAcademicYear: year.academicYear,
      },
      select: { id: true },
    });
    counts.schoolYears.created += 1;
    yearsCreated.add(created.id);
    return created.id;
  }

  /**
   * Makes ESIS's current year this kindergarten's current year.
   *
   * ★ **Only when ESIS names exactly one.** None, or two, is ESIS saying
   * something this product cannot act on — and guessing moves every screen
   * that reads "the current year" onto a different one. The existing flag is
   * left alone and the director is told.
   *
   * ★★ Demote first, then promote: `school_years_one_current_per_kindergarten`
   * is a partial unique index and refuses two `true` rows even for an instant.
   */
  private async markCurrent(
    tx: Tx,
    kindergartenId: string,
    years: EsisYearInput[],
    yearIdByEsis: Map<string, string>,
    counts: GroupSyncCounts,
    yearsUpdated: Set<string>,
    yearsCreated: Set<string>,
  ) {
    const flagged = years.filter((year) => year.isCurrent);
    if (flagged.length !== 1) {
      counts.warnings.push(
        flagged.length === 0
          ? "ESIS идэвхтэй хичээлийн жил заагаагүй тул одоогийн жилийг өөрчилсөнгүй."
          : "ESIS нэгээс олон идэвхтэй хичээлийн жил заасан тул одоогийн жилийг өөрчилсөнгүй.",
      );
      return;
    }

    const currentId = yearIdByEsis.get(flagged[0]!.academicYear);
    if (!currentId) return;

    const target = await tx.schoolYear.findUniqueOrThrow({
      where: { id: currentId },
      select: { isCurrent: true },
    });
    if (target.isCurrent) return;

    await tx.schoolYear.updateMany({
      where: { kindergartenId, isCurrent: true },
      data: { isCurrent: false },
    });
    await tx.schoolYear.update({ where: { id: currentId }, data: { isCurrent: true } });
    if (!yearsCreated.has(currentId)) yearsUpdated.add(currentId);
  }

  /**
   * ★ Matched by `esisGroupId` within the kindergarten, then adopted by
   * normalised name within the year — the roster import's rule, so a group
   * typed by hand is linked rather than duplicated.
   *
   * ★★ **A linked group is never moved to another year.** Its enrolments
   * carry `schoolYearId`; moving the group alone would leave every child
   * enrolled in a year their group no longer belongs to. It is reported
   * instead.
   */
  private async upsertGroup(
    tx: Tx,
    kindergartenId: string,
    schoolYearId: string,
    group: EsisGroupInput,
    counts: GroupSyncCounts,
  ) {
    const linked = await tx.group.findFirst({
      where: { kindergartenId, esisGroupId: group.esisGroupId, deletedAt: null },
      select: { id: true, name: true, ageBand: true, schoolYearId: true },
    });

    if (linked) {
      if (linked.schoolYearId !== schoolYearId) {
        counts.warnings.push(
          `«${group.name}» бүлэг өөр хичээлийн жилд бүртгэлтэй тул жилийг нь өөрчилсөнгүй.`,
        );
      }
      if (linked.name !== group.name || linked.ageBand !== group.ageBand) {
        if (await this.nameTaken(tx, linked.schoolYearId, group.name, linked.id)) {
          counts.warnings.push(`«${group.name}» нэртэй өөр бүлэг байгаа тул нэрийг өөрчилсөнгүй.`);
          return;
        }
        await tx.group.update({
          where: { id: linked.id },
          data: { name: group.name, ageBand: group.ageBand },
        });
        counts.groups.updated += 1;
      }
      return;
    }

    const wanted = normaliseName(group.name);
    const sameYear = await tx.group.findMany({
      where: { schoolYearId, deletedAt: null },
      select: { id: true, name: true, esisGroupId: true },
    });
    const adoptable = sameYear.find(
      (row) => row.esisGroupId === null && normaliseName(row.name) === wanted,
    );
    if (adoptable) {
      await tx.group.update({
        where: { id: adoptable.id },
        data: { esisGroupId: group.esisGroupId, ageBand: group.ageBand },
      });
      counts.groups.updated += 1;
      return;
    }

    if (await this.nameTaken(tx, schoolYearId, group.name)) {
      counts.warnings.push(
        `«${group.name}» нэртэй бүлэг энэ жилд өөр ESIS бүлэгтэй холбогдсон тул алгасав.`,
      );
      return;
    }

    await tx.group.create({
      data: {
        kindergartenId,
        schoolYearId,
        name: group.name,
        ageBand: group.ageBand,
        esisGroupId: group.esisGroupId,
      },
      select: { id: true },
    });
    counts.groups.created += 1;
  }

  /**
   * `@@unique([schoolYearId, name])` is exact and counts deleted rows, so the
   * check is exact and counts them too — anything looser would still let the
   * insert fail and take the transaction with it.
   */
  private async nameTaken(tx: Tx, schoolYearId: string, name: string, exceptId?: string) {
    const row = await tx.group.findFirst({
      where: { schoolYearId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    return row !== null;
  }
}
