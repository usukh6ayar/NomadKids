import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { localDate } from "@kinder/contracts";
import Decimal from "decimal.js";
import { AuditRepository } from "../audit/audit.repository";
import type { Actor } from "../authz/actor";
import { PlatformAccessService } from "../authz/platform-access.service";
import { ContractPaymentsRepository } from "./contract-payments.repository";
import type {
  ListContractPaymentsQuery,
  RecordTransferDto,
  SetEbarimtDto,
} from "./contract-payments.dto";

/**
 * The platform operator's side of contract payments — the client,
 * 2026-10-18: most kindergartens are state ones, which pay against an invoice
 * by bank transfer, and the operator issues the e-receipt on ebarimt by hand.
 *
 * ★ A recorded transfer runs the same settlement QPay's reconcile does
 * (`settleContractPayment`): the period is PAID once, the contract runs to
 * its end, and the platform's revenue and the partners' shares count it.
 *
 * ★★ Superadmin only — `assertSuperAdmin` first in every method, 404 for
 * anyone else (§1.7). Nothing here reads a child.
 */
@Injectable()
export class ContractPaymentsService {
  private readonly logger = new Logger(ContractPaymentsService.name);

  constructor(
    private readonly repo: ContractPaymentsRepository,
    private readonly platform: PlatformAccessService,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: Actor, query: ListContractPaymentsQuery) {
    this.platform.assertSuperAdmin(actor);
    const { rows, total } = await this.repo.list({
      status: query.status,
      ebarimtMissing: query.ebarimt === "missing",
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        kindergarten: row.kindergarten,
        contractNumber: row.contract.number,
        initial: row.initial,
        period: row.period === "TERM" ? "term" : "year",
        coversFrom: row.coversFrom.toISOString().slice(0, 10),
        coversTo: row.coversTo.toISOString().slice(0, 10),
        groupCount: row.groupCount,
        amount: row.amount.toFixed(2),
        status: row.status,
        method: row.method,
        paidAt: row.paidAt,
        reference: row.reference,
        ebarimtNumber: row.ebarimtNumber,
        createdAt: row.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** A transfer seen on the statement: the period is paid, the contract runs on. */
  async recordTransfer(actor: Actor, id: string, dto: RecordTransferDto) {
    this.platform.assertSuperAdmin(actor);
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException();
    if (row.status === "PAID") throw new ConflictException("Энэ төлбөр аль хэдийн бүртгэгдсэн.");
    if (dto.paidOn > localDate()) {
      throw new BadRequestException("Төлсөн огноо ирээдүйд байж болохгүй.");
    }

    const amount = new Decimal(dto.amount).toFixed(2);
    const result = await this.repo.recordTransfer(id, {
      // Noon UTC: the day stays the day in the revenue's UTC month bounds.
      paidAt: new Date(`${dto.paidOn}T12:00:00.000Z`),
      amount,
      reference: dto.reference || null,
      ebarimtNumber: dto.ebarimtNumber ?? null,
      recordedById: actor.userId,
    });
    // Paid by QPay, or recorded in another tab, between the read and the claim.
    if (!result.claimed) throw new ConflictException("Энэ төлбөр аль хэдийн бүртгэгдсэн.");
    if (result.overlaps) {
      this.logger.error(
        `Contract payment ${id} overlaps another paid period of its contract; refund or credit by hand`,
      );
    }

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: row.kindergartenId,
      actorUserId: actor.userId,
      objectType: "ContractPayment",
      objectId: id,
      metadata: {
        before: { status: "PENDING", amount: row.amount.toFixed(2) },
        after: {
          status: "PAID",
          method: "BANK_TRANSFER",
          amount,
          paidOn: dto.paidOn,
          reference: dto.reference || null,
          ebarimtNumber: dto.ebarimtNumber ?? null,
        },
        overlaps: result.overlaps,
      },
    });

    return { id, status: "PAID" as const, amount, overlaps: result.overlaps };
  }

  /** The e-receipt issued on ebarimt by hand — its number, on a paid period. */
  async setEbarimt(actor: Actor, id: string, dto: SetEbarimtDto) {
    this.platform.assertSuperAdmin(actor);
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException();
    if (row.status !== "PAID" || !(await this.repo.setEbarimt(id, dto.ebarimtNumber))) {
      throw new BadRequestException("ebarimt-ын дугаарыг төлөгдсөн төлбөрт л оруулна.");
    }

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: row.kindergartenId,
      actorUserId: actor.userId,
      objectType: "ContractPayment",
      objectId: id,
      metadata: {
        before: { ebarimtNumber: row.ebarimtNumber },
        after: { ebarimtNumber: dto.ebarimtNumber },
      },
    });

    return { id, ebarimtNumber: dto.ebarimtNumber };
  }
}
