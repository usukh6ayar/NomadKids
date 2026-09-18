import { Injectable, Logger } from "@nestjs/common";
import { AuditRepository } from "../../audit/audit.repository";
import { EsisService } from "./esis.service";
import { EsisWriteRepository } from "./esis-write.repository";

/**
 * Sends one approved write, once.
 *
 * ★ **The `sentAt` refusal is the whole point of this class.** ESIS honours no
 * idempotency header, so a BullMQ retry, a duplicate job or a redelivery after
 * a worker restart would each re-post a `150` and create a **second group** in
 * the ministry's register that nothing here can remove. The row is re-read
 * inside the job rather than trusted from the job's payload, because the job
 * may have been sitting in Redis while another one finished the same work.
 *
 * ★★ Separate from the worker so the guard can be tested without Redis. A
 * guard that only runs inside a BullMQ processor is a guard nobody has seen
 * fail.
 */
@Injectable()
export class EsisWriteSender {
  private readonly logger = new Logger(EsisWriteSender.name);

  constructor(
    private readonly repo: EsisWriteRepository,
    private readonly esis: EsisService,
    private readonly audit: AuditRepository,
  ) {}

  async send(writeRequestId: string) {
    const row = await this.repo.findForWorker(writeRequestId);
    if (!row) return;

    if (row.sentAt !== null) {
      this.logger.warn(`ESIS write ${row.id} already sent at ${row.sentAt.toISOString()}`);
      return;
    }
    if (row.state !== "APPROVED") {
      this.logger.warn(`ESIS write ${row.id} is ${row.state}, not APPROVED`);
      return;
    }

    try {
      const response = await this.dispatch(row.service, row.payload);
      const data = (response.data ?? {}) as Record<string, unknown>;

      /*
       * ★ A create's answer is an input, not just a record. An update and a
       * delete both need the ministry's own group id, and this is the only
       * moment it is ever sent to us. If the field is absent the column stays
       * NULL and the next update refuses with `ESIS_GROUP_ID_UNKNOWN` rather
       * than posting a body with `studentGroupId: NaN`.
       */
      if (row.service === "groupCreate") {
        const ministryId = readGroupId(data);
        if (ministryId) await this.repo.setGroupEsisId(row.groupId, ministryId);
      }

      await this.repo.markSent(row.id, data as never);
      await this.audit.append({
        action: "UPDATE",
        kindergartenId: row.kindergartenId,
        actorUserId: row.approvedById,
        objectType: "EsisWriteRequest",
        objectId: row.id,
        /*
         * ★ `before` lives inside `metadata` because `AuditEntry` has no
         * column for it — and CLAUDE.md §14's "Өмнөх утга → Шинэ утга" is
         * exactly what it asks for. This row records both ends of the move.
         */
        metadata: {
          service: row.service,
          apiId: row.apiId,
          before: { state: "APPROVED" },
          outcome: "SENT",
        },
      });
    } catch (error) {
      const code = safeCode(error);
      await this.repo.markFailed(row.id, code);
      await this.audit.append({
        action: "UPDATE",
        kindergartenId: row.kindergartenId,
        actorUserId: row.approvedById,
        objectType: "EsisWriteRequest",
        objectId: row.id,
        metadata: {
          service: row.service,
          apiId: row.apiId,
          before: { state: "APPROVED" },
          outcome: "FAILED",
          errorCode: code,
        },
      });
    }
  }

  private dispatch(service: string, payload: unknown) {
    switch (service) {
      case "groupCreate":
        return this.esis.sendGroupCreate(payload);
      case "groupUpdate":
      case "groupDelete":
        return this.esis.sendGroupUpdate(payload);
      case "groupInstructor":
        return this.esis.sendGroupInstructor(payload);
      default:
        throw new Error(`Unknown ESIS write service: ${service}`);
    }
  }
}

/**
 * The ministry's own group id out of a create's response.
 *
 * ★ Reads one name, and returns `null` for anything else rather than guessing
 * at a second. The response shape has not been seen — spec №3б's probe has
 * still to run — so a NULL that makes the next update refuse is the safe
 * answer, and the wrong field silently stored is not.
 */
function readGroupId(data: Record<string, unknown>): string | null {
  const value = data.studentGroupId;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function safeCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  if (error instanceof Error && error.name.length > 0) return error.name;
  return "UNKNOWN";
}
