import { Injectable } from "@nestjs/common";
import type { Actor } from "../../authz/actor";
import { TenantAccessService } from "../../authz/tenant-access.service";
import { buildEsisCoverage, type EsisCoverageMatrix } from "./esis-coverage";
import { buildEsisCoverageWorkbook } from "./esis-coverage-workbook";
import { EsisRepository } from "./esis.repository";

/**
 * The evidence the ministry reads — spec `2026-09-15-esis-full-coverage-design`
 * §7.
 *
 * ★ **Nothing here calls ESIS.** The matrix is built from `AuditLog` and
 * `EsisSyncRun`, both of which are records of calls that already happened. A
 * report that had to reach the ministry to say how often we reached the
 * ministry would be the joke version of itself — and during a watched trial
 * month it would add traffic with no purpose a reviewer could name.
 */
@Injectable()
export class EsisCoverageService {
  constructor(
    private readonly tenants: TenantAccessService,
    private readonly repo: EsisRepository,
  ) {}

  /**
   * ★ ADMIN only. This is the document a director hands the ministry about
   * their own institution, and it names every service the deployment can
   * reach — a teacher has no use for it and a parent still less.
   */
  async matrix(actor: Actor, kindergartenId: string, months = 1): Promise<EsisCoverageMatrix> {
    this.tenants.assertAdmin(actor, kindergartenId);

    const to = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - months);

    const [usage, syncRuns] = await Promise.all([
      this.repo.countEsisCallsByService(kindergartenId),
      this.repo.listSyncRunResources(kindergartenId, from),
    ]);

    return buildEsisCoverage({
      from,
      to,
      usage,
      /*
       * ★ `resources` is `Json` in the schema, so it arrives as `unknown`. It is
       * written by `createRun` as a `string[]` and by nothing else, but the cast
       * is narrowed rather than asserted: a row whose shape surprised us would
       * contribute nothing rather than throwing in the middle of a report.
       */
      syncRuns: syncRuns.map((run) => ({
        resources: Array.isArray(run.resources)
          ? run.resources.filter((value): value is string => typeof value === "string")
          : [],
        startedAt: run.startedAt,
      })),
    });
  }

  async workbook(
    actor: Actor,
    kindergartenId: string,
    months = 1,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const matrix = await this.matrix(actor, kindergartenId, months);
    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    const buffer = await buildEsisCoverageWorkbook(matrix, kindergarten?.name ?? "");
    return { buffer, filename: `esis-coverage-${matrix.to.slice(0, 10)}.xlsx` };
  }
}
