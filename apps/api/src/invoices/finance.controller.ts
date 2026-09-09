import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { FinanceBoardService } from "./finance-board.service";
import { FinanceDashboardService } from "./finance-dashboard.service";
import { FinanceReportPdfService } from "./finance-report-pdf.service";
import { FinanceReportsService } from "./finance-reports.service";
import {
  financeDashboardQuerySchema,
  financeReportQuerySchema,
  type FinanceDashboardQuery,
  type FinanceReportQuery,
} from "./invoices.dto";

/**
 * The financial dashboard and the §16 reports — `нэмэлт.md` §9, §10, §16.
 *
 * ★ **A file of its own, and that is the point.** These routes used to live in
 * `invoices.controller.ts`. The two invoice implementations that were merged on
 * 2026-09-01 both owned that filename, so resolving the merge replaced it
 * wholesale — and took §9, §10 and §16's routes with it, silently, while their
 * services and repositories survived untouched in files nobody had contested.
 * The endpoints came back as 404 and only the integration suite noticed.
 *
 * Keeping them here means the invoice CRUD surface can be replaced again
 * without taking the reporting surface with it.
 */
@Controller("kindergartens/:id/invoices")
@Roles("ADMIN", "ACCOUNTANT")
export class KindergartenFinanceController {
  constructor(
    private readonly dashboard: FinanceDashboardService,
    private readonly reports: FinanceReportsService,
    private readonly reportPdf: FinanceReportPdfService,
  ) {}

  /**
   * ★ `@Roles` gates the route; the services still check membership against the
   * kindergarten in the URL. The decorator alone would let an accountant
   * employed by one kindergarten read another's ledger by changing the id.
   *
   * ★★ **TEACHER is absent by design**, not by omission — `нэмэлт.md` §13:
   * "Багш санхүүгийн бүрэн мэдээллийг харах эрхгүй байна."
   */
  @Get("dashboard")
  async financeDashboard(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(financeDashboardQuerySchema)) query: FinanceDashboardQuery,
  ) {
    return this.dashboard.month(actor, params.id, query.month);
  }

  /** One of §16's reports, as data. */
  @Get("reports")
  async report(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(financeReportQuerySchema)) query: FinanceReportQuery,
  ) {
    return this.reports.table(actor, params.id, query.report, query.period);
  }

  /** The same report as a spreadsheet — §16's "Excel болон PDF экспорттой". */
  @Get("reports/export")
  async exportReport(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(financeReportQuerySchema)) query: FinanceReportQuery,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.reports.workbook(
      actor,
      params.id,
      query.report,
      query.period,
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /**
   * Queues a report as PDF.
   *
   * ★ A job, not a file. Chromium takes ~2.5 s and a gigabyte of memory
   * (CLAUDE.md §6), so this returns immediately with a job the screen polls.
   * The Excel export above is inline because ExcelJS is neither slow nor heavy.
   */
  @Post("reports/pdf")
  async queueReportPdf(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(financeReportQuerySchema)) body: FinanceReportQuery,
  ) {
    return this.reportPdf.enqueue(actor, params.id, body.report, body.period);
  }

  /** Recent PDF jobs for this kindergarten. */
  @Get("reports/pdf")
  async listReportPdfs(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.reportPdf.list(actor, params.id);
  }
}

/**
 * Нягтлангийн самбар — the accountant's landing screen. Client request,
 * 2026-09-09.
 *
 * ★ Its own path segment rather than a sixth route under `.../invoices`.
 * The board reads the funding calculations and the meal register as well as
 * the invoices; filing it under the invoice surface would have made the URL a
 * lie about what the screen is, and this controller's whole neighbour exists
 * because a merge once replaced a file whose name promised more than it held.
 *
 * ★★ Same gate as everything else in this file: `@Roles` on the route,
 * `assertCanReadFinance` in the service against the kindergarten in the URL.
 * TEACHER is absent by design — `нэмэлт.md` §13.
 */
@Controller("kindergartens/:id/finance")
@Roles("ADMIN", "ACCOUNTANT")
export class KindergartenFinanceBoardController {
  constructor(private readonly board: FinanceBoardService) {}

  @Get("board")
  async financeBoard(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(financeDashboardQuerySchema)) query: FinanceDashboardQuery,
  ) {
    return this.board.month(actor, params.id, query.month);
  }
}

/**
 * One child's finance tab — `нэмэлт.md` §10.
 *
 * ★ No `@Roles`: the service authorizes, because a guardian belongs here and a
 * teacher does not. A guardian's payload omits `funding` entirely rather than
 * hiding it in the UI — the state's payments are the kindergarten's revenue,
 * not the family's debt, and a hidden field is one devtools tab away from any
 * parent who looks.
 */
@Controller("children/:id/finance")
export class ChildFinanceController {
  constructor(private readonly dashboard: FinanceDashboardService) {}

  @Get()
  async summary(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.dashboard.child(actor, params.id);
  }
}

/**
 * One financial report PDF job — `нэмэлт.md` §16.
 *
 * ★ Separate from `ReportsController`, which serves child reports and gates
 * every route on `canAccessChild`. That predicate admits guardians and excludes
 * accountants — exactly backwards for a kindergarten's ledger — so these routes
 * check `assertCanReadFinance` instead, and refuse any job that is not a
 * `FINANCE_REPORT`.
 */
@Controller("finance-reports")
@Roles("ADMIN", "ACCOUNTANT")
export class FinanceReportPdfController {
  constructor(private readonly service: FinanceReportPdfService) {}

  @Get(":id")
  async status(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  /** A short-lived presigned link to the finished file. */
  @Get(":id/download")
  async download(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.downloadUrl(actor, params.id);
  }
}
