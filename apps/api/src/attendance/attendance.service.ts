import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { isFutureDate, isValidRange } from "./attendance-rules";
import { AttendanceRepository } from "./attendance.repository";
import type {
  CreateAttendanceRequestDto,
  RecordAttendanceDto,
  ReviewAttendanceRequestDto,
} from "./attendance.dto";

@Injectable()
export class AttendanceService {
  constructor(
    private readonly repo: AttendanceRepository,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly authz: AuthzRepository,
    private readonly audit: AuditRepository,
  ) {}

  // ── Reading — staff and guardians alike ─────────────────────────────────

  /** A month's attendance for one child. Both staff and guardians may read. */
  async listForChild(actor: Actor, childId: string, month: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    const { from, to } = monthRange(month);
    return this.repo.findForChildInRange(childId, from, to);
  }

  async summaryForChild(actor: Actor, childId: string, month: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    const { from, to } = monthRange(month);
    return this.repo.monthlyStatusCounts(childId, from, to);
  }

  /**
   * One group's day sheet — every currently-enrolled child, reconciled
   * against whatever has been marked, so an unmarked child is a fact the
   * caller can render rather than a row that is simply absent.
   *
   * ★ Mirrors `AssessmentService.getGroupColumn` exactly: membership in the
   * kindergarten is not enough — a teacher may only see a group they are
   * actually assigned to teach.
   */
  async groupDaySheet(actor: Actor, groupId: string, dateIso: string) {
    const group = await this.repo.findGroup(groupId, this.tenants.memberKindergartenIds(actor));
    if (!group) throw new NotFoundException();

    // Membership is not enough: a teacher may only see a group they are
    // assigned to teach.
    if (!this.tenants.isAdmin(actor, group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(groupId)) throw new NotFoundException();
    }

    const date = new Date(`${dateIso}T00:00:00.000Z`);
    const { enrollments, records } = await this.repo.groupDaySheet(groupId, date);

    const byEnrollment = new Map(records.map((r) => [r.enrollmentId, r]));
    return enrollments.map((enrollment) => ({
      child: enrollment.child,
      enrollmentId: enrollment.id,
      record: byEnrollment.get(enrollment.id) ?? null,
    }));
  }

  // ── Writing — staff only ────────────────────────────────────────────────

  /** Records or updates one child's status for one day. Staff only. */
  async record(actor: Actor, childId: string, dateIso: string, dto: RecordAttendanceDto) {
    await this.childAccess.assertCanRecord(actor, childId);

    const date = new Date(`${dateIso}T00:00:00.000Z`);
    if (isFutureDate(date)) {
      throw new BadRequestException("Ирээдүйн огноонд ирц бүртгэх боломжгүй");
    }

    const enrollment = await this.repo.activeEnrollment(childId);
    if (!enrollment) throw new BadRequestException("Хүүхэд бүлэгт бүртгэлтэй биш байна");

    const record = await this.repo.upsertForChild({
      kindergartenId: enrollment.kindergartenId,
      childId,
      enrollmentId: enrollment.id,
      date,
      status: dto.status,
      note: dto.note ?? null,
      recordedById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: enrollment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Attendance",
      objectId: record.id,
      childId,
      metadata: { status: dto.status, date: dateIso },
    });

    return record;
  }

  // ── Attendance requests — guardian-initiated, staff-reviewed ────────────

  /** A guardian's advance notice. Read access is enough — same shape as a
   * parent observation. */
  async createRequest(actor: Actor, childId: string, dto: CreateAttendanceRequestDto) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    if (!isGuardianOf(actor, facts)) throw new NotFoundException();

    const dateFrom = new Date(`${dto.dateFrom}T00:00:00.000Z`);
    const dateTo = new Date(`${dto.dateTo}T00:00:00.000Z`);
    if (!isValidRange(dateFrom, dateTo)) {
      throw new BadRequestException("Эхлэх огноо дуусах огнооноос хойш байж болохгүй");
    }

    const enrollment = await this.repo.activeEnrollment(childId);
    if (!enrollment) throw new BadRequestException("Хүүхэд бүлэгт бүртгэлтэй биш байна");

    const request = await this.repo.createRequest({
      kindergartenId: enrollment.kindergartenId,
      childId,
      enrollmentId: enrollment.id,
      requestedById: actor.userId,
      dateFrom,
      dateTo,
      requestedStatus: dto.requestedStatus,
      reason: dto.reason ?? null,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: enrollment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "AttendanceRequest",
      objectId: request.id,
      childId,
      metadata: { requestedStatus: dto.requestedStatus },
    });

    return request;
  }

  async listRequestsForChild(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);
    return this.repo.listRequestsForChild(childId);
  }

  /**
   * A teacher decides. Approving writes the actual `Attendance` rows for the
   * whole range — staff stays the sole author of `Attendance`, the same way a
   * review both approves and publishes an observation in one call.
   */
  async reviewRequest(actor: Actor, requestId: string, dto: ReviewAttendanceRequestDto) {
    const row = await this.repo.findRequestForAuthorization(requestId);
    if (!row) throw new NotFoundException();

    await this.childAccess.assertCanRecord(actor, row.childId);

    if (row.reviewStatus !== "PENDING") {
      throw new BadRequestException("Энэ хүсэлтийг аль хэдийн шийдвэрлэсэн байна");
    }

    const decided = await this.repo.decideRequest(requestId, dto.decision, actor.userId);

    if (dto.decision === "APPROVED") {
      for (const date of eachDate(row.dateFrom, row.dateTo)) {
        await this.repo.upsertForChild({
          kindergartenId: row.kindergartenId,
          childId: row.childId,
          enrollmentId: row.enrollmentId,
          date,
          status: row.requestedStatus,
          note: null,
          recordedById: actor.userId,
        });
      }
    }

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: row.kindergartenId,
      actorUserId: actor.userId,
      objectType: "AttendanceRequest",
      objectId: requestId,
      childId: row.childId,
      metadata: { decision: dto.decision },
    });

    return decided;
  }

  /** Pending requests across the teacher's own groups. */
  async reviewQueue(actor: Actor, page: { page: number; pageSize: number }) {
    const groupIds = await this.authz.loadActiveTeachingGroupIds(actor);
    return this.repo.listPendingForGroups(groupIds, page);
  }
}

/** `YYYY-MM` to the first and last instant of that month, in UTC. */
function monthRange(month: string): { from: Date; to: Date } {
  const [year, monthNum] = month.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(year, monthNum - 1, 1));
  const to = new Date(Date.UTC(year, monthNum, 0));
  return { from, to };
}

/** Every calendar day from `from` to `to`, inclusive. */
function* eachDate(from: Date, to: Date): Generator<Date> {
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    yield new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}
