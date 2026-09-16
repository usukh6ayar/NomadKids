import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EsisError } from "./esis.client";
import { EsisRepository } from "./esis.repository";
import { externalIdFor, REFERENCE_RESOURCES, type EsisReferenceResource } from "./esis.reference";
import { esisVisibleRows } from "./esis.schemas";
import { EsisService } from "./esis.service";

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
  ) {}

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
