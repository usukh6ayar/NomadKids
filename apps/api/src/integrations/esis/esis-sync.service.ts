import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Actor } from "../../authz/actor";
import { TenantAccessService } from "../../authz/tenant-access.service";
import { paginate, toSkipTake, type PageParams } from "../../common/pagination";
import { EsisAdminService } from "./esis-admin.service";
import { EsisError } from "./esis.client";
import { EsisRepository, type EsisSyncKind } from "./esis.repository";
import { externalIdFor, REFERENCE_RESOURCES, type EsisReferenceResource } from "./esis.reference";
import { esisVisibleRows } from "./esis.schemas";
import { EsisService } from "./esis.service";
import type { EsisSyncTierDto } from "./esis.dto";

/*
 * ★ A local JSON type, not `Prisma.InputJsonValue` — this file is a service,
 * not a `*.repository.ts`, and CLAUDE.md §2.2's ESLint rule blocks the whole
 * `generated/prisma` tree here with no carve-out. Structurally the two types
 * describe the same shape, so a value typed against this one still satisfies
 * `EsisRepository.replaceReference`'s Prisma-typed parameter at the call
 * below; only the repository file is allowed to name the Prisma type itself.
 */
type JsonValue = string | number | boolean | JsonValue[] | { [key: string]: JsonValue | null };

/** One resource's outcome within a reference sweep. */
export interface ReferenceSyncResourceResult {
  resource: string;
  status: "SUCCEEDED" | "FAILED";
  stored: number;
  skipped: number;
  errorCode: string | null;
}

export interface ReferenceSyncOutcome {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  results: ReferenceSyncResourceResult[];
}

/**
 * The resources `runRosterSync` reads — passed to `createRun` the same way
 * `REFERENCE_RESOURCES` is.
 *
 * ★ Exported so `test/esis-sync.test.ts` can assert against this exact list
 * rather than a hand-copied one — "no scheduled sweep reaches a per-child
 * resource" is only as good as its coverage of what `runRosterSync` actually
 * touches, and a constant a test can import cannot drift from the code path
 * it describes the way a second, hand-maintained list could.
 *
 * ★★ **This array is a label, not the calls themselves.** `staff` and
 * `teachers` are read inside `refreshStaffRosterCore`, `studentMovements`
 * inside `runRosterSync` below — both as string literals, not by iterating
 * this constant. So the two can drift: a fifth read added to either method
 * without updating this list would slip past the per-child guard above
 * without either failing. `"stores the staff roster and records a run whose
 * summary names the roster kind"` in `test/esis-sync.test.ts` closes that gap
 * by asserting the *observed* `this.esis.read` calls equal this set, not just
 * that this set itself contains no per-child reader.
 */
export const ROSTER_RESOURCES = ["staff", "teachers", "studentMovements"] as const;

/**
 * How far back `studentMovements` looks when there has never been a
 * successful roster run for this kindergarten to anchor on.
 *
 * ★ **Seven days, not a fixed calendar window or "since forever".** The
 * roster itself carries no correctness burden from this choice —
 * `refreshStaffRosterCore` replaces the whole staff table every run, so
 * `studentMovements` is read only to tell an operator how many enrolments
 * moved since the roster was last known current (see `runRosterSync`'s doc
 * comment). A week is enough to answer "quiet" or "busy" without asking the
 * ministry for months of history the one time this fallback is used — every
 * run after the first has a real prior run to anchor on instead, and this
 * job is scheduled nightly (plan Task 8), so the fallback is a first-boot
 * concern, not a steady-state one.
 */
export const ROSTER_MOVEMENTS_FALLBACK_DAYS = 7;

/** One roster sync's outcome. */
export interface RosterSyncOutcome {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  roster: { stored: number; skipped: number };
  movements: { beginDate: string; count: number | null; errorCode: string | null };
}

/**
 * Sweeps `REFERENCE_RESOURCES` and stores the answer in `EsisReference`.
 *
 * ★ This is tier 1 (plan §0). It exists so a screen that needs a ministry
 * catalogue reads a table instead of calling ESIS on every open — see
 * `EsisReference`'s doc comment for the 1000-row `cook/product` argument that
 * settled it.
 */
