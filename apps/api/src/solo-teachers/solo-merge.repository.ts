import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { classify } from "./solo-merge-plan";

/** A foreign key column into one of the tables the merge re-points. */
export interface ForeignKey {
  table: string;
  column: string;
}

export interface MergeResult {
  /** Rows re-parented, per `table.column`. Zero counts are left out. */
  moved: Record<string, number>;
  membershipsMoved: number;
  membershipsJoined: number;
  adminsDropped: number;
  groupsRenamed: { from: string; to: string }[];
  /** D3b — solo children attached to the target's record of the same child. */
  childrenAttached: { soloChildId: string; targetChildId: string; name: string }[];
  /** Rows left on an archived solo record because the target's would break a rule. */
  kept: Record<string, number>;
  intoExistingGroup: boolean;
}

export interface MergeOptions {
  preview: boolean;
  groupNameFor: (name: string) => string;
  /** D3b — an existing group of the target's current year to merge into. */
  targetGroupId?: string;
  /** D3b — solo children *not* to attach to their matched target child. */
  keepSeparate?: string[];
}

/** Why a merge stopped — everything rolled back. */
export type MergeRefusal =
  | { kind: "blocked"; tables: Record<string, number> }
  | { kind: "duplicates"; children: { soloChildId: string; targetChildId: string; name: string }[] }
  | { kind: "ambiguous"; children: { soloChildId: string; name: string }[] }
  | { kind: "badGroup" }
  | { kind: "conflict"; constraint: string }
  | { kind: "noSchoolYear" }
  | { kind: "notMergeable" };

export class MergeRefused extends Error {
  constructor(readonly refusal: MergeRefusal) {
    super(`merge refused: ${refusal.kind}`);
  }
}

/** Thrown at the end of a preview so the transaction rolls back with the counts. */
class Rollback extends Error {
  constructor(readonly result: MergeResult) {
    super("preview");
  }
}

/** Identifiers come from `pg_constraint`, but are checked before being quoted into SQL. */
const IDENTIFIER = /^[a-z_]+$|^[a-zA-Z]+$/;

/** Long enough for ~80 updates on a production-sized table set. */
const TX = { timeout: 120_000, maxWait: 10_000 };

/**
 * D3 — the operator merges a solo teacher's workspace into the contracted
 * kindergarten they work at (the user, 2026-10-11). One transaction; nothing
 * deleted; a preview that runs the very same code and rolls back, so it can
 * never disagree with the merge.
 *
 * ★ The tables are found through **foreign keys** (`pg_constraint`), not
 * column names, and each is classified in `solo-merge-plan.ts`.
 */
