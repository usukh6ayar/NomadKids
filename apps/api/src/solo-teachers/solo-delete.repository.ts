import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SoloMergeRepository, type ForeignKey } from "./solo-merge.repository";

type Tx = Prisma.TransactionClient;

/** Long enough for ~90 deletes, retried in FK order, on a workspace's tables. */
const TX = { timeout: 120_000, maxWait: 10_000 };

/** What money says about a workspace: anything here and it is never purged. */
export interface MoneyMoved {
  paidAccessFees: number;
  paidQpayInvoices: number;
  payments: number;
  paidMaterialPurchases: number;
}

/** Thrown at the end of a preview so the transaction rolls back with the counts. */
class PurgePreview extends Error {
  constructor(readonly result: PurgeResult) {
    super("preview");
  }
}

export interface PurgeResult {
  /** Rows deleted, per table. Zero counts are left out. */
  deleted: Record<string, number>;
  usersDeleted: number;
  /** People kept because they have a life elsewhere — another kindergarten's rows. */
  usersKept: number;
  storageKeys: string[];
}

/**
 * Deleting a solo teacher's workspace — the user, 2026-10-18: the client's
 * trial left many made-up accounts, and the operator removes them.
 *
 * ★ Two ways, as asked. `softDelete` is CLAUDE.md §3.2's: the workspace, its
 * memberships and the people who belong nowhere else get `deletedAt`, and
 * nobody can sign in to it. `purge` is the one exception to §3.2 the user
 * made: the rows go — **only** for a workspace no money ever moved through
 * (§14: a financial record is never deleted), and **never** the audit log.
 *
 * ★★ The tables are found through foreign keys (`pg_constraint`), as the
 * merge finds them, so a table added later is purged without anyone
 * remembering to list it.
 */