@Injectable()
export class EsisSyncService {
  constructor(
    private readonly esis: EsisService,
    private readonly repo: EsisRepository,
    /*
     * ★ For `refreshStaffRosterCore` — `runRosterSync`'s staff-roster half is
     * spec №2's work (plan §"What it does"), not rebuilt here. See that
     * method's doc comment in `esis-admin.service.ts` for why the extraction
     * exists rather than a second implementation of the same read.
     */
    private readonly admin: EsisAdminService,
    /*
     * ★ For `sync` and `listRuns` (plan Task 5) — the only two entry points
     * on this service that take an `Actor` rather than a bare
     * `kindergartenId`. `runReferenceSync` and `runRosterSync` stay
     * unauthorized on purpose (see `assertOperable`'s doc comment): the
     * scheduler (Task 8) has no actor to check, so the tenant scope has to
     * live at the one caller that does.
     */
    private readonly tenants: TenantAccessService,
  ) {}

  /**
   * The manual pull behind `POST …/esis/sync` — ADMIN only, one kindergarten.
   *
   * ★ Calls the **same** `runReferenceSync` / `runRosterSync` the scheduler
   * will (plan Task 8), with `actor.userId` where the schedule would pass
   * `null`. That is the whole point of Task 5: a manual run and a scheduled
   * one are the same kind of row, distinguished only by who asked.
   */
  async sync(actor: Actor, kindergartenId: string, tier: EsisSyncTierDto["tier"]) {
    this.tenants.assertAdmin(actor, kindergartenId);
    if (tier === "REFERENCE") {
      return this.runReferenceSync({ kindergartenId, actorUserId: actor.userId });
    }
    return this.runRosterSync({ kindergartenId, actorUserId: actor.userId });
  }

