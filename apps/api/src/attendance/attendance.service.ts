import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { AuthzRepository } from "../authz/authz.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { paginate } from "../common/pagination";
import { isFutureDate, isValidRange } from "./attendance-rules";
import { AttendanceRepository } from "./attendance.repository";
import { StorageService } from "../storage/storage.service";
import {
  detectImageType,
  sanitiseFilename,
  UploadRejected,
  validateImageUpload,
  validatePdfUpload,
} from "../media/upload-validation";
import { buildJournalWorkbook } from "./journal-workbook";
import { summariseDays } from "./daily-summary";
import type { AttendanceRegisterQuery } from "./attendance.dto";
import type {
  CreateAttendanceRequestDto,
  RecordAttendanceDto,
  RecordGroupAttendanceDto,
  SubmitAttendanceDto,
  RecordPickupDto,
  ReviewAttendanceRequestDto,
} from "./attendance.dto";
import { EsisService } from "../integrations/esis/esis.service";
import { EsisError } from "../integrations/esis/esis.client";

const DEMO_ESIS_INSTITUTION_ID = 40305;
const DEMO_ESIS_GROUPS: Record<string, number> = {
  "Наран бүлэг": 10001,
  "Дэлбээ бүлэг": 10002,
};
const DEMO_ESIS_PEOPLE: Record<string, number> = {
  "Ганболд Батбаяр": 90000000000001,
  "Дорж Намуун": 90000000000002,
  "Энхбат Тэмүүлэн": 90000000000003,
  "Мөнхбаяр Сарнай": 90000000000004,
  "Батжаргал Ану": 90000000000005,
  "Сүхбаатар Чингис": 90000000000006,
  "Пүрэвдорж Оюунаа": 90000000000007,
  "Алтанзул Мандах": 90000000000008,
  "Нэргүй Хулан": 90000000000009,
  "Цэрэндорж Билгүүн": 90000000000010,
};

function stableDemoNumber(value: string, base: number, spread: number) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return base + (hash % spread);
}

function esisReasonCode(status: string): "PRESENT" | "EXCUSED" | "SICK" | "UNEXCUSED" | null {
  if (status === "PRESENT" || status === "HALF_DAY") return "PRESENT";
  if (status === "EXCUSED") return "EXCUSED";
  if (status === "SICK") return "SICK";
  if (status === "ABSENT") return "UNEXCUSED";
  return null;
}

type AttendanceIdentity = {
  childId: string;
  lastName: string;
  firstName: string;
  dateOfBirth: Date;
  attendReasonCode: "PRESENT" | "EXCUSED" | "SICK" | "UNEXCUSED";
};

type AttendanceDraft = {
  groupId: string;
  groupName: string;
  dayDate: string;
  children: AttendanceIdentity[];
};

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("mn-MN");
}

