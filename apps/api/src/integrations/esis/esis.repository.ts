import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { Prisma } from "../../generated/prisma/client";

/**
 * The two kinds of sync run `esis-sync.service.ts` writes, matching the
 * `kind` field each one's `summary` JSON carries — `"REFERENCE"` from
 * `runReferenceSync`, `"ROSTER"` from `runRosterSync`. Named here, the lower
 * layer, rather than imported from the service, so this file does not depend
 * on the file that depends on it.
 */
export type EsisSyncKind = "REFERENCE" | "ROSTER";

@Injectable()
export class EsisRepository {
  constructor(private readonly prisma: PrismaService) {}

  findKindergarten(id: string) {
    return this.prisma.kindergarten.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        esisInstitutionId: true,
        esisEnvironment: true,
        esisMappedAt: true,
      },
    });
  }

  /**
   * The child an ESIS `personId` refers to, within one kindergarten.
   *
   * ★ This is an **authorization** lookup, so it deliberately does not filter
   * on `status` or anything else a screen might care about: a child who has
   * left is still a child whose record has an owner, and narrowing here would
   * quietly turn "you may not see this" into "this does not exist" for a
   * teacher who legitimately kept the record.
   *
   * ★★ `deletedAt: null` stays, per CLAUDE.md §2.2 — the base filter every
   * repository query carries. A soft-deleted child is not reachable by any
   * route, and an ESIS read must not be the exception that resurrects one.
   */
  findChildIdByEsisPersonId(kindergartenId: string, esisPersonId: string) {
    return this.prisma.child.findFirst({
      where: { kindergartenId, esisPersonId, deletedAt: null },
      select: { id: true },
    });
  }

  findUserIdentity(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { lastName: true, firstName: true, email: true },
    });
  }

  updateMapping(
    id: string,
    mapping:
      | { esisInstitutionId: null; esisEnvironment: null; esisMappedAt: null }
      | {
          esisInstitutionId: string;
          esisEnvironment: "TEST" | "PRODUCTION";
          esisMappedAt: Date;
        },
  ) {
    return this.prisma.kindergarten.update({
      where: { id },
      data: mapping,
      select: {
        id: true,
        esisInstitutionId: true,
        esisEnvironment: true,
        esisMappedAt: true,
      },
    });
  }

  findRunning(kindergartenId: string) {
    return this.prisma.esisSyncRun.findFirst({
      where: { kindergartenId, status: "RUNNING" },
      select: { id: true, startedAt: true },
    });
  }

  expireStaleRuns(kindergartenId: string, cutoff: Date) {
    return this.prisma.esisSyncRun.updateMany({
      where: { kindergartenId, status: "RUNNING", startedAt: { lt: cutoff } },
      data: {
        status: "FAILED",
        errorCode: "STALE_RUN_RECOVERED",
        finishedAt: new Date(),
      },
    });
  }

  /**
   * ★ `initiatedById` is `string | null` since 2026-09-16 — NULL is a
   * scheduled run, a person's id is a manual one. Both are the same kind of
   * row; only the initiator differs. See `EsisSyncRun.initiatedById`'s doc
   * comment for why NULL beats a fabricated system user.
   */
  createRun(kindergartenId: string, initiatedById: string | null, resources: string[]) {
    return this.prisma.esisSyncRun.create({
      data: { kindergartenId, initiatedById, resources },
      select: { id: true, status: true, startedAt: true },
    });
  }

  finishRun(
    id: string,
    data: {
      status: "SUCCEEDED" | "PARTIAL" | "FAILED";
      summary: Prisma.InputJsonValue;
      errorCode?: string | null;
    },
  ) {
    return this.prisma.esisSyncRun.update({
      where: { id },
      data: { ...data, finishedAt: new Date() },
    });
  }

  /**
   * Swaps one kindergarten's stored roster for the list ESIS just returned.
   *
   * ★ Delete-then-insert inside one transaction, so a reader never sees a
   * half-written roster and a failed refresh leaves the previous one intact.
   * A registration attempt landing mid-refresh must match against a complete
   * list or an old one, never a partial one.
   *
   * ★★ Hard delete. CLAUDE.md §3.2 protects records somebody may need to read
   * back; a superseded copy of somebody else's list is not one, and keeping
   * them would leave a person who has left the kindergarten able to register.
   * `AuditLog` records that the refresh happened and who ran it.
   */
  replaceStaffRoster(
    kindergartenId: string,
    rows: {
      esisPersonId: string;
      registerNumber: string;
      lastName: string;
      firstName: string;
      jobCode: string | null;
      positionName: string | null;
      isInstructor: boolean;
    }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.esisStaffRoster.deleteMany({ where: { kindergartenId } });
      if (rows.length === 0) return 0;
      const created = await tx.esisStaffRoster.createMany({
        data: rows.map((row) => ({ ...row, kindergartenId })),
      });
      return created.count;
    });
  }

  /**
   * The stored roster row for one kindergarten's register number, if any.
   *
   * ★ This is the only ESIS-derived read `POST /v1/staff-registration`
   * (`StaffRegistrationService`) is allowed to make — it is a public route
   * and must never call ESIS itself (design §1.1, plan §0). The compound
   * unique index (`kindergartenId`, `registerNumber`) is what makes this an
   * equality lookup rather than a scan, which only works because
   * `registerNumber` is stored normalised — see `normalizeRegisterNumber`.
   */
  findRosterEntryByRegisterNumber(kindergartenId: string, registerNumber: string) {
    return this.prisma.esisStaffRoster.findUnique({
      where: { kindergartenId_registerNumber: { kindergartenId, registerNumber } },
    });
  }

  /**
   * Swaps one resource's stored rows for the sweep that just came back.
   *
   * ★ Delete-then-insert in one transaction, not `upsert`. Prisma's generated
   * compound-unique `where` type (`kindergartenId_resource_externalId`) types
   * `kindergartenId` as non-nullable, so an `upsert` cannot express the
   * national shape (`kindergartenId: null`) at all — and if a cast made it
   * compile, Postgres treats NULLs as distinct in a unique index, so the
   * constraint would never match an existing national row and every sweep
   * would insert a fresh duplicate rather than replace one.
   * `replaceStaffRoster` above is the precedent this follows.
   *
   * ★★ Scoped by `kindergartenId` **including when it is NULL** — Prisma's
   * `null` in a `where` compiles to `IS NULL`, which is exactly the behaviour
   * wanted: a national catalogue's refresh must delete only the national rows
   * for `resource`, never an institution's rows for the same resource key,
   * and vice versa. Passing `null` here is not a bug to guard against.
   */
  replaceReference(
    kindergartenId: string | null,
    resource: string,
    rows: { externalId: string; payload: Prisma.InputJsonValue }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.esisReference.deleteMany({ where: { kindergartenId, resource } });
      if (rows.length === 0) return 0;
      const created = await tx.esisReference.createMany({
        data: rows.map((row) => ({
          kindergartenId,
          resource,
          externalId: row.externalId,
          payload: row.payload,
        })),
      });
      return created.count;
    });
  }

  /**
   * ★ `findNationalReference` and `findInstitutionReference` are two methods
   * rather than one taking a nullable `kindergartenId`, on purpose: a single
   * method invites a caller to pass whatever variable is in scope, and a
   * `kindergartenId` that is `undefined` by mistake would silently widen a
   * `findMany` from "this tenant's rows" to "every tenant's" — the same class
   * of leak CLAUDE.md §2.2 forbids. Splitting the method makes "which tenant"
   * a choice of *function name*, not of argument, so a caller reading another
   * tenant's rows would have had to call the wrong one by name.
   */
  findNationalReference(resource: string, page: { skip: number; take: number }) {
    return this.prisma.esisReference.findMany({
      where: { kindergartenId: null, resource },
      orderBy: { externalId: "asc" },
      skip: page.skip,
      take: page.take,
    });
  }

  findInstitutionReference(
    kindergartenId: string,
    resource: string,
    page: { skip: number; take: number },
  ) {
    return this.prisma.esisReference.findMany({
      where: { kindergartenId, resource },
      orderBy: { externalId: "asc" },
      skip: page.skip,
      take: page.take,
    });
  }

  /** When `resource` was last swept for this scope, or `null` if never. */
  async referenceSyncedAt(kindergartenId: string | null, resource: string): Promise<Date | null> {
    const row = await this.prisma.esisReference.findFirst({
      where: { kindergartenId, resource },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    });
    return row?.syncedAt ?? null;
  }

  /**
   * The most recently finished **SUCCEEDED** run of one kind, for one
   * kindergarten — or `null` if there has never been one.
   *
   * ★ Filtered on `summary.kind`, a JSON path lookup, not a column.
   * `runReferenceSync` already writes `{ kind: "REFERENCE", … }` into
   * `summary`, and `runRosterSync` writes `{ kind: "ROSTER", … }` the same
   * way — a `kind` column would duplicate a fact the JSON the run already
   * carries. This is also what keeps the two tiers from being confused for
   * each other: a kindergarten's monthly reference sweep finishes SUCCEEDED
   * far more reliably than a daily roster pull ever will, and without this
   * filter its timestamp would win the "most recent success" race for a
   * caller that actually wanted the roster's.
   *
   * ★★ `status: "SUCCEEDED"` only. A run that finished PARTIAL or FAILED
   * did not produce a trustworthy roster, so its timestamp must not become
   * the anchor a later `beginDate` is computed from — that would silently
   * narrow the window past a gap `runRosterSync` never actually filled.
   */
  lastSuccessfulRun(kindergartenId: string, kind: EsisSyncKind) {
    return this.prisma.esisSyncRun.findFirst({
      where: { kindergartenId, status: "SUCCEEDED", summary: { path: ["kind"], equals: kind } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
  }

  listRecentRuns(kindergartenId: string) {
    return this.prisma.esisSyncRun.findMany({
      where: { kindergartenId },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        resources: true,
        summary: true,
        errorCode: true,
        startedAt: true,
        finishedAt: true,
        initiatedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }
}