  /**
   * The history behind `GET …/esis/sync-runs` — newest first, paginated
   * (CLAUDE.md §3.4).
   *
   * ★ `initiatedBy` renders a name or `null`, matching
   * `EsisAdminService.overview()`'s own convention for the same fact — never
   * the empty string a missing `?.` would otherwise produce. `null` is a
   * scheduled run (`EsisSyncRun.initiatedById` is nullable since Task 1);
   * turning that into the Mongolian "хуваарь" is the screen's job, not this
   * one's — see `apps/web/app/(app)/platform/[id]/esis/page.tsx`'s
   * `RunHistory`, which already does exactly that for `overview()`'s runs.
   */
  async listRuns(actor: Actor, kindergartenId: string, page: PageParams) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const { skip, take } = toSkipTake(page);
    const { items, total } = await this.repo.listRuns(kindergartenId, { skip, take });
    return paginate(
      items.map((run) => ({
        ...run,
        initiatedBy: run.initiatedBy
          ? `${run.initiatedBy.lastName} ${run.initiatedBy.firstName}`.trim()
          : null,
      })),
      total,
      page,
    );
  }

  /**
   * Runs the whole closed list once, replacing each resource's stored rows.
   *
   * ★ `actorUserId` is `null` for a scheduled sweep — `EsisSyncRun.
   * initiatedById`'s nullability exists for exactly this caller. A manual
   * pull (Task 5) and the scheduler (Task 8) call this same method with the
   * only difference being who they pass here; there is deliberately no second
   * code path that runs the sweep "for a person" differently.
   */
  async runReferenceSync(params: {
    kindergartenId: string;
    actorUserId: string | null;
  }): Promise<ReferenceSyncOutcome> {
    const { kindergartenId, actorUserId } = params;
    const { institutionId } = await this.assertOperable(kindergartenId);

    /*
     * ★ The run-lock preamble, copied from `EsisAdminService.preview` rather
     * than invented afresh — `expireStaleRuns`, `findRunning`, `createRun`,
     * and the `isUniqueViolation` catch for the race between the two. A
     * second locking scheme here would mean two places deciding whether a
     * sync may start, which is the thing a lock exists to prevent.
     */
    await this.repo.expireStaleRuns(kindergartenId, new Date(Date.now() - 15 * 60_000));
    if (await this.repo.findRunning(kindergartenId)) {
      throw new ConflictException("Энэ цэцэрлэгийн ESIS синк аль хэдийн ажиллаж байна.");
    }

    let run;
    try {
      run = await this.repo.createRun(
        kindergartenId,
        actorUserId,
        REFERENCE_RESOURCES.map((entry) => entry.resource),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Энэ цэцэрлэгийн ESIS синк аль хэдийн ажиллаж байна.");
      }
      throw error;
    }

    /*
     * ★ `Promise.allSettled`, not `Promise.all` — one resource's failure must
     * not cancel the other twelve reads already in flight or abandon rows
     * that would otherwise have stored cleanly. `preview` uses the same
     * combinator for the same reason.
     */
    const settled = await Promise.allSettled(
      REFERENCE_RESOURCES.map((entry) => this.syncOne(entry, kindergartenId, institutionId)),
    );

    const results: ReferenceSyncResourceResult[] = settled.map((item, index) => {
      const resource = REFERENCE_RESOURCES[index]!.resource;
      if (item.status === "fulfilled") {
        return { resource, status: "SUCCEEDED", ...item.value, errorCode: null };
      }
      return {
        resource,
        status: "FAILED",
        stored: 0,
        skipped: 0,
        errorCode: safeErrorCode(item.reason),
      };
    });

    const successCount = results.filter((result) => result.status === "SUCCEEDED").length;
    const status =
      successCount === results.length ? "SUCCEEDED" : successCount === 0 ? "FAILED" : "PARTIAL";

    /*
     * ★ Cast through `unknown` — a named interface's array member has no
     * index signature, which is all that is structurally missing between
     * `ReferenceSyncResourceResult[]` and `JsonValue[]`; every value in
     * `results` is already plain JSON.
     */
    const summary = {
      kind: "REFERENCE" as const,
      resources: results,
    } as unknown as JsonValue;

    await this.repo.finishRun(run.id, {
      status,
      summary,
      errorCode: status === "SUCCEEDED" ? null : "ONE_OR_MORE_RESOURCES_FAILED",
    });

    return { runId: run.id, status, results };
  }

  /**
   * Tier 2 (plan §0, Task 4): the daily roster refresh.
   *
   * ★ `actorUserId` is `null` for the nightly schedule, exactly as
   * `runReferenceSync` above — one method, called by Task 5's manual route
   * and Task 8's scheduler with only the initiator differing.
   *
   * Does two things:
   *
   * 1. Refreshes `EsisStaffRoster` via `EsisAdminService.
   *    refreshStaffRosterCore` — spec №2's work, reused rather than rewritten
   *    (see that method's doc comment for why it is a separate method from
   *    the ADMIN-gated `refreshStaffRoster` rather than a loosened version of
   *    it).
   * 2. Reads `studentMovements` since the last successful roster run and
   *    counts the rows.
   *
   * ★★ **`studentMovements` is read and not stored.** There is no table for
   * it and this plan does not add one — it exists purely so the run summary
   * can report how many enrolments moved, which is what tells an operator
   * whether the roster in front of them is current or has been stale for a
   * week. A read whose result is only counted looks like dead code to
   * whoever finds it next without this line: the count is the point, not a
   * side effect of some other reason to call it.
   */
  async runRosterSync(params: {
    kindergartenId: string;
    actorUserId: string | null;
  }): Promise<RosterSyncOutcome> {
    const { kindergartenId, actorUserId } = params;
    const { institutionId } = await this.assertOperable(kindergartenId);

    // Same run-lock preamble as `runReferenceSync` — one lock per kindergarten,
    // regardless of tier, so a roster pull and a reference sweep never overlap
    // and contend for the deployment's one rate-limited token.
    await this.repo.expireStaleRuns(kindergartenId, new Date(Date.now() - 15 * 60_000));
    if (await this.repo.findRunning(kindergartenId)) {
      throw new ConflictException("Энэ цэцэрлэгийн ESIS синк аль хэдийн ажиллаж байна.");
    }

    let run;
    try {
      run = await this.repo.createRun(kindergartenId, actorUserId, [...ROSTER_RESOURCES]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Энэ цэцэрлэгийн ESIS синк аль хэдийн ажиллаж байна.");
      }
      throw error;
    }

    let roster: { count: number; skipped: number };
    try {
      roster = await this.admin.refreshStaffRosterCore(kindergartenId, actorUserId);
    } catch (error) {
      /*
       * ★ The roster refresh is the part this sync exists for; if it failed,
       * nothing was stored and the run is FAILED outright — there is no
       * partial success to report the way a reference sweep's thirteen
       * independent resources have.
       */
      await this.repo.finishRun(run.id, {
        status: "FAILED",
        summary: { kind: "ROSTER" as const, roster: null, movements: null } as unknown as JsonValue,
        errorCode: safeErrorCode(error),
      });
      throw error;
    }

    const beginDate = await this.rosterBeginDate(kindergartenId);

    /*
     * ★ Read and discarded — see this method's doc comment. A failure here
     * must not undo a roster refresh that already succeeded and already
     * committed, so it does not rethrow — but it also must not finish
     * SUCCEEDED, or `lastSuccessfulRun` would anchor tomorrow's window on a
     * run that never actually read one, silently skipping the gap forever
     * (see `EsisRepository.lastSuccessfulRun`'s "SUCCEEDED only" note — this
     * is the case that note exists to keep out). PARTIAL says "the roster is
     * current, the movement count is not" and, being excluded from
     * `lastSuccessfulRun`, leaves the next run to re-read the same window
     * rather than skip past it.
     */
    let movementCount: number | null = null;
    let movementsErrorCode: string | null = null;
    try {
      const response = await this.esis.read("studentMovements", { beginDate }, institutionId);
      movementCount = response.data.length;
    } catch (error) {
      movementsErrorCode = safeErrorCode(error);
    }

    const status: "SUCCEEDED" | "PARTIAL" = movementsErrorCode === null ? "SUCCEEDED" : "PARTIAL";

    const summary = {
      kind: "ROSTER" as const,
      roster: { stored: roster.count, skipped: roster.skipped },
      movements: { beginDate, count: movementCount, errorCode: movementsErrorCode },
    } as unknown as JsonValue;

    await this.repo.finishRun(run.id, { status, summary, errorCode: movementsErrorCode });

    return {
      runId: run.id,
      status,
      roster: { stored: roster.count, skipped: roster.skipped },
      movements: { beginDate, count: movementCount, errorCode: movementsErrorCode },
    };
  }

  /**
   * How far back `studentMovements` looks: since the **last successful
   * roster run** (`kind: "ROSTER"` in `EsisSyncRun.summary`), or
   * `ROSTER_MOVEMENTS_FALLBACK_DAYS` back when there has never been one.
   *
   * ★ `lastSuccessfulRun` filters on kind precisely so a kindergarten's
   * monthly reference sweep — which finishes SUCCEEDED far more reliably
   * than a daily roster pull — can never be picked up here by mistake. See
   * `EsisRepository.lastSuccessfulRun`'s doc comment.
   */
  private async rosterBeginDate(kindergartenId: string): Promise<string> {
    const kind: EsisSyncKind = "ROSTER";
    const lastRun = await this.repo.lastSuccessfulRun(kindergartenId, kind);
    const anchor =
      lastRun?.finishedAt ??
      new Date(Date.now() - ROSTER_MOVEMENTS_FALLBACK_DAYS * 24 * 60 * 60_000);
    return anchor.toISOString().slice(0, 10);
  }

  /**
   * Reads one resource, stores it, and reports what happened.
   *
   * ★ `identifiers: false` even for a national catalogue — deliberate, not an
   * oversight. A catalogue has no register numbers; if one ever appears in a
   * response, `EsisReference` is not where it should first be stored, so the
   * gate stays closed regardless of scope.
   */
  private async syncOne(
    entry: EsisReferenceResource,
    kindergartenId: string,
    institutionId: string,
  ): Promise<{ stored: number; skipped: number }> {
    const response = await this.esis.read(entry.resource, {}, institutionId);
    const visible = esisVisibleRows(response.data, { identifiers: false });

    let skipped = 0;
    const rows: { externalId: string; payload: JsonValue }[] = [];
    for (const row of visible) {
      const externalId = externalIdFor(entry.resource, row);
      if (externalId === null) {
        skipped += 1;
        continue;
      }
      rows.push({ externalId, payload: row as unknown as JsonValue });
    }

    const scopeKindergartenId = entry.scope === "NATIONAL" ? null : kindergartenId;
    const stored = await this.repo.replaceReference(scopeKindergartenId, entry.resource, rows);
    return { stored, skipped };
  }

  /**
   * Whether a sweep can be attempted for this tenant, and under which id.
   *
   * ★ Duplicated from `EsisAdminService`'s private method of the same name
   * rather than shared, because sharing it would mean exporting a private
   * method out of a file this task does not otherwise touch. Both check the
   * same three things — kindergarten exists, the deployment is configured,
   * the tenant is mapped — and authorization is still not here: the caller
   * (Task 5's route, Task 8's scheduler) decides who may trigger a sweep.
   */
  private async assertOperable(kindergartenId: string) {
    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();
    if (!this.esis.isConfigured) {
      throw new ConflictException("ESIS холболт server дээр тохируулагдаагүй байна.");
    }
    if (!kindergarten.esisInstitutionId) {
      throw new ConflictException("Цэцэрлэгийн ESIS байгууллагын код баталгаажаагүй байна.");
    }
    return { institutionId: kindergarten.esisInstitutionId };
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof EsisError) {
    if (error.kind === "http" && error.detail.status === 401) return "UNAUTHORIZED";
    if (error.kind === "http" && error.detail.status === 403) return "SCOPE_DENIED";
    return error.kind.toUpperCase();
  }
  return "UNKNOWN";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
