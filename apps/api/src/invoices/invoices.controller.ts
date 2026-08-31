import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { FinanceDashboardService } from "./finance-dashboard.service";
import { FinanceReportPdfService } from "./finance-report-pdf.service";
import { FinanceReportsService } from "./finance-reports.service";
import { InvoicesService } from "./invoices.service";
import {
  createInvoiceSchema,
  financeDashboardQuerySchema,
  financeReportQuerySchema,
  generateInvoicesSchema,
  listInvoicesSchema,
  recordPaymentSchema,
  reversePaymentSchema,
  updateInvoiceSchema,
  type CreateInvoiceDto,
  type FinanceDashboardQuery,
  type FinanceReportQuery,
  type GenerateInvoicesDto,
  type ListInvoicesQuery,
  type RecordPaymentDto,
  type ReversePaymentDto,
  type UpdateInvoiceDto,
} from "./invoices.dto";

/**
 * A kindergarten's parent invoices — `нэмэлт.md` §7, §8.
 *
 * ★ `@Roles("ADMIN", "ACCOUNTANT")` gates the route; the service still checks
 * the membership against the kindergarten in the URL. The decorator alone would
 * let an accountant employed by one kindergarten read another's billing by
 * changing the id — the same reasoning `KindergartenFundingController` records.
 *
 * ★★ **TEACHER is absent by design**, not by omission — `нэмэлт.md` §13: "Багш
 * санхүүгийн бүрэн мэдээллийг харах эрхгүй байна."
 */
@Controller("kindergartens/:id/invoices")
@Roles("ADMIN", "ACCOUNTANT")
export class KindergartenInvoicesController {
  constructor(
    private readonly service: InvoicesService,
    private readonly dashboard: FinanceDashboardService,
    private readonly reports: FinanceReportsService,
    private readonly reportPdf: FinanceReportPdfService,
  ) {}

  /**
   * The month's financial summary — `нэмэлт.md` §9.
   *
   * ★ Registered **before** `@Get()` matters not at all here (the paths differ),
   * but the placement is deliberate for reading: the dashboard is what an
   * accountant opens first, and the list is what they drill into.
   */
  @Get("dashboard")
  async financeDashboard(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(financeDashboardQuerySchema)) query: FinanceDashboardQuery,
  ) {
    return this.dashboard.month(actor, params.id, query.month);
  }

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listInvoicesSchema)) query: ListInvoicesQuery,
  ) {
    return this.service.list(actor, params.id, query);
  }

  /**
   * One of §16's reports, as data.
   *
   * ★ "Ирц–санхүүжилтийн тулгалт" is absent from the list on purpose: it is
   * the monthly register, which already has its own screen and its own export
   * at `/funding/register`. A second answer to one question is worse than none.
   */
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
   * Queues a report as PDF — §16's "Excel болон PDF экспорттой".
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

  /** A month's invoices for every enrolled child — §7. */
  @Post("generate")
  async generate(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(generateInvoicesSchema)) body: GenerateInvoicesDto,
  ) {
    return this.service.generate(actor, params.id, body);
  }

  @Post()
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: CreateInvoiceDto,
  ) {
    return this.service.create(actor, params.id, body);
  }
}

/**
 * One invoice, and the payments against it.
 *
 * ★ Not under `/kindergartens/:id`, and **not** `@Roles`-gated to staff.
 *
 * A parent opens their own child's invoice here, so the route cannot demand a
 * finance role at the decorator — the service authorizes instead, admitting
 * finance staff of the owning kindergarten or one of the child's guardians and
 * returning 404 to everyone else including the child's own teacher (§13).
 *
 * The write routes each re-check `assertCanManageFinance` inside the service,
 * so a guardian reaching them gets a 404 rather than a partial edit.
 */
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get(":id")
  async findOne(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.findOne(actor, params.id);
  }

  @Patch(":id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateInvoiceSchema)) body: UpdateInvoiceDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Delete(":id")
  async remove(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.remove(actor, params.id);
  }

  /** Money received outside a payment provider — §8. */
  @Post(":id/payments")
  async recordPayment(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(recordPaymentSchema)) body: RecordPaymentDto,
  ) {
    return this.service.recordPayment(actor, params.id, body);
  }
}

/**
 * Reversing a payment — `нэмэлт.md` §14.
 *
 * A separate controller because the resource is the **payment**, not the
 * invoice: `POST /payments/:id/reverse` reads as what it does, and nesting it
 * under the invoice would invite a future `DELETE /invoices/:id/payments/:pid`
 * that §14 forbids outright.
 */
@Controller("payments")
@Roles("ADMIN", "ACCOUNTANT")
export class PaymentsController {
  constructor(private readonly service: InvoicesService) {}

  @Post(":id/reverse")
  async reverse(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(reversePaymentSchema)) body: ReversePaymentDto,
  ) {
    return this.service.reversePayment(actor, params.id, body);
  }
}

/**
 * A child's own invoices — the parent's view and `нэмэлт.md` §10's finance tab.
 *
 * Authorized on the child, then narrowed to guardians and finance staff inside
 * the service.
 */
@Controller("children/:id/invoices")
export class ChildInvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listInvoicesSchema)) query: ListInvoicesQuery,
  ) {
    return this.service.listForChild(actor, params.id, query);
  }
}

/**
 * One child's finance summary — `нэмэлт.md` §10.
 *
 * ★ Separate from the invoice list above because it answers a different
 * question: the list is "which bills exist", this is "where does this family
 * stand". A guardian gets the balance, what has been billed and paid, and the
 * discounts; finance staff additionally get the state funding history, which is
 * the kindergarten's revenue rather than the family's debt — see the service.
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