@Injectable()
export class SoloDeleteRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merge: SoloMergeRepository,
  ) {}

  /** A solo workspace, live or already soft-deleted — `null` for anything else. */
  workspace(id: string) {
    return this.prisma.kindergarten.findFirst({
      where: { id, kind: "SOLO_TEACHER" },
      select: { id: true, name: true, deletedAt: true },
    });
  }

  /** The workspace's teacher — whose username the operator types to purge. */
  teacher(kindergartenId: string) {
    return this.prisma.membership.findFirst({
      where: { kindergartenId, role: "TEACHER" },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { id: true, username: true } } },
    });
  }

  async moneyMoved(kindergartenId: string): Promise<MoneyMoved> {
    const members = await this.memberIds(kindergartenId);
    const [paidAccessFees, paidQpayInvoices, payments, paidMaterialPurchases] = await Promise.all([
      this.prisma.accessSubscription.count({
        where: { kindergartenId, paidAt: { not: null }, amount: { gt: 0 } },
      }),
      this.prisma.qpayInvoice.count({ where: { kindergartenId, status: "PAID" } }),
      this.prisma.payment.count({ where: { kindergartenId } }),
      this.prisma.materialPurchase.count({
        where: { userId: { in: members }, status: "PAID", amount: { gt: 0 } },
      }),
    ]);
    return { paidAccessFees, paidQpayInvoices, payments, paidMaterialPurchases };
  }

  /**
   * §3.2's delete: the workspace, its memberships, and the people who belong
   * to no other live kindergarten. Sign-in re-reads `User.deletedAt` and
   * every request re-reads `Membership` (§1.3), so it takes effect at once.
   */
  async softDelete(kindergartenId: string, at: Date) {
    return this.prisma.$transaction(async (tx) => {
      const members = await tx.membership.findMany({
        where: { kindergartenId, deletedAt: null },
        select: { userId: true },
      });
      const userIds = [...new Set(members.map((m) => m.userId))];
      await tx.kindergarten.updateMany({
        where: { id: kindergartenId, deletedAt: null },
        data: { deletedAt: at },
      });
      const memberships = await tx.membership.updateMany({
        where: { kindergartenId, deletedAt: null },
        data: { deletedAt: at },
      });
      const users = await tx.user.updateMany({
        where: {
          id: { in: userIds },
          deletedAt: null,
          isSuperAdmin: false,
          memberships: { none: { deletedAt: null } },
        },
        data: { deletedAt: at },
      });
      return { memberships: memberships.count, users: users.count };
    });
  }

  /**
   * The workspace's rows, then the people who belong nowhere else — one
   * transaction. The storage keys are returned so the objects go after the
   * commit (a rolled-back purge must not have deleted a photo).
   *
   * ★ FK order is found by trying: each table's delete runs in a savepoint,
   * and one refused by a foreign key (23503) is retried after the others —
   * until nothing is left or no delete moves, which is a bug and rolls back.
   */
  async purge(kindergartenId: string, { preview = false } = {}): Promise<PurgeResult> {
    try {
      return await this.purgeInTransaction(kindergartenId, preview);
    } catch (error) {
      if (error instanceof PurgePreview) return error.result;
      throw error;
    }
  }

  /**
   * ★ A preview runs this very code and rolls back — so its counts can never
   * disagree with the purge, and it can be run against real data safely.
   */
  private async purgeInTransaction(kindergartenId: string, preview: boolean): Promise<PurgeResult> {
    const [intoKindergartens, intoUsers, restrictingUsers, kindergartenTables] = await Promise.all([
      this.merge.foreignKeysInto("kindergartens"),
      this.merge.foreignKeysInto("users"),
      this.restrictingKeysInto("users"),
      this.tablesWithKindergarten(),
    ]);
    // ★ Never the audit log: its FK is SET NULL, and its rows stay.
    const scoped = intoKindergartens.filter((fk) => fk.table !== "audit_logs");

    return this.prisma.$transaction(async (tx) => {
      const deleted: Record<string, number> = {};
      const memberIds = (
        await tx.membership.findMany({ where: { kindergartenId }, select: { userId: true } })
      ).map((m) => m.userId);
      const storageKeys = (
        await tx.mediaFile.findMany({ where: { kindergartenId }, select: { storageKey: true } })
      ).map((m) => m.storageKey);

      await deleteInFkOrder(
        tx,
        scoped.map((fk) => ({ ...fk, id: kindergartenId })),
        deleted,
      );
      const gone = await tx.$executeRawUnsafe(
        `DELETE FROM "kindergartens" WHERE "id" = $1::uuid`,
        kindergartenId,
      );
      if (gone !== 1) throw new Error(`purge: kindergarten ${kindergartenId} was not deleted`);
      deleted.kindergartens = 1;

      // The people: deleted only when nothing of theirs is left in any other
      // kindergarten — a CASCADE from `users` would otherwise take another
      // tenant's guardianships and survey answers with them.
      let usersDeleted = 0;
      let usersKept = 0;
      for (const userId of [...new Set(memberIds)]) {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { isSuperAdmin: true },
        });
        if (!user) continue;
        if (
          user.isSuperAdmin ||
          (await livesElsewhere(tx, userId, intoUsers, kindergartenTables))
        ) {
          usersKept += 1;
          continue;
        }
        // ★ Only what would refuse the delete — their agreement acceptances, an
        // unpaid purchase. A SET NULL key (a material they authored) and a
        // CASCADE (their sessions) are the database's to settle.
        await deleteInFkOrder(
          tx,
          restrictingUsers.map((fk) => ({ ...fk, id: userId })),
          deleted,
        );
        await tx.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = $1::uuid`, userId);
        usersDeleted += 1;
      }

      const result = { deleted, usersDeleted, usersKept, storageKeys };
      if (preview) throw new PurgePreview(result);
      return result;
    }, TX);
  }

  /** The foreign keys into `referenced` that refuse a delete (RESTRICT / NO ACTION). */
  private async restrictingKeysInto(referenced: string): Promise<ForeignKey[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ table: string; column: string }[]>(
      `SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
         FROM pg_constraint c
         JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND c.confdeltype IN ('r', 'a')
        ORDER BY 1, 2`,
      referenced,
    );
    const known = new Set((await this.merge.foreignKeysInto(referenced)).map(key));
    // The same identifier check the merge's keys passed.
    for (const fk of rows) {
      if (!known.has(key(fk))) throw new Error(`Unexpected foreign key: ${fk.table}.${fk.column}`);
    }
    return rows;
  }

  /** Every table with a `kindergartenId` column — a tenant's row, wherever it is. */
  private async tablesWithKindergarten(): Promise<Set<string>> {
    const rows = await this.prisma.$queryRawUnsafe<{ table: string }[]>(
      `SELECT table_name AS "table" FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'kindergartenId'`,
    );
    return new Set(rows.map((row) => row.table));
  }

  private async memberIds(kindergartenId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: { kindergartenId },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId))];
  }
}

/**
 * Whether `userId` has any row in a kindergarten other than the one purged —
 * every tenant-scoped table that points at users (§3.1 puts `kindergartenId`
 * on each). The purged workspace's rows are gone by now, so any match is
 * someone else's.
 */
async function livesElsewhere(
  tx: Tx,
  userId: string,
  intoUsers: ForeignKey[],
  kindergartenTables: Set<string>,
): Promise<boolean> {
  for (const fk of intoUsers) {
    if (fk.table === "audit_logs" || !kindergartenTables.has(fk.table)) continue;
    const [row] = await tx.$queryRawUnsafe<{ found: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM "${fk.table}" WHERE "${fk.column}" = $1::uuid) AS found`,
      userId,
    );
    if (row?.found) return true;
  }
  return false;
}

function key(fk: ForeignKey): string {
  return `${fk.table}.${fk.column}`;
}

async function deleteInFkOrder(
  tx: Tx,
  targets: (ForeignKey & { id: string })[],
  deleted: Record<string, number>,
): Promise<void> {
  let pending = targets;
  while (pending.length > 0) {
    const refused: typeof pending = [];
    for (const target of pending) {
      await tx.$executeRawUnsafe(`SAVEPOINT purge_step`);
      try {
        const count = await tx.$executeRawUnsafe(
          `DELETE FROM "${target.table}" WHERE "${target.column}" = $1::uuid`,
          target.id,
        );
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT purge_step`);
        if (count > 0) deleted[target.table] = (deleted[target.table] ?? 0) + count;
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT purge_step`);
        if (!isForeignKeyViolation(error)) throw error;
        refused.push(target);
      }
    }
    if (refused.length === pending.length) {
      throw new Error(
        `purge: no delete could move (${refused.map((t) => `${t.table}.${t.column}`).join(", ")})`,
      );
    }
    pending = refused;
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2003") ||
    /23503|foreign key constraint/i.test(text)
  );
}