@Injectable()
export class SoloMergeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every foreign key into `referenced`, as `table.column`. */
  async foreignKeysInto(referenced: string): Promise<ForeignKey[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ table: string; column: string }[]>(
      `SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
         FROM pg_constraint c
         JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f' AND c.confrelid = $1::regclass
        ORDER BY 1, 2`,
      referenced,
    );
    for (const fk of rows) {
      if (!IDENTIFIER.test(fk.table) || !IDENTIFIER.test(fk.column)) {
        throw new Error(`Unexpected identifier in a foreign key: ${fk.table}.${fk.column}`);
      }
    }
    return rows;
  }

  /** The target's live groups of its current year, for the operator's picker. */
  targetGroups(targetId: string) {
    return this.prisma.group.findMany({
      where: {
        kindergartenId: targetId,
        deletedAt: null,
        schoolYear: { isCurrent: true, deletedAt: null },
      },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true },
    });
  }

  listWorkspaces(skip: number, take: number) {
    const where = { kind: "SOLO_TEACHER" as const, deletedAt: null };
    return Promise.all([
      this.prisma.kindergarten.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          location: true,
          soloWorkplaceName: true,
          createdAt: true,
          _count: { select: { children: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.kindergarten.count({ where }),
    ]);
  }

  /**
   * The paid state follows the child. If the solo record's fee for the year is
   * paid and the target record's row is not, the target's row takes it; the
   * solo row stays (as history) on the archived record. The before values are
   * in the merge's audit metadata via `kept`/`moved`.
   */
  private async carryPaidFee(tx: Tx, soloChildId: string, targetChildId: string, yearId: string) {
    const paid = await tx.accessSubscription.findMany({
      where: { childId: soloChildId, schoolYearId: yearId, status: "ACTIVE", deletedAt: null },
      select: { period: true, termNumber: true, amount: true, paidAt: true, expiresAt: true },
    });
    // ★ Like for like (#211): a paid term settles the target's row for that
    // term, never its year — a YEAR row stamped with a term's price and end
    // would read as paid, then lapse at the term's end with the year unbuyable.
    for (const row of paid) {
      await tx.accessSubscription.updateMany({
        where: {
          childId: targetChildId,
          schoolYearId: yearId,
          period: row.period,
          termNumber: row.termNumber,
          status: { not: "ACTIVE" },
        },
        data: {
          status: "ACTIVE",
          amount: row.amount,
          paidAt: row.paidAt,
          expiresAt: row.expiresAt,
        },
      });
    }
  }

  /** A teacher already assigned to the target group is not assigned twice. */
  private async dropRepeatedAssignments(
    tx: Tx,
    soloGroupId: string,
    targetGroupId: string,
    now: Date,
  ) {
    const repeated = await tx.groupTeacher.findMany({
      where: { groupId: soloGroupId, deletedAt: null },
      select: { id: true, membershipId: true },
    });
    for (const row of repeated) {
      const already = await tx.groupTeacher.findFirst({
        where: {
          groupId: targetGroupId,
          membershipId: row.membershipId,
          endedOn: null,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (already)
        await tx.groupTeacher.update({ where: { id: row.id }, data: { deletedAt: now } });
    }
  }

  /** The merge, or — with `preview` — the same work rolled back, answering its counts. */
  async merge(soloId: string, targetId: string, options: MergeOptions): Promise<MergeResult> {
    const [toKindergarten, toYear, toMembership, toChild, toGroup] = await Promise.all([
      this.foreignKeysInto("kindergartens"),
      this.foreignKeysInto("school_years"),
      this.foreignKeysInto("memberships"),
      this.foreignKeysInto("children"),
      this.foreignKeysInto("groups"),
    ]);

    // A table no class names is a table the merge would silently skip.
    const unclassified = toKindergarten.filter((f) => classify(f.table) === null);
    if (unclassified.length > 0) {
      throw new Error(
        `Unclassified tables for the merge: ${unclassified.map((f) => f.table).join(", ")}`,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const exec = (sql: string, ...values: unknown[]) => tx.$executeRawUnsafe(sql, ...values);
        const count = async (fk: ForeignKey, id: string) => {
          const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*) AS n FROM "${fk.table}" WHERE "${fk.column}" = $1::uuid`,
            id,
          );
          return Number(rows[0]?.n ?? 0);
        };

        const solo = await tx.kindergarten.findFirst({
          where: { id: soloId, kind: "SOLO_TEACHER" },
          select: { id: true, mergedIntoId: true, deletedAt: true },
        });
        const target = await tx.kindergarten.findFirst({
          where: { id: targetId, kind: "CONTRACTED", deletedAt: null },
          select: { id: true },
        });
        // Live, or already merged into this very target — a re-run sweeps in
        // whatever the teacher wrote while the first one ran.
        const mergeable =
          solo && target && (solo.deletedAt === null || solo.mergedIntoId === targetId);
        if (!mergeable) throw new MergeRefused({ kind: "notMergeable" });

        const targetYear = await tx.schoolYear.findFirst({
          where: { kindergartenId: targetId, isCurrent: true, deletedAt: null },
          select: { id: true },
        });
        if (!targetYear) throw new MergeRefused({ kind: "noSchoolYear" });

        // 1. Refuse what a solo workspace should not hold.
        const blocked: Record<string, number> = {};
        for (const fk of toKindergarten.filter((f) => classify(f.table) === "BLOCK")) {
          const n = await count(fk, soloId);
          if (n > 0) blocked[`${fk.table}.${fk.column}`] = n;
        }
        if (Object.keys(blocked).length > 0) {
          throw new MergeRefused({ kind: "blocked", tables: blocked });
        }

        // 2. The same child already on the target's roll — attached in step 5b.
        const matches = await tx.$queryRawUnsafe<
          { soloChildId: string; targetChildId: string; name: string }[]
        >(
          `SELECT s.id AS "soloChildId", t.id AS "targetChildId",
                  s."lastName" || ' ' || s."firstName" AS name
             FROM children s
             JOIN children t ON t."kindergartenId" = $2::uuid AND t."deletedAt" IS NULL
              AND ( (s."nationalId" IS NOT NULL AND s."nationalId" = t."nationalId")
                 OR (lower(s."lastName") = lower(t."lastName")
                     AND lower(s."firstName") = lower(t."firstName")
                     AND s."dateOfBirth" = t."dateOfBirth") )
            WHERE s."kindergartenId" = $1::uuid AND s."deletedAt" IS NULL`,
          soloId,
          targetId,
        );
        const separate = new Set(options.keepSeparate ?? []);
        const bySolo = new Map<string, typeof matches>();
        for (const m of matches) {
          if (separate.has(m.soloChildId)) continue;
          bySolo.set(m.soloChildId, [...(bySolo.get(m.soloChildId) ?? []), m]);
        }
        // One solo child, two target children: the operator decides first.
        const ambiguous = [...bySolo.values()].filter((list) => list.length > 1);
        if (ambiguous.length > 0) {
          throw new MergeRefused({
            kind: "ambiguous",
            children: ambiguous.map((list) => ({
              soloChildId: list[0]!.soloChildId,
              name: list[0]!.name,
            })),
          });
        }
        const pairs = [...bySolo.values()].map((list) => list[0]!);

        if (options.targetGroupId) {
          const group = await tx.group.findFirst({
            where: {
              id: options.targetGroupId,
              kindergartenId: targetId,
              schoolYearId: targetYear.id,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!group) throw new MergeRefused({ kind: "badGroup" });
        }

        const result: MergeResult = {
          moved: {},
          membershipsMoved: 0,
          membershipsJoined: 0,
          adminsDropped: 0,
          groupsRenamed: [],
          childrenAttached: pairs,
          kept: {},
          intoExistingGroup: Boolean(options.targetGroupId),
        };

        /**
         * Re-points one foreign key from `from` to `to` row by row, each in a
         * savepoint: a row that would break a unique index (a second profile,
         * a second active enrollment…) is rolled back alone and stays where it
         * was — on a record about to be archived, never deleted.
         */
        const repoint = async (fk: ForeignKey, from: string, to: string) => {
          const rows = await tx.$queryRawUnsafe<{ ctid: string }[]>(
            `SELECT ctid::text AS ctid FROM "${fk.table}" WHERE "${fk.column}" = $1::uuid`,
            from,
          );
          const key = `${fk.table}.${fk.column}`;
          for (const row of rows) {
            await exec("SAVEPOINT solo_merge_row");
            try {
              await exec(
                `UPDATE "${fk.table}" SET "${fk.column}" = $1::uuid WHERE ctid = $2::tid`,
                to,
                row.ctid,
              );
              await exec("RELEASE SAVEPOINT solo_merge_row");
              result.moved[key] = (result.moved[key] ?? 0) + 1;
            } catch (error) {
              if (!uniqueViolation(error)) throw error;
              await exec("ROLLBACK TO SAVEPOINT solo_merge_row");
              result.kept[key] = (result.kept[key] ?? 0) + 1;
            }
          }
        };

        // 3. Groups whose name is taken in the target's year get the operator's name.
        const soloYears = await tx.schoolYear.findMany({
          where: { kindergartenId: soloId },
          select: { id: true },
        });
        const soloYearIds = soloYears.map((y) => y.id);
        const groups = await tx.group.findMany({
          where: { schoolYearId: { in: soloYearIds } },
          select: { id: true, name: true },
        });
        for (const group of groups) {
          const taken = await tx.group.findFirst({
            where: { schoolYearId: targetYear.id, name: group.name },
            select: { id: true },
          });
          if (!taken) continue;
          const to = options.groupNameFor(group.name);
          await tx.group.update({ where: { id: group.id }, data: { name: to } });
          result.groupsRenamed.push({ from: group.name, to });
        }

        // 4. Everything in a solo school year moves to the target's current one.
        for (const fk of toYear) {
          if (fk.table === "school_years") continue;
          const n = await exec(
            `UPDATE "${fk.table}" SET "${fk.column}" = $1::uuid WHERE "${fk.column}" = ANY($2::uuid[])`,
            targetYear.id,
            soloYearIds,
          );
          if (n > 0) result.moved[`${fk.table}.${fk.column}`] = n;
        }

        // 5. Memberships: ADMIN dropped; the rest moved, or joined to the target's own.
        const memberships = await tx.membership.findMany({
          where: { kindergartenId: soloId, deletedAt: null },
          select: { id: true, userId: true, role: true },
        });
        const now = new Date();
        for (const m of memberships) {
          if (m.role === "ADMIN") {
            await tx.membership.update({
              where: { id: m.id },
              data: { isActive: false, deletedAt: now },
            });
            result.adminsDropped += 1;
            continue;
          }
          const existing = await tx.membership.findUnique({
            where: {
              userId_kindergartenId_role: {
                userId: m.userId,
                kindergartenId: targetId,
                role: m.role,
              },
            },
            select: { id: true },
          });
          if (!existing) {
            await tx.membership.update({ where: { id: m.id }, data: { kindergartenId: targetId } });
            result.membershipsMoved += 1;
            continue;
          }
          await tx.membership.update({
            where: { id: existing.id },
            data: { isActive: true, deletedAt: null },
          });
          for (const fk of toMembership) {
            await exec(
              `UPDATE "${fk.table}" SET "${fk.column}" = $1::uuid WHERE "${fk.column}" = $2::uuid`,
              existing.id,
              m.id,
            );
          }
          await tx.membership.update({
            where: { id: m.id },
            data: { isActive: false, deletedAt: now },
          });
          result.membershipsJoined += 1;
        }

        // 5b. One child, one record: each matched solo child's rows join the
        //     target child; the solo record is archived (the user, 2026-10-11).
        for (const pair of pairs) {
          await this.carryPaidFee(tx, pair.soloChildId, pair.targetChildId, targetYear.id);
          for (const fk of toChild) {
            if (fk.table === "audit_logs") continue; // append-only: history stays put
            await repoint(fk, pair.soloChildId, pair.targetChildId);
          }
          await tx.child.update({ where: { id: pair.soloChildId }, data: { deletedAt: now } });
        }

        // 5c. Into an existing group: its rows join that group; the solo group is archived.
        if (options.targetGroupId) {
          const soloGroups = await tx.group.findMany({
            where: { kindergartenId: soloId },
            select: { id: true },
          });
          for (const group of soloGroups) {
            await this.dropRepeatedAssignments(tx, group.id, options.targetGroupId, now);
            for (const fk of toGroup) {
              if (fk.table.startsWith("esis_")) continue;
              await repoint(fk, group.id, options.targetGroupId);
            }
            await tx.group.update({ where: { id: group.id }, data: { deletedAt: now } });
          }
        }

        // 6. Every MOVE table, re-parented.
        const moveKeys = toKindergarten.filter((f) => classify(f.table) === "MOVE");
        for (const fk of moveKeys) {
          const n = await exec(
            `UPDATE "${fk.table}" SET "${fk.column}" = $1::uuid WHERE "${fk.column}" = $2::uuid`,
            targetId,
            soloId,
          );
          if (n > 0) result.moved[`${fk.table}.${fk.column}`] = n;
        }

        // 7. The solo year and the solo row stay, archived.
        await tx.schoolYear.updateMany({
          where: { id: { in: soloYearIds }, deletedAt: null },
          data: { isCurrent: false, deletedAt: now },
        });
        await tx.kindergarten.update({
          where: { id: soloId },
          data: {
            mergedIntoId: targetId,
            mergedAt: solo.mergedIntoId ? undefined : now,
            deletedAt: solo.deletedAt ?? now,
            isActive: false,
          },
        });

        // 8. Nothing that should have moved is left behind.
        for (const fk of moveKeys) {
          if ((await count(fk, soloId)) > 0) {
            throw new Error(`Merge left rows in ${fk.table}.${fk.column}`);
          }
        }

        if (options.preview) throw new Rollback(result);
        return result;
      }, TX);
    } catch (error) {
      if (error instanceof Rollback) return error.result;
      const constraint = uniqueViolation(error);
      if (constraint) throw new MergeRefused({ kind: "conflict", constraint });
      throw error;
    }
  }
}

type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/** The constraint a unique violation names, from Postgres's 23505 — or `null`. */
function uniqueViolation(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  if (!/23505|unique constraint/i.test(text)) return null;
  return /constraint "?([a-zA-Z0-9_]+)"?/.exec(text)?.[1] ?? "unique";
}
