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
  ExtensionQuery,
  ListContractPaymentsQuery,
  RecordExtensionDto,
  RecordTransferDto,
  SetEbarimtDto,
} from "./contract-payments.dto";
import { quote } from "./service-access.service";

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
        note: row.note,
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

  /**
   * «Эрх сунгах» — what recording a transfer for this kindergarten would do:
   * the first period still owed, or the term and the year a renewal would
   * cover, each with its suggested end and amount (the user, 2026-10-28).
   */
  async extensionPreview(actor: Actor, query: ExtensionQuery) {
    this.platform.assertSuperAdmin(actor);
    const target = await this.repo.extensionTarget(query.kindergartenId);
    if (!target.kindergarten) throw new NotFoundException();
    const { kindergarten, contract, initialDue } = target;

    const base = {
      kindergarten: { id: kindergarten.id, name: kindergarten.name },
      contract: contract
        ? { id: contract.id, number: contract.number, endsOn: isoDay(contract.endsOn) }
        : null,
      awaitingSignature: target.awaitingSignature,
      registeredGroups: target.groups,
    };
    if (!contract) return { ...base, initialDue: null, groupCount: null, options: null };
    if (initialDue) {
      return {
        ...base,
        initialDue: {
          id: initialDue.id,
          period: initialDue.period,
          coversFrom: isoDay(initialDue.coversFrom),
          coversTo: isoDay(initialDue.coversTo),
          amount: initialDue.amount.toFixed(2),
        },
        groupCount: initialDue.groupCount,
        options: null,
      };
    }
    const groupCount = query.groups ?? Math.max(1, target.groups);
    const option = (period: "TERM" | "YEAR") => {
      const priced = quote(contract, groupCount, period);
      return priced.months === 0
        ? null
        : {
            coversFrom: priced.coversFrom,
            coversTo: priced.coversTo,
            perGroup: priced.perGroup,
            amount: priced.amount,
            label: priced.label,
          };
    };
    return {
      ...base,
      initialDue: null,
      groupCount,
      options: { TERM: option("TERM"), YEAR: option("YEAR") },
    };
  }

  /**
   * «Эрх сунгах» — a transfer recorded from the kindergarten itself, with the
   * end the operator chose and their note (the user, 2026-10-28). The same
   * settlement QPay runs, so the revenue and the partners' shares count it.
   *
   * ★ The owed first period is settled before any renewal, as the director's
   * own page requires. A director's pending renewal for the same start is
   * reused, never doubled.
   *
   * ★★ The end only ever moves forward (`settleContractPayment`), so one not
   * past the current end is refused here — a row marked PAID that opened
   * nothing would be worse than a 400. And it is bounded: a typo of 2062
   * must not grant access for decades.
   */
  async recordExtension(actor: Actor, dto: RecordExtensionDto) {
    this.platform.assertSuperAdmin(actor);
    const today = localDate();
    if (dto.paidOn > today) {
      throw new BadRequestException("Төлсөн огноо ирээдүйд байж болохгүй.");
    }
    const target = await this.repo.extensionTarget(dto.kindergartenId);
    if (!target.kindergarten) throw new NotFoundException();
    const { contract, initialDue } = target;
    if (!contract) {
      throw new BadRequestException(
        target.awaitingSignature
          ? "Эрхлэгч гэрээг хараахан хүлээн аваагүй байна. «Үйлчилгээний эрх»-ээс гэрээгээ хүлээн авсны дараа бүртгэнэ."
          : "Энэ цэцэрлэгт идэвхтэй гэрээ алга.",
      );
    }

    let existingId: string | null;
    let create: Parameters<ContractPaymentsRepository["recordExtension"]>[0]["create"] = null;
    let coversFrom: string;
    let suggested: { coversTo: string; amount: string };
    if (initialDue) {
      existingId = initialDue.id;
      coversFrom = isoDay(initialDue.coversFrom);
      suggested = { coversTo: isoDay(initialDue.coversTo), amount: initialDue.amount.toFixed(2) };
    } else {
      const priced = quote(contract, dto.groupCount, dto.period, today);
      if (priced.months === 0) {
        throw new BadRequestException(
          "Энэ хичээлийн жилд жилээр төлөх сар үлдээгүй. Улирлаар сунгана уу.",
        );
      }
      coversFrom = priced.coversFrom;
      const existing = await this.repo.findRenewal(contract.id, dto.period, day(coversFrom));
      if (existing?.status === "PAID") {
        throw new ConflictException("Энэ хугацааны төлбөр аль хэдийн бүртгэгдсэн.");
      }
      existingId = existing?.id ?? null;
      if (!existing) {
        create = {
          kindergartenId: dto.kindergartenId,
          contractId: contract.id,
          period: dto.period,
          termNumber: priced.term?.number ?? null,
          coversFrom: day(coversFrom),
          coversTo: day(priced.coversTo),
          groupCount: dto.groupCount,
          perGroupAmount: priced.perGroup,
          amount: priced.amount,
          createdById: actor.userId,
        };
      }
      suggested = { coversTo: priced.coversTo, amount: priced.amount };
    }

    const currentEnd = isoDay(contract.endsOn);
    if (dto.coversTo < coversFrom) {
      throw new BadRequestException(
        `Дуусах огноо эхлэх огнооноос (${coversFrom}) өмнө байж болохгүй.`,
      );
    }
    // The owed first period may keep the contract's own end; a renewal must pass it.
    if (initialDue ? dto.coversTo < currentEnd : dto.coversTo <= currentEnd) {
      throw new BadRequestException(
        `Дуусах огноо одоогийн эрхийн дуусах огнооноос (${currentEnd}) хойш байх ёстой.`,
      );
    }
    const limit = nextYear(suggested.coversTo);
    if (dto.coversTo > limit) {
      throw new BadRequestException(`Дуусах огноо ${limit}-аас хойш байж болохгүй.`);
    }

    const amount = new Decimal(dto.amount).toFixed(2);
    const note = dto.note || null;
    const { id, result } = await this.repo.recordExtension({
      existingId,
      create,
      coversTo: day(dto.coversTo),
      groupCount: dto.groupCount,
      note,
      settle: {
        // Noon UTC: the day stays the day in the revenue's UTC month bounds.
        paidAt: new Date(`${dto.paidOn}T12:00:00.000Z`),
        amount,
        reference: dto.reference || null,
        ebarimtNumber: dto.ebarimtNumber ?? null,
        recordedById: actor.userId,
      },
    });
    if (!result.claimed) throw new ConflictException("Энэ төлбөр аль хэдийн бүртгэгдсэн.");
    if (result.overlaps) {
      this.logger.error(
        `Contract payment ${id} overlaps another paid period of its contract; refund or credit by hand`,
      );
    }

    if (create) {
      await this.audit.append({
        action: "CREATE",
        kindergartenId: dto.kindergartenId,
        actorUserId: actor.userId,
        objectType: "ContractPayment",
        objectId: id,
        metadata: {
          period: dto.period,
          coversFrom,
          coversTo: suggested.coversTo,
          groupCount: dto.groupCount,
          amount: suggested.amount,
          by: "operator",
        },
      });
    }
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: dto.kindergartenId,
      actorUserId: actor.userId,
      objectType: "ContractPayment",
      objectId: id,
      metadata: {
        before: { status: "PENDING", amount: suggested.amount, coversTo: suggested.coversTo },
        after: {
          status: "PAID",
          method: "BANK_TRANSFER",
          amount,
          paidOn: dto.paidOn,
          coversTo: dto.coversTo,
          groupCount: dto.groupCount,
          note,
          reference: dto.reference || null,
          ebarimtNumber: dto.ebarimtNumber ?? null,
        },
        overlaps: result.overlaps,
      },
    });

    return {
      id,
      status: "PAID" as const,
      amount,
      coversFrom,
      coversTo: dto.coversTo,
      overlaps: result.overlaps,
    };
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** The same day a year on — the furthest an operator may move an end. */
function nextYear(iso: string): string {
  return `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
}