function positiveEsisNumber(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BadGatewayException(`ESIS ${label} буруу форматтай ирлээ.`);
  }
  return parsed;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly repo: AttendanceRepository,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly authz: AuthzRepository,
    private readonly audit: AuditRepository,
    private readonly esis: EsisService,
    private readonly storage: StorageService,
  ) {}

  /**
   * The kindergarten-wide register — `A/261` Хавсралт 2 §1's "ирцийн бүртгэл",
   * as the director and the accountant actually need to read it.
   *
   * ★ Everything before this answered about one group on one day, or one child
   * in one month. Neither shape answers "how did the whole kindergarten do over
   * the period this claim covers", which is the question that precedes both a
   * funding claim and a parent's invoice.
   *
   * ★★ `assertCanReadFinance` — ADMIN and ACCOUNTANT, never TEACHER. Not a
   * misuse of the name: `FundingService` already treats it as "may touch
   * finance", attendance is the input every funding figure is computed from,
   * and `нэмэлт.md` §13 excludes teachers from exactly this. A teacher still
   * reads their own group's sheet through `groupDaySheet`, which is the view
   * their job needs. A second predicate naming the same two roles would be a
   * distinction with no difference — the reasoning `InvoicesService` records.
   *
   * ★★★ Pagination is over **children**, never over days. A page that cut the
   * date range would be a register with a hole in it, and the hole would be
   * invisible: every row would look complete. So a page is fifty children with
   * all their days, and the days are bounded by the query schema instead.
   */
  async register(actor: Actor, kindergartenId: string, query: AttendanceRegisterQuery) {
    const built = await this.buildRegister(actor, kindergartenId, query);
    const { page, pageSize } = query;
    const start = (page - 1) * pageSize;
    const items = built.rows.slice(start, start + pageSize).map((row) => ({
      ...row,
      child: {
        id: row.child.id,
        lastName: row.child.lastName,
        firstName: row.child.firstName,
        status: row.child.status,
      },
    }));

    return {
      ...paginate(items, built.rows.length, query),
      from: query.from,
      to: query.to,
      days: built.days,
      totals: built.totals,
    };
  }

  /**
   * "Өдөр тутмын ирц" — the director's register, one row per group per day.
   *
   * ★ Not paginated, and that is a decision rather than an omission.
   *
   * `register()` pages over *children* because its response is children × days
   * and a page that cut the date range would be a register with an invisible
   * hole in it. This response is groups × days: a kindergarten with twelve
   * groups over a month is 264 rows, which is one screen's worth of scrolling
   * and well inside the same 92-day ceiling the query schema already enforces.
   * Paging it would split a month across two screens for no benefit.
   *
   * ★★ It reuses `buildRegister` rather than querying its own way.
   *
   * The figures here are the ones the grid is made of, so a second query would
   * be a second chance to disagree about what "recorded" means — and the same
   * two queries answer both. `summariseDays` is shared with the Excel sheet for
   * the same reason.
   */
  async dailySummary(actor: Actor, kindergartenId: string, query: AttendanceRegisterQuery) {
    const built = await this.buildRegister(actor, kindergartenId, query);
    const [kindergarten, submissions] = await Promise.all([
      this.authz.loadKindergartenNames(actor),
      this.repo.findSubmissions(
        kindergartenId,
        toUtcDate(query.from),
        toUtcDate(query.to),
        query.groupId,
      ),
    ]);

    const rows = summariseDays(built.rows, built.days, submissions);

    return {
      kindergartenName: kindergarten[kindergartenId] ?? "",
      from: query.from,
      to: query.to,
      items: rows,
      /*
        Across every row on screen, so a director reading the foot of the table
        gets the period's totals without adding up a month by eye.
      */
      totals: {
        expected: rows.reduce((sum, row) => sum + row.expected, 0),
        unrecorded: rows.reduce((sum, row) => sum + row.unrecorded, 0),
        present: rows.reduce((sum, row) => sum + row.present, 0),
        excused: rows.reduce((sum, row) => sum + row.excused, 0),
        sick: rows.reduce((sum, row) => sum + row.sick, 0),
        absent: rows.reduce((sum, row) => sum + row.absent, 0),
        /** How many group-days are fully filled in — the figure that drives a chase. */
        complete: rows.filter((row) => row.complete).length,
        /** How many are already submitted — what the Илгээх button has left to do. */
        sent: rows.filter((row) => row.sentAt).length,
        days: rows.length,
      },
    };
  }

  /** Builds the exact ESIS v3 request bodies without sending them. */
  async esisAttendancePreview(actor: Actor, kindergartenId: string, dto: SubmitAttendanceDto) {
    const dates = dto.entries.map((entry) => entry.date).sort();
    const built = await this.buildRegister(actor, kindergartenId, {
      from: dates[0]!,
      to: dates[dates.length - 1]!,
      groupId: undefined,
      childId: undefined,
      ageBand: undefined,
      status: undefined,
      childStatus: undefined,
      programKind: undefined,
      attendanceForm: undefined,
      q: undefined,
      page: 1,
      pageSize: 1,
    });

    const drafts: AttendanceDraft[] = dto.entries.map((entry) => {
      const dayIndex = built.days.findIndex((day) => day === entry.date);
      const groupRows = built.rows.filter((row) => row.group.id === entry.groupId);
      const groupName = groupRows[0]?.group.name;

      if (dayIndex < 0 || !groupName || groupRows.length === 0) {
        throw new BadRequestException(`Илгээх бүртгэл олдсонгүй: ${entry.date}`);
      }

      const missing = groupRows.filter((row) => !row.days[dayIndex]);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Ирц бүрэн бүртгэгдээгүй байна: ${groupName} (${entry.date}) — ${missing.length} хүүхэд дутуу.`,
        );
      }

      return {
        groupId: entry.groupId,
        groupName,
        dayDate: entry.date,
        children: groupRows.map((row) => {
          const childName = `${row.child.lastName} ${row.child.firstName}`;
          const fact = row.days[dayIndex]!;
          const attendReasonCode = esisReasonCode(fact.status);
          if (!attendReasonCode) {
            throw new BadRequestException(
              `${groupName} (${entry.date}) — ${childName}-ийн "Бусад" ирцийг ESIS-ийн тодорхой шалтгаанаар солино уу.`,
            );
          }

          return {
            childId: row.childId,
            lastName: row.child.lastName,
            firstName: row.child.firstName,
            dateOfBirth: row.child.dateOfBirth,
            attendReasonCode,
          };
        }),
      };
    });

    return this.resolveAttendanceDrafts(kindergartenId, drafts);
  }

  /**
   * "Ирц илгээх" — sends complete group-days to live ESIS when configured,
   * then records each accepted submission locally. Demo mode keeps the same
   * workflow available before the ministry issues the token.
   *
   * ★★ An incomplete register is refused, not silently sent.
   *
   * `unrecorded > 0` means a teacher has not finished, and submitting a day
   * with children missing from it is the mistake this endpoint most needs to
   * prevent — the resulting figure feeds a funding claim. The error names the
   * count rather than saying "invalid", so the director knows what to chase.
   *
   * ★★★ `childCount` is taken from the register as it stands right now.
   *
   * Not recomputed later: a roster changes, and "what was submitted" must not
   * become a different number next week. The live figures stay on the screen;
   * this is the snapshot the submission was made from.
   */
  async submitDays(actor: Actor, kindergartenId: string, dto: SubmitAttendanceDto) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    /*
      The summary is rebuilt rather than trusted from the client: the request
      carries a group and a date, never counts. A payload that supplied its own
      `childCount` would let a caller record a submission over figures nobody
      can reproduce.
    */
    const dates = dto.entries.map((entry) => entry.date).sort();
    const built = await this.buildRegister(actor, kindergartenId, {
      from: dates[0]!,
      to: dates[dates.length - 1]!,
      // The unfiltered register: a submission is about whole group-days, so
      // narrowing by status or age band here would compute `complete` from a
      // subset and declare a half-empty register finished.
      groupId: undefined,
      childId: undefined,
      ageBand: undefined,
      status: undefined,
      childStatus: undefined,
      programKind: undefined,
      attendanceForm: undefined,
      q: undefined,
      // `buildRegister` ignores both — it is `register()` that pages the rows
      // it returns — but the query type carries them.
      page: 1,
      pageSize: 1,
    });

    const summary = new Map(
      summariseDays(built.rows, built.days).map((row) => [`${row.groupId} ${row.date}`, row]),
    );

    const rows = [];
    const incomplete: string[] = [];

    for (const entry of dto.entries) {
      const row = summary.get(`${entry.groupId} ${entry.date}`);
      // A group-day that is not in the register is not this kindergarten's, or
      // has no active enrolments. Skipped rather than refused, on the group
      // batch's own reasoning: one stale row must not discard the rest.
      if (!row) continue;

      if (!row.complete) {
        incomplete.push(`${row.group} (${row.date})`);
        continue;
      }

      rows.push({
        kindergartenId,
        groupId: entry.groupId,
        date: new Date(`${entry.date}T00:00:00.000Z`),
        submittedById: actor.userId,
        childCount: row.expected,
      });
    }

    if (incomplete.length > 0) {
      throw new BadRequestException(
        `Ирц бүрэн бүртгэгдээгүй байна: ${incomplete.join(", ")}. Бүртгэлийг дуусгасны дараа илгээнэ үү.`,
      );
    }

    if (rows.length === 0) throw new BadRequestException("Илгээх бүртгэл олдсонгүй");

    const preview = await this.esisAttendancePreview(actor, kindergartenId, dto);
    const saved = [];
    for (const request of preview.requests) {
      await this.sendAttendance(request.payload);
      const local = rows.find(
        (row) =>
          row.groupId === request.groupId &&
          row.date.toISOString().slice(0, 10) === request.payload.dayDate,
      );
      if (!local) continue;
      const [submission] = await this.repo.submitDays([local]);
      if (submission) saved.push(submission);
    }

    /*
      One audit row for the batch — the act a director performed. The same
      choice `recordGroupMeals` and the attendance batch made, and for the same
      reason: a row per group-day would describe the loop rather than the
      decision.
    */
    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "AttendanceSubmission",
      objectId: kindergartenId,
      metadata: {
        count: saved.length,
        dates: [...new Set(dto.entries.map((e) => e.date))],
        esisMode: preview.demo ? "MOCK" : "LIVE",
        esisStatus: preview.demo ? "DEMO_SUCCESS" : "SUCCEEDED",
        apiId: 171,
      },
    });

    return saved.map((row) => ({
      groupId: row.groupId,
      date: row.date.toISOString().slice(0, 10),
      submittedAt: row.submittedAt.toISOString(),
    }));
  }

  /**
   * The same register as a spreadsheet — every row, not the page on screen.
   *
   * ★ A file is what somebody attaches to a claim or opens beside a bank
   * statement, and one that stopped at row twenty-five because that is where
   * the screen stopped would be worse than no file — the reasoning
   * `FundingService.exportRegister` records for its own export. It takes the
   * same filters, so what is downloaded is what was being looked at.
   */
  async exportRegister(actor: Actor, kindergartenId: string, query: AttendanceRegisterQuery) {
    const built = await this.buildRegister(actor, kindergartenId, query);
    const [kindergarten, submissions] = await Promise.all([
      this.authz.loadKindergartenNames(actor),
      this.repo.findSubmissions(
        kindergartenId,
        toUtcDate(query.from),
        toUtcDate(query.to),
        query.groupId,
      ),
    ]);

    const buffer = await buildJournalWorkbook({
      submissions,
      kindergartenName: kindergarten[kindergartenId] ?? "",
      from: query.from,
      to: query.to,
      days: built.days,
      rows: built.rows,
      totals: built.totals,
    });

    return { buffer, filename: `irts-${query.from}-${query.to}.xlsx` };
  }

  /**
   * The grid itself, shared by the screen and the file so they cannot answer
   * differently — the same "one expression, two callers" the children
   * repository records for its own roster filter.
   */
  private async buildRegister(
    actor: Actor,
    kindergartenId: string,
    query: AttendanceRegisterQuery,
  ) {
    this.tenants.assertCanReadFinance(actor, kindergartenId);

    const from = toUtcDate(query.from);
    const to = toUtcDate(query.to);

    const { enrollments, records } = await this.repo.registerRows(kindergartenId, {
      from,
      to,
      groupIds: query.groupId,
      childIds: query.childId,
      ageBands: query.ageBand,
      programKind: query.programKind,
      attendanceForm: query.attendanceForm,
      statuses: query.status,
      q: query.q,
      childStatuses: query.childStatus,
    });

    // One pass over the records, keyed by enrolment and day — the alternative
    // is a find() per cell, which is the N+1 moved out of the database and
    // into the process.
    const byEnrollment = new Map<string, Map<string, JournalCellFacts>>();
    for (const record of records) {
      const day = record.date.toISOString().slice(0, 10);
      let days = byEnrollment.get(record.enrollmentId);
      if (!days) {
        days = new Map();
        byEnrollment.set(record.enrollmentId, days);
      }
      days.set(day, {
        status: record.status,
        note: record.note,
        // Provenance, for the export's "Үүссэн" and "Үүсгэсэн хэрэглэгч"
        // columns. The screen ignores both; carrying them here keeps the file
        // and the grid on one query rather than two that can disagree.
        createdAt: record.createdAt,
        recordedBy: record.recordedBy,
      });
    }

    const days = eachDay(from, to);

    const rows = enrollments.map((enrollment) => {
      const marked = byEnrollment.get(enrollment.id) ?? new Map();
      const counts: Record<string, number> = {};
      for (const value of marked.values()) {
        counts[value.status] = (counts[value.status] ?? 0) + 1;
      }

      return {
        childId: enrollment.childId,
        child: enrollment.child,
        group: enrollment.group,
        schoolYear: enrollment.schoolYear,
        // `null` where nothing was recorded — a day nobody marked is not the
        // same fact as a day marked absent, and the register must not invent
        // the difference away.
        days: days.map((day) => marked.get(day) ?? null),
        counts,
        recorded: marked.size,
      };
    });

    return {
      rows,
      days,
      /** Across every matching child, never just a page — a total that moved with the page would mislead. */
      totals: rows.reduce<Record<string, number>>((acc, row) => {
        for (const [status, count] of Object.entries(row.counts)) {
          acc[status] = (acc[status] ?? 0) + count;
        }
        return acc;
      }, {}),
    };
  }

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
      child: {
        id: enrollment.child.id,
        lastName: enrollment.child.lastName,
        firstName: enrollment.child.firstName,
      },
      enrollmentId: enrollment.id,
      record: byEnrollment.get(enrollment.id) ?? null,
    }));
  }

  /** Builds the exact ESIS attendance input for one group-day. */
  async groupEsisAttendancePreview(actor: Actor, groupId: string, dateIso: string) {
    await this.assertCanReadGroup(actor, groupId);
    const group = await this.repo.findGroup(groupId, this.tenants.memberKindergartenIds(actor));
    if (!group) throw new NotFoundException();

    const date = new Date(`${dateIso}T00:00:00.000Z`);
    if (isFutureDate(date)) {
      throw new BadRequestException("Ирээдүйн огнооны ирцийг ESIS рүү илгээх боломжгүй");
    }
    const { enrollments, records } = await this.repo.groupDaySheet(groupId, date);
    if (enrollments.length === 0) {
      throw new BadRequestException("ESIS рүү илгээх бүлгийн хүүхэд олдсонгүй");
    }
    const byChild = new Map(records.map((record) => [record.childId, record]));
    const missing = enrollments.filter((enrollment) => !byChild.has(enrollment.childId));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Ирц бүрэн бүртгэгдээгүй байна: ${group.name} (${dateIso}) — ${missing.length} хүүхэд дутуу.`,
      );
    }

    const children: AttendanceIdentity[] = enrollments.map((enrollment) => {
      const record = byChild.get(enrollment.childId)!;
      const childName = `${enrollment.child.lastName} ${enrollment.child.firstName}`;
      const attendReasonCode = esisReasonCode(record.status);
      if (!attendReasonCode) {
        throw new BadRequestException(
          `${group.name} (${dateIso}) — ${childName}-ийн "Бусад" ирцийг ESIS-ийн тодорхой шалтгаанаар солино уу.`,
        );
      }

      return {
        childId: enrollment.childId,
        lastName: enrollment.child.lastName,
        firstName: enrollment.child.firstName,
        dateOfBirth: enrollment.child.dateOfBirth,
        attendReasonCode,
      };
    });

    return this.resolveAttendanceDrafts(group.kindergartenId, [
      { groupId, groupName: group.name, dayDate: dateIso, children },
    ]);
  }

  private async resolveAttendanceDrafts(kindergartenId: string, drafts: AttendanceDraft[]) {
    if (this.esis.isDemoMode) {
      return {
        demo: true,
        apiId: 171,
        endpoint: "/svc/api/hub/v2/group/school/attendance/save/v3",
        requests: drafts.map((draft) => ({
          groupId: draft.groupId,
          groupName: draft.groupName,
          payload: {
            institutionId: DEMO_ESIS_INSTITUTION_ID,
            studentGroupId:
              DEMO_ESIS_GROUPS[draft.groupName] ?? stableDemoNumber(draft.groupId, 10100, 800),
            dayDate: draft.dayDate,
            attendanceList: draft.children.map((child) => {
              const childName = `${child.lastName} ${child.firstName}`;
              return {
                personId:
                  DEMO_ESIS_PEOPLE[childName] ??
                  stableDemoNumber(child.childId, 90000000100000, 8_000_000),
                attendReasonCode: child.attendReasonCode,
                tardyMinutes: 0,
                attendReasonList: [],
              };
            }),
          },
        })),
      };
    }

    if (!this.esis.isConfigured) {
      throw new BadGatewayException(
        "ESIS live горим идэвхтэй боловч Bearer token тохируулаагүй байна.",
      );
    }

    const connection = await this.repo.findEsisConnection(kindergartenId);
    if (!connection?.esisInstitutionId) {
      throw new ConflictException("Цэцэрлэгийн ESIS байгууллагын код тохируулагдаагүй байна.");
    }
    const institutionId = positiveEsisNumber(connection.esisInstitutionId, "institutionId");

    try {
      const groups = (await this.esis.groups(connection.esisInstitutionId)).data;
      const studentsByGroup = new Map<
        string,
        Awaited<ReturnType<EsisService["groupStudents"]>>["data"]
      >();
      const requests = [];

      for (const draft of drafts) {
        const matchingGroups = groups.filter(
          (group) => normalizedName(group.studentGroupName) === normalizedName(draft.groupName),
        );
        if (matchingGroups.length !== 1) {
          throw new ConflictException(
            matchingGroups.length === 0
              ? `ESIS-д "${draft.groupName}" бүлэг олдсонгүй.`
              : `ESIS-д "${draft.groupName}" нэртэй ${matchingGroups.length} бүлэг байна. Mapping-ийг ялгаж баталгаажуулна уу.`,
          );
        }

        const esisGroup = matchingGroups[0]!;
        const groupKey = String(esisGroup.studentGroupId);
        let students = studentsByGroup.get(groupKey);
        if (!students) {
          students = (
            await this.esis.groupStudents(connection.esisInstitutionId, esisGroup.studentGroupId)
          ).data;
          studentsByGroup.set(groupKey, students);
        }

        const attendanceList = draft.children.map((child) => {
          const localName = normalizedName(`${child.lastName} ${child.firstName}`);
          const birthDate = child.dateOfBirth.toISOString().slice(0, 10);
          const matches = students!.filter((student) => {
            const names = [
              `${student.lastName} ${student.firstName}`,
              `${student.lastNameMgl ?? ""} ${student.firstNameMgl ?? ""}`,
              `${student.familyName ?? ""} ${student.firstName}`,
              `${student.familyNameMgl ?? ""} ${student.firstNameMgl ?? student.firstName}`,
            ].map(normalizedName);
            return student.dateOfBirth.slice(0, 10) === birthDate && names.includes(localName);
          });

          if (matches.length !== 1) {
            const childName = `${child.lastName} ${child.firstName}`;
            throw new ConflictException(
              matches.length === 0
                ? `ESIS-ийн ${draft.groupName} бүлэгт ${childName} (${birthDate}) олдсонгүй.`
                : `ESIS-д ${childName} (${birthDate}) давхардсан байна. Person ID-г баталгаажуулна уу.`,
            );
          }

          return {
            personId: positiveEsisNumber(matches[0]!.personId, "personId"),
            attendReasonCode: child.attendReasonCode,
            tardyMinutes: 0,
            attendReasonList: [],
          };
        });

        requests.push({
          groupId: draft.groupId,
          groupName: draft.groupName,
          payload: {
            institutionId,
            studentGroupId: positiveEsisNumber(esisGroup.studentGroupId, "studentGroupId"),
            dayDate: draft.dayDate,
            attendanceList,
          },
        });
      }

      return {
        demo: false,
        apiId: 171,
        endpoint: "/svc/api/hub/v2/group/school/attendance/save/v3",
        requests,
      };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadGatewayException) throw error;
      if (error instanceof EsisError && error.kind === "http" && error.detail.status === 401) {
        throw new BadGatewayException("ESIS Bearer token хүчингүй эсвэл хугацаа дууссан байна.");
      }
      if (error instanceof EsisError && error.kind === "http" && error.detail.status === 403) {
        throw new BadGatewayException("ESIS token-д бүлэг болон суралцагч унших эрх алга байна.");
      }
      throw new BadGatewayException("ESIS-ээс бүлэг, суралцагчийн мэдээлэл татаж чадсангүй.");
    }
  }

  async submitGroupDay(actor: Actor, groupId: string, dateIso: string) {
    const preview = await this.groupEsisAttendancePreview(actor, groupId, dateIso);
    await this.sendAttendance(preview.requests[0]!.payload);
    const group = await this.repo.findGroup(groupId, this.tenants.memberKindergartenIds(actor));
    if (!group) throw new NotFoundException();
    const { enrollments } = await this.repo.groupDaySheet(
      groupId,
      new Date(`${dateIso}T00:00:00.000Z`),
    );

    const [saved] = await this.repo.submitDays([
      {
        kindergartenId: group.kindergartenId,
        groupId,
        date: new Date(`${dateIso}T00:00:00.000Z`),
        submittedById: actor.userId,
        childCount: enrollments.length,
      },
    ]);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: group.kindergartenId,
      actorUserId: actor.userId,
      objectType: "AttendanceSubmission",
      objectId: groupId,
      metadata: {
        esisMode: preview.demo ? "MOCK" : "LIVE",
        esisStatus: preview.demo ? "DEMO_SUCCESS" : "SUCCEEDED",
        apiId: 171,
        date: dateIso,
        childCount: enrollments.length,
      },
    });

    return {
      groupId,
      date: dateIso,
      submittedAt: saved!.submittedAt.toISOString(),
    };
  }

  private async sendAttendance(payload: {
    institutionId: number;
    studentGroupId: number;
    dayDate: string;
    attendanceList: {
      personId: number;
      attendReasonCode: "PRESENT" | "EXCUSED" | "SICK" | "UNEXCUSED";
      tardyMinutes: number;
      attendReasonList: string[];
    }[];
  }) {
    try {
      return await this.esis.saveAttendance(payload);
    } catch (error) {
      if (error instanceof EsisError && error.kind === "http" && error.detail.status === 401) {
        throw new BadGatewayException("ESIS Bearer token хүчингүй эсвэл хугацаа дууссан байна.");
      }
      if (error instanceof EsisError && error.kind === "http" && error.detail.status === 403) {
        throw new BadGatewayException("ESIS token-д API-000269 ирц илгээх эрх алга байна.");
      }
      throw new BadGatewayException("ESIS ирцийн хүсэлтийг хүлээж авсангүй. Дахин шалгана уу.");
    }
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
   * Many children of one group, one day, one call.
   *
   * ★ `assertCanReadGroup` guards a write here, and that is not a slip.
   *
   * It is the same predicate the meal register's batch uses — admin of this
   * kindergarten, or a teacher actively assigned to this group — and its name
   * is about where it started rather than what it decides. The alternative,
   * `assertCanRecord` per child, would be the same question asked twenty-four
   * times against a group membership that cannot differ between them.
   *
   * ★★ It runs before the date check, on `recordGroupMeals`'s own reasoning:
   * validating first would answer an unassigned teacher 400 for a future date
   * and 404 otherwise, and that difference tells them the group exists —
   * exactly the oracle CLAUDE.md §1.7 closes.
   *
   * ★★★ A child in `entries` who is not enrolled in this group is skipped,
   * not refused.
   *
   * The roster can change between the sheet being drawn and the teacher
   * pressing save — a transfer, an archive — and failing the whole call would
   * discard twenty-three good marks over one stale row. Skipping is also what
   * keeps the endpoint from being usable to write attendance for a child
   * outside the group: `byChild` is built from *this group's* active
   * enrollments, so an id that is not in it has no enrollment to write
   * against and falls out here rather than being checked for separately.
   */
  async recordGroupAttendance(actor: Actor, groupId: string, dto: RecordGroupAttendanceDto) {
    await this.assertCanReadGroup(actor, groupId);

    const date = new Date(`${dto.date}T00:00:00.000Z`);
    if (isFutureDate(date)) {
      throw new BadRequestException("Ирээдүйн огноонд ирц бүртгэх боломжгүй");
    }

    const group = await this.repo.findGroup(groupId, this.tenants.memberKindergartenIds(actor));
    if (!group) throw new NotFoundException();

    const { enrollments } = await this.repo.groupDaySheet(groupId, date);
    const byChild = new Map(enrollments.map((e) => [e.childId, e.id]));

    const rows = dto.entries.flatMap((entry) => {
      const enrollmentId = byChild.get(entry.childId);
      if (!enrollmentId) return [];

      return [
        {
          kindergartenId: group.kindergartenId,
          childId: entry.childId,
          enrollmentId,
          date,
          status: entry.status,
          recordedById: actor.userId,
        },
      ];
    });

    if (rows.length === 0) throw new BadRequestException("Бүртгэх хүүхэд олдсонгүй");

    const saved = await this.repo.recordGroupAttendance(rows);

    /*
      One audit row for the batch, not one per child — the same choice
      `recordGroupMeals` made and for the same reason: marking a group present
      is one act a teacher performed, and twenty-four rows a second apart
      describe the loop rather than the decision. The per-child endpoint still
      writes one row per call, so a single correction is still traceable to
      the child it was about.
    */
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: group.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Attendance",
      objectId: groupId,
      metadata: { date: dto.date, count: saved.length },
    });

    return saved;
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
  async createRequest(
    actor: Actor,
    childId: string,
    dto: CreateAttendanceRequestDto,
    attachment?: { buffer: Buffer; originalname: string },
  ) {
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

    let storedAttachment:
      | {
          storageKey: string;
          originalName: string;
          mimeType: string;
          sizeBytes: number;
          width: number | null;
          height: number | null;
        }
      | undefined;

    if (attachment) {
      if (dto.requestedStatus !== "EXCUSED" && dto.requestedStatus !== "SICK") {
        throw new BadRequestException("Хавсралтыг зөвхөн чөлөөний хүсэлтэд оруулна");
      }
      try {
        const detected = detectImageType(attachment.buffer);
        if (detected === "image/webp") {
          throw new UploadRejected("Зөвхөн PDF, JPG, PNG файл оруулна уу");
        }
        const validated = detected
          ? await validateImageUpload(attachment.buffer)
          : await validatePdfUpload(attachment.buffer);
        const storageKey = this.storage.buildKey(childId);
        await this.storage.put(storageKey, validated.buffer, validated.mimeType);
        storedAttachment = {
          storageKey,
          originalName: sanitiseFilename(attachment.originalname),
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          width: "width" in validated ? validated.width : null,
          height: "height" in validated ? validated.height : null,
        };
      } catch (error) {
        if (error instanceof UploadRejected) throw new BadRequestException(error.reason);
        throw error;
      }
    }

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
      attachment: storedAttachment
        ? {
            kindergartenId: enrollment.kindergartenId,
            childId,
            purpose: "ATTENDANCE_ATTACHMENT",
            ...storedAttachment,
            caption: null,
            order: 0,
            uploadedById: actor.userId,
          }
        : undefined,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: enrollment.kindergartenId,
      actorUserId: actor.userId,
      objectType: "AttendanceRequest",
      objectId: request.id,
      childId,
      metadata: {
        requestedStatus: dto.requestedStatus,
        hasAttachment: Boolean(storedAttachment),
      },
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

/** One filled-in cell of the register, with the provenance the export needs. */
interface JournalCellFacts {
  status: string;
  note: string | null;
  createdAt: Date;
  recordedBy: { id: string; lastName: string | null; firstName: string } | null;
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

/** `YYYY-MM-DD` to midnight UTC, matching a `@db.Date` column. */
function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Every day in the range, inclusive of both ends.
 *
 * ★ Calendar days, not working days. Which days a kindergarten is open is a
 * question the register must not answer on its own — a Saturday with an
 * attendance record on it is a fact worth seeing, not a row to hide, and
 * `FundingService` already owns the working-day calculation for the months
 * where it matters.
 */
function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}
