import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { paginate } from "../common/pagination";
import { isFutureDate, isValidRange } from "./attendance-rules";
import { AttendanceRepository } from "./attendance.repository";
import type {
  CreateAttendanceRequestDto,
  RecordAttendanceDto,
  RecordPickupDto,
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
    await this.assertCanReadGroup(actor, groupId);

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

    // `arrivedWith` sent with no `arrivedAt` means "just now" — the actual
    // moment of this request, not a client-supplied clock.
    const arrivedAt =
      dto.arrivedWith !== undefined && dto.arrivedWith !== null
        ? (dto.arrivedAt ?? new Date())
        : dto.arrivedAt;
    // Name travels with `arrivedWith`, not independently: `undefined` when
    // `arrivedWith` itself is not being sent (so a status-only call leaves an
    // existing name alone, same as `arrivedWith`), `null` when the companion
    // is MOTHER/FATHER (a name would be stale for a category that already
    // names them), and the sent name only for OTHER.
    const arrivedWithName =
      dto.arrivedWith !== undefined
        ? dto.arrivedWith === "OTHER"
          ? (dto.arrivedWithName ?? null)
          : null
        : undefined;

    const record = await this.repo.upsertForChild({
      kindergartenId: enrollment.kindergartenId,
      childId,
      enrollmentId: enrollment.id,
      date,
      status: dto.status,
      note: dto.note ?? null,
      recordedById: actor.userId,
      arrivedWith: dto.arrivedWith,
      arrivedWithName,
      arrivedAt,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: enrollment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Attendance",
      objectId: record.id,
      childId,
      metadata: { status: dto.status, date: dateIso, arrivedWith: dto.arrivedWith ?? undefined },
    });

    return record;
  }

  /**
   * Pickup — a separate call from `record()` on purpose (see the DTO's own
   * note): staff check a child in in the morning and out in the afternoon,
   * two different moments, and this one must not require re-sending that
   * morning's `status`.
   */
  async recordPickup(actor: Actor, childId: string, dateIso: string, dto: RecordPickupDto) {
    await this.childAccess.assertCanRecord(actor, childId);

    const date = new Date(`${dateIso}T00:00:00.000Z`);
    if (isFutureDate(date)) {
      throw new BadRequestException("Ирээдүйн огноонд ирц бүртгэх боломжгүй");
    }

    const enrollment = await this.repo.activeEnrollment(childId);
    if (!enrollment) throw new BadRequestException("Хүүхэд бүлэгт бүртгэлтэй биш байна");

    const record = await this.repo.recordPickup(enrollment.id, date, {
      pickedUpWith: dto.pickedUpWith,
      pickedUpWithName: dto.pickedUpWith === "OTHER" ? (dto.pickedUpWithName ?? null) : null,
      pickedUpAt: dto.pickedUpAt ?? new Date(),
    });
    // No record for the day to attach a pickup to — recording who picked up
    // a child who was never checked in would be a fact about nothing.
    if (!record) throw new NotFoundException("Энэ өдөр ирц бүртгэгдээгүй байна");

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: enrollment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Attendance",
      objectId: record.id,
      childId,
      metadata: { pickedUpWith: dto.pickedUpWith, date: dateIso },
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

    // Same "companion with no time means now" default `record()` uses — only
    // meaningful when this request is actually an arrival or pickup claim.
    const isPresentClaim = dto.requestedStatus === "PRESENT";
    const arrivedAt = isPresentClaim && dto.arrivedWith ? (dto.arrivedAt ?? new Date()) : undefined;
    const pickedUpAt =
      isPresentClaim && dto.pickedUpWith ? (dto.pickedUpAt ?? new Date()) : undefined;

    const request = await this.repo.createRequest({
      kindergartenId: enrollment.kindergartenId,
      childId,
      enrollmentId: enrollment.id,
      requestedById: actor.userId,
      dateFrom,
      dateTo,
      requestedStatus: dto.requestedStatus,
      reason: dto.reason ?? null,
      arrivedWith: isPresentClaim ? dto.arrivedWith : undefined,
      arrivedWithName:
        isPresentClaim && dto.arrivedWith === "OTHER" ? (dto.arrivedWithName ?? null) : null,
      arrivedAt,
      pickedUpWith: isPresentClaim ? dto.pickedUpWith : undefined,
      pickedUpWithName:
        isPresentClaim && dto.pickedUpWith === "OTHER" ? (dto.pickedUpWithName ?? null) : null,
      pickedUpAt,
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
          /*
           * ★ `?? undefined`, not the raw `null` Prisma returns for an unset
           * column — `upsertForChild`'s update branch only overwrites a
           * field when it is `!== undefined` (so one PUT does not erase what
           * an earlier one wrote, see that method's own comment). A pickup
           * request row has `arrivedWith: null`; passing that literal `null`
           * through would satisfy `!== undefined` and blank out an arrival
           * an earlier, already-approved request wrote for the same day.
           * Converting to `undefined` here is what keeps the two requests
           * additive instead of each one clobbering the other's half.
           */
          arrivedWith: row.arrivedWith ?? undefined,
          arrivedWithName: row.arrivedWith ? row.arrivedWithName : undefined,
          arrivedAt: row.arrivedAt ?? undefined,
          pickedUpWith: row.pickedUpWith ?? undefined,
          pickedUpWithName: row.pickedUpWith ? row.pickedUpWithName : undefined,
          pickedUpAt: row.pickedUpAt ?? undefined,
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
    const { items, total } = await this.repo.listPendingForGroups(groupIds, page);
    return paginate(items, total, page);
  }

  /**
   * One group's month — the register's own analytics panel.
   *
   * ★ Raw counts, no rates.
   *
   * `dashboard.repository.ts` states the rule this follows: which statuses
   * count as "attended" is a policy question the funding rules answer
   * differently from the way a teacher reads a register, so the endpoint
   * returns what was recorded and each reader states its own definition. A
   * percentage computed here would be a third answer nobody could reconcile
   * with the other two.
   *
   * ★★ `days` carries only the dates that have a record.
   *
   * Not every calendar day: a kindergarten's working days are the days somebody
   * registered, which is the same definition the funding register uses and the
   * reason no table of public holidays is hard-coded anywhere. A weekend padded
   * in with zeroes would read as a day everybody missed.
   */
  async groupMonthSummary(actor: Actor, groupId: string, month: string) {
    await this.assertCanReadGroup(actor, groupId);

    const { from, to } = monthRange(month);
    const { byDate, byStatus, byEnrollment, roster } = await this.repo.groupMonthSummary(
      groupId,
      from,
      to,
    );

    const days = new Map<string, Record<string, number>>();
    for (const row of byDate) {
      const key = toDateOnly(row.date);
      const counts = days.get(key) ?? emptyCounts();
      counts[row.status] = (counts[row.status] ?? 0) + row._count._all;
      days.set(key, counts);
    }

    const totals = emptyCounts();
    for (const row of byStatus) totals[row.status] = row._count._all;

    const perEnrollment = new Map<string, Record<string, number>>();
    for (const row of byEnrollment) {
      const counts = perEnrollment.get(row.enrollmentId) ?? emptyCounts();
      counts[row.status] = (counts[row.status] ?? 0) + row._count._all;
      perEnrollment.set(row.enrollmentId, counts);
    }

    return {
      month,
      /** Currently enrolled, which is what the day sheet beside this shows. */
      roster: roster.length,
      days: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, counts]) => ({ date, counts })),
      totals,
      /*
       * Every child on the roster, including the ones with nothing recorded —
       * a child who has no rows at all is the most interesting name on this
       * list, and dropping them for having no data would hide exactly that.
       */
      children: roster
        .map((enrollment) => ({
          child: enrollment.child,
          counts: perEnrollment.get(enrollment.id) ?? emptyCounts(),
        }))
        .sort((a, b) => a.child.lastName.localeCompare(b.child.lastName, "mn")),
    };
  }

  /**
   * Who may read one group's register.
   *
   * ★ Named once and shared by the day sheet and the month summary.
   *
   * Membership in the kindergarten is not enough: a teacher may only reach a
   * group they are actually assigned to teach, and an administrator may reach
   * any group in their own kindergarten. Two copies of that rule is how the
   * new endpoint would end up answering it more generously than the old one —
   * CLAUDE.md §1.1, and 404 rather than 403 throughout per §1.7.
   */
  private async assertCanReadGroup(actor: Actor, groupId: string): Promise<void> {
    const group = await this.repo.findGroup(groupId, this.tenants.memberKindergartenIds(actor));
    if (!group) throw new NotFoundException();

    if (!this.tenants.isAdmin(actor, group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(groupId)) throw new NotFoundException();
    }
  }
}

/** The six statuses, all present and zeroed — a missing key reads as a gap. */
function emptyCounts(): Record<string, number> {
  return { PRESENT: 0, HALF_DAY: 0, EXCUSED: 0, SICK: 0, ABSENT: 0, OTHER: 0 };
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
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
