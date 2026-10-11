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
}

/** Why a merge stopped — everything rolled back. */
export type MergeRefusal =
  | { kind: "blocked"; tables: Record<string, number> }
  | { kind: "duplicates"; children: { soloChildId: string; targetChildId: string; name: string }[] }
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

  /** The merge, or — with `preview` — the same work rolled back, answering its counts. */
  async merge(
    soloId: string,
    targetId: string,
    options: { preview: boolean; groupNameFor: (name: string) => string },
  ): Promise<MergeResult> {
    const [toKindergarten, toYear, toMembership] = await Promise.all([
      this.foreignKeysInto("kindergartens"),
      this.foreignKeysInto("school_years"),
      this.foreignKeysInto("memberships"),
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

        // 2. The same child already on the target's roll (D3b attaches them).
        const duplicates = await tx.$queryRawUnsafe<
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
        if (duplicates.length > 0) {
          throw new MergeRefused({ kind: "duplicates", children: duplicates });
        }

        const result: MergeResult = {
          moved: {},
          membershipsMoved: 0,
          membershipsJoined: 0,
          adminsDropped: 0,
          groupsRenamed: [],
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

/** The constraint a unique violation names, from Postgres's 23505 — or `null`. */
function uniqueViolation(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  if (!/23505|unique constraint/i.test(text)) return null;
  return /constraint "?([a-zA-Z0-9_]+)"?/.exec(text)?.[1] ?? "unique";
}
