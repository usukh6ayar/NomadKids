import { z } from "zod";
import { uuidSchema } from "./ids";
import { paginated } from "./pagination";

/**
 * Response shapes shared by the API and the web app.
 *
 * ★ Two rules govern everything in this file, and both come from the fact that
 * these schemas run at the boundary of a live system:
 *
 * 1. **Model only what the UI reads.** Zod strips unknown keys by default, so a
 *    field the API adds later cannot break a screen that never used it. Mirroring
 *    every Prisma column here would turn each backend `select` change into a
 *    frontend crash.
 *
 * 2. **Be generous about absence.** A field that is genuinely optional but typed
 *    as required throws at parse time, and the user sees a broken screen instead
 *    of a missing subtitle. `.nullish()` is the safe default for anything not
 *    guaranteed by a `NOT NULL` column.
 *
 * Dates cross the wire as ISO strings (`JSON.stringify(Date)`), so they are
 * `z.string()` here and parsed at the point of display — never `z.date()`.
 */

// ── Primitives ───────────────────────────────────────────────────────────────

export const roleSchema = z.enum(["ADMIN", "TEACHER", "PARENT", "COOK", "ACCOUNTANT"]);
export type Role = z.infer<typeof roleSchema>;

/**
 * Mongolian names for the roles — CLAUDE.md §5.
 *
 * ★ One map, so a role is called the same thing on the invite form, the user
 * list and the profile badge. Three screens had spelled "Багш" and "Эцэг эх"
 * inline, which is how a fourth screen ends up saying "Багш нар".
 */
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Админ",
  TEACHER: "Багш",
  PARENT: "Эцэг эх",
  COOK: "Тогооч",
  ACCOUNTANT: "Нягтлан",
};

/**
 * The roles an administrator may hand out, in the order the client listed them.
 *
 * ★ Every role the API accepts, which is the property `admin-users.test.tsx`
 * pins: "offers every role the API accepts, and no others". A picker that
 * drifts from `roleSchema` either hides a role that works or offers one that
 * 400s, and neither is discoverable from the screen.
 *
 * PARENT stays. A guardian is normally created by inviting them against a
 * child, which is what links the family to the record — but the API accepts
 * the role here and an administrator repairing a broken account needs the same
 * reach the API has.
 */
export const ASSIGNABLE_ROLES = ["ADMIN", "TEACHER", "PARENT", "COOK", "ACCOUNTANT"] as const;

export const sexSchema = z.enum(["MALE", "FEMALE"]);
/**
 * A child's standing — Order А/261, Annex 2 §1 item 7, mandatory.
 *
 * Four values, not two. `ARCHIVED` was renamed to `INACTIVE` in migration
 * `20260901120000`; nothing outside this file spelled the old name except the
 * child header, which now reads the label below.
 */
export const childStatusSchema = z.enum(["ACTIVE", "TEMPORARY", "ON_LEAVE", "INACTIVE"]);
export type ChildStatus = z.infer<typeof childStatusSchema>;

/** The words a director sees. English identifiers, Mongolian screens. */
export const CHILD_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Суралцаж байгаа",
  TEMPORARY: "Түр суралцаж байгаа",
  ON_LEAVE: "Чөлөөтэй",
  INACTIVE: "Идэвхгүй",
};

/** Үндсэн / хувилбарт сургалт — Order А/261, Annex 2 §1 items 5, 6, 13, 14. */
export const programKindSchema = z.enum(["MAIN", "ALTERNATIVE"]);
export type ProgramKind = z.infer<typeof programKindSchema>;

export const PROGRAM_KIND_LABEL: Record<string, string> = {
  MAIN: "Үндсэн сургалт",
  ALTERNATIVE: "Хувилбарт сургалт",
};

/** Сургалтын хэлбэр — Order А/261, Annex 2 §1 item 16. */
export const attendanceFormSchema = z.enum(["STANDARD", "EXTENDED", "SHORTENED"]);
export type AttendanceForm = z.infer<typeof attendanceFormSchema>;

export const ATTENDANCE_FORM_LABEL: Record<string, string> = {
  STANDARD: "Энгийн",
  EXTENDED: "Уртасгасан цаг",
  SHORTENED: "Богиносгосон цаг",
};
export const enrollmentStatusSchema = z.enum([
  "ACTIVE",
  "ENDED",
  "TRANSFERRED",
  "GRADUATED",
  /** Order А/261, Annex 2 §1 item 9 — анги дэвших, давтан суралцах. */
  "PROMOTED",
  "REPEATED",
]);

/**
 * How an enrollment period ended, in words and in a tint.
 *
 * ★ A table, because it was a nested ternary in two places.
 *
 * The enrollment archive and the general-info panel each carried their own
 * `GRADUATED ? … : TRANSFERRED ? … : "Дууссан"` ladder, so any status neither
 * of them named fell through to "Дууссан" — which is how `PROMOTED` and
 * `REPEATED` would have rendered as "ended" on the two screens a director reads
 * a child's history from. A ladder cannot be extended in one place; a table can.
 */
export const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Одоогийн",
  ENDED: "Дууссан",
  TRANSFERRED: "Шилжсэн",
  GRADUATED: "Төгссөн",
  PROMOTED: "Дэвшсэн",
  REPEATED: "Давтан суралцсан",
};

export const ENROLLMENT_STATUS_TONE: Record<string, "mint" | "sky" | "sun" | "neutral"> = {
  ACTIVE: "mint",
  ENDED: "neutral",
  TRANSFERRED: "sun",
  GRADUATED: "sky",
  // Moving up is the ordinary, good outcome — the same tint as graduating.
  PROMOTED: "sky",
  // Repeating is neither good nor bad, but it is the one a director looks for.
  REPEATED: "sun",
};
/** Who a guardian is to the child. Set by the guardian themselves when they
 * accept their invitation — see `invitationAcceptSchema`. */
export const guardianRelationSchema = z.enum([
  "MOTHER",
  "FATHER",
  "GRANDPARENT",
  "SIBLING",
  "OTHER",
]);
export type GuardianRelation = z.infer<typeof guardianRelationSchema>;

/**
 * "Хүү" / "Охин", not "Эрэгтэй" / "Эмэгтэй".
 *
 * The words a kindergarten uses about a four-year-old. Both registration forms
 * already spelled them inline; they live here now so the child's profile, the
 * roster and the forms cannot drift into three vocabularies for one field.
 */
export const SEX_LABEL: Record<string, string> = {
  MALE: "Хүү",
  FEMALE: "Охин",
};

/** Relation labels, so a list does not show a raw enum to a parent. */
export const GUARDIAN_RELATION_LABEL: Record<string, string> = {
  MOTHER: "Ээж",
  FATHER: "Аав",
  GRANDPARENT: "Өвөө/эмээ",
  SIBLING: "Ах/эгч",
  OTHER: "Бусад",
};
export const observationSourceSchema = z.enum(["TEACHER", "PARENT"]);
export const reviewStatusSchema = z.enum(["PENDING", "APPROVED", "RETURNED"]);
export const reportStatusSchema = z.enum(["QUEUED", "RUNNING", "DONE", "FAILED"]);
export const reportTypeSchema = z.enum(["CHILD_PORTFOLIO", "TERM_REPORT", "ANNUAL_REPORT"]);

export const REPORT_TYPE_LABEL: Record<string, string> = {
  CHILD_PORTFOLIO: "Хувийн хавтас",
  TERM_REPORT: "Улирлын тайлан",
  ANNUAL_REPORT: "Жилийн нэгдсэн тайлан",
};

/** A person's name as every list renders it. */
export const personRefSchema = z.object({
  id: uuidSchema,
  lastName: z.string(),
  firstName: z.string(),
});

export const namedRefSchema = z.object({ id: uuidSchema, name: z.string() });

// ── Auth ─────────────────────────────────────────────────────────────────────

export const membershipSchema = z.object({
  id: uuidSchema,
  kindergartenId: uuidSchema,
  role: roleSchema,
});

export const currentUserSchema = z.object({
  id: uuidSchema,
  username: z.string(),
  lastName: z.string(),
  firstName: z.string(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  /**
   * Platform operator, not a kindergarten role — CLAUDE.md §1.3. Absent from
   * older responses, so `.default(false)` rather than a required field: this is
   * UX only (it picks a nav and a landing page), and the API re-derives the
   * real authority from `User.isSuperAdmin` on every request regardless of what
   * this says.
   */
  isSuperAdmin: z.boolean().default(false),
});

export const sessionSchema = z.object({
  user: currentUserSchema,
  memberships: z.array(membershipSchema),
  csrfToken: z.string().nullish(),
});
export type Session = z.infer<typeof sessionSchema>;

/** `/auth/refresh` answers `{ user: null }` when there is no valid session. */
export const refreshResultSchema = z.union([sessionSchema, z.object({ user: z.null() })]);

// ── Children ─────────────────────────────────────────────────────────────────

export const groupRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  ageBand: z.string().nullish(),
});

export const enrollmentSummarySchema = z.object({
  id: uuidSchema.nullish(),
  group: groupRefSchema.nullish(),
  schoolYear: namedRefSchema.nullish(),
  /**
   * ★ The API already sends these; the schema simply did not declare them, and
   * Zod strips what it is not told about.
   *
   * `children.repository.ts` includes the enrollment without a `select`, so
   * every scalar comes back — and it orders `startedOn: "desc"`. Without
   * `status` a screen has to infer "current" from being first in the list,
   * which is wrong for any child who has left: their most recent enrollment is
   * an ENDED one. Nullish because `/children/mine` returns a slimmer row.
   */
  status: enrollmentStatusSchema.nullish(),
  startedOn: z.string().nullish(),
  endedOn: z.string().nullish(),
});

/**
 * `GET /children/:id/enrollment-archive` — the "Цэцэрлэг, бүлгийн архив" screen.
 *
 * A parent-facing read of where a child attends now, who to contact there, and
 * every kindergarten/group they were placed in before. `current` is the one
 * `ACTIVE` enrollment (null for a child registered but not yet enrolled, or one
 * who has left); `history` is the `ENDED`/`TRANSFERRED`/`GRADUATED` rows only.
 *
 * `teacherRoleSchema` mirrors the `TeacherRole` Prisma enum. The teacher block
 * carries a name and nothing else — contact details are staff-profile fields
 * the archive deliberately does not expose to families.
 */
export const teacherRoleSchema = z.enum(["LEAD", "ASSISTANT"]);

export const TEACHER_ROLE_LABEL: Record<z.infer<typeof teacherRoleSchema>, string> = {
  LEAD: "Ахлах багш",
  ASSISTANT: "Туслах багш",
};

export const enrollmentArchiveEntrySchema = z.object({
  id: uuidSchema,
  status: enrollmentStatusSchema,
  startedOn: z.string(),
  endedOn: z.string().nullable(),
  kindergarten: namedRefSchema,
  group: namedRefSchema.nullable(),
  schoolYear: namedRefSchema.nullable(),
});

export const enrollmentArchiveTeacherSchema = z.object({
  id: uuidSchema,
  lastName: z.string(),
  firstName: z.string(),
  role: teacherRoleSchema,
});

export const enrollmentArchiveSchema = z.object({
  /** For the hero — saves the page a second `/children/:id` fetch. */
  child: z.object({
    id: uuidSchema,
    firstName: z.string(),
    lastName: z.string(),
    dateOfBirth: z.string().nullable().optional(),
  }),
  current: z
    .object({
      id: uuidSchema,
      startedOn: z.string(),
      schoolYear: namedRefSchema.nullable(),
      kindergarten: z.object({
        id: uuidSchema,
        name: z.string(),
        address: z.string().nullable(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
        description: z.string().nullable(),
      }),
      group: z
        .object({
          id: uuidSchema,
          name: z.string(),
          schedule: z.string().nullable(),
          rules: z.string().nullable(),
        })
        .nullable(),
      teachers: z.array(enrollmentArchiveTeacherSchema),
    })
    .nullable(),
  /** Past placements only (`status !== "ACTIVE"`), newest first. */
  history: z.array(enrollmentArchiveEntrySchema),
});
export type EnrollmentArchive = z.infer<typeof enrollmentArchiveSchema>;

/**
 * Which of the three basic facts a child's record is still missing.
 *
 * ★ Booleans, never the values themselves.
 *
 * "Is there a health note" is a safe thing to put in a roster of thirty
 * children; the note itself is not, and a list endpoint that carried it would
 * be handing every teacher the text of every child's medical history to render
 * a percentage. The same argument covers the guardian's phone number.
 *
 * ★★ Three, matching the reference system's own check — photograph, health
 * information, a guardian who can be reached. They are the three a teacher is
 * chased for and the three that are useless to discover on the morning they
 * are needed.
 */
export const childProfileCompletionSchema = z.object({
  photo: z.boolean(),
  health: z.boolean(),
  guardianContact: z.boolean(),
});
export type ChildProfileCompletion = z.infer<typeof childProfileCompletionSchema>;

/** How many of the three are done. Shared so the label cannot drift from the ring. */
export function completionPercent(c: ChildProfileCompletion): number {
  const done = [c.photo, c.health, c.guardianContact].filter(Boolean).length;
  return Math.round((done / 3) * 100);
}

export const childSummarySchema = z.object({
  id: uuidSchema,
  lastName: z.string(),
  firstName: z.string(),
  /**
   * ★ On the summary since 2026-09-04, for the roster table's Регистр column.
   *
   * `nullish` rather than required, and that is the honest shape: a newly
   * arrived child may not have one recorded yet (`nationalIdSchema` is optional
   * throughout for that reason), and `/children/mine` returns a slimmer row
   * that does not select it at all.
   */
  nationalId: z.string().nullish(),
  /**
   * Гадаад иргэн, and the identifier that stands in for a регистр.
   *
   * ★ On the summary because the roster's Регистр column is otherwise a lie by
   * omission: a foreign child has no `nationalId` and never will, so the cell
   * reads "—" exactly like a child whose регистр nobody has typed in yet. Those
   * are different states, and the second one is a to-do.
   */
  isForeign: z.boolean().nullish(),
  foreignId: z.string().nullish(),
  sex: sexSchema.nullish(),
  dateOfBirth: z.string(),
  status: childStatusSchema.nullish(),
  photoMediaFileId: uuidSchema.nullish(),
  // `/children/mine` returns a slimmer row with no enrollments at all, so this
  // defaults rather than being required.
  enrollments: z.array(enrollmentSummarySchema).default([]),
  /*
   * ★ Optional, and staff-only in practice.
   *
   * The paginated `/children` roster computes it; `/children/mine` does not,
   * so a guardian is never told their own child's record is "67% complete" —
   * that is a message for whoever can act on it, and most of what is missing
   * is the kindergarten's to fill in, not theirs.
   */
  profile: childProfileCompletionSchema.optional(),
});
export type ChildSummary = z.infer<typeof childSummarySchema>;

export const guardianshipSchema = z.object({
  id: uuidSchema,
  relation: z.string(),
  canView: z.boolean().nullish(),
  isPrimary: z.boolean().nullish(),
  guardian: personRefSchema
    .extend({ phone: z.string().nullish(), email: z.string().nullish() })
    .nullish(),
});

export const childDetailSchema = childSummarySchema.extend({
  /*
   * ★ `nationalId` is inherited from the summary now, and this note used to say
   * the opposite — "on the detail response only, never on a list" — 2026-09-04.
   *
   * The reasoning was real: it is the one field that identifies a child outside
   * this system, so it travelled with the single record somebody opened rather
   * than with every row of a roster. What changed is that the client asked for
   * a Регистр column on the roster table, and the exposure that argument was
   * protecting against does not exist here: `/children` is staff-only, returns
   * only children the caller may already open one at a time, and every download
   * of the same data through the export already writes a `DOWNLOAD` audit row.
   *
   * The note is corrected rather than left standing beside a schema that
   * contradicts it — a comment that describes a rule the code stopped following
   * is how the next reader learns to stop reading the comments.
   */
  healthNotes: z.string().nullish(),
  kindergarten: namedRefSchema.nullish(),
  guardianships: z.array(guardianshipSchema).default([]),
});
export type ChildDetail = z.infer<typeof childDetailSchema>;

// ── Observations ─────────────────────────────────────────────────────────────

export const observationMediaSchema = z.object({
  id: uuidSchema,
  caption: z.string().nullish(),
  order: z.number().nullish(),
  originalName: z.string().nullish(),
});

export const observationSchema = z.object({
  id: uuidSchema,
  childId: uuidSchema.nullish(),
  observedOn: z.string(),
  source: observationSourceSchema,
  reviewStatus: reviewStatusSchema,
  visibleToParents: z.boolean(),
  includeInReport: z.boolean().nullish(),
  activityName: z.string().nullish(),
  situation: z.string().nullish(),
  childDid: z.string().nullish(),
  childSaid: z.string().nullish(),
  teacherComment: z.string().nullish(),
  nextSteps: z.string().nullish(),
  reviewNote: z.string().nullish(),
  type: z.object({ id: uuidSchema, name: z.string(), code: z.string().nullish() }).nullish(),
  author: personRefSchema.nullish(),
  media: z.array(observationMediaSchema).default([]),
});
export type Observation = z.infer<typeof observationSchema>;

export const observationTypeSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string().nullish(),
});

// ── Attendance ───────────────────────────────────────────────────────────────

/**
 * ★ Six, not five. `OTHER` was missing here until 2026-09-02.
 *
 * The Prisma enum has always had six values, `ATTENDANCE_STATUS_LABEL` below
 * names six, `attendanceCountsSchema` counts six, and the funding register
 * filters on six. Only this schema — and `recordAttendanceSchema`, which
 * mirrors it — stopped at five.
 *
 * The failure was silent in the worst direction. The teacher's day sheet draws
 * its buttons from `Object.entries(ATTENDANCE_STATUS_LABEL)`, so "Бусад" has
 * been on screen the whole time; pressing it sent a status the API refused.
 * A control that renders and then fails is worse than one that was never
 * offered, because the teacher blames themselves.
 */
export const attendanceStatusSchema = z.enum([
  "PRESENT",
  "HALF_DAY",
  "EXCUSED",
  "SICK",
  "ABSENT",
  "OTHER",
]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

/**
 * The six statuses, named — one map, read by the web app and by the API's
 * spreadsheet alike.
 *
 * ★ It lives here rather than in either app because both render it.
 *
 * The API names things in codes everywhere except in a file: a spreadsheet is
 * opened in Excel by somebody who never sees this product, so its header row
 * has to be readable on its own. That gave the workbook a second copy of these
 * five words, and a second copy is how "Хагас өдөр" becomes "Хагас хоног" on
 * one surface. Shared, it cannot.
 */
export const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  PRESENT: "Ирсэн",
  HALF_DAY: "Хагас өдөр",
  EXCUSED: "Чөлөөтэй",
  SICK: "Өвчтэй",
  ABSENT: "Тасалсан",
  OTHER: "Бусад",
};

/**
 * The kindergarten-wide attendance register — a child per row, a day per
 * column, over any range of dates.
 *
 * ★ `days` on a row is positional: index N is `days[N]` of the response's own
 * `days` array, and `null` means nothing was recorded. A missing mark and an
 * absence are different facts, and the register must not merge them — the
 * second becomes a funding claim, the first is a gap in the paperwork.
 */
export const attendanceJournalCellSchema = z.object({
  status: attendanceStatusSchema,
  note: z.string().nullable(),
});

export const attendanceJournalRowSchema = z.object({
  childId: z.string(),
  child: z.object({
    id: z.string(),
    lastName: z.string().nullable(),
    firstName: z.string(),
    status: z.string(),
  }),
  group: z.object({
    id: z.string(),
    name: z.string(),
    ageBand: z.string().nullable(),
    programKind: z.string(),
    attendanceForm: z.string(),
  }),
  days: z.array(attendanceJournalCellSchema.nullable()),
  /** Only the statuses that occur — a status with no days is simply absent. */
  counts: z.record(z.string(), z.number()),
  recorded: z.number(),
});
export type AttendanceJournalRow = z.infer<typeof attendanceJournalRowSchema>;

/**
 * ★ "Journal", not "register", and the distinction is not cosmetic.
 *
 * `attendanceRegisterSchema` further down is the **funding** register —
 * нэмэлт.md §6's monthly reconciliation, one row per child with money on it.
 * This is the raw attendance grid the director reads, and it feeds that one.
 * Two things called the register is how somebody eventually imports the wrong
 * schema and gets a type error at best.
 */
export const attendanceJournalSchema = paginated(attendanceJournalRowSchema).extend({
  from: z.string(),
  to: z.string(),
  days: z.array(z.string()),
  /** Across every matching child, not the page — a total that moved with the page would mislead. */
  totals: z.record(z.string(), z.number()),
});
export type AttendanceJournal = z.infer<typeof attendanceJournalSchema>;

/**
 * "Өдөр тутмын ирц" — the director's register, a row per group per day.
 *
 * ★ The client's own column list, in their order, 2026-09-04.
 *
 * `Хичээлийн жил` leads it: their list began at "Сургууль, цэцэрлэг", and a
 * register with no school year on it cannot be filed. The rest follow exactly.
 *
 * ★★ No controls, and that is the whole point of a second attendance screen.
 *
 * The group day sheet is a child per row with six buttons each, because a
 * teacher's job there is to record. A director does not press those — they
 * asked for the numbers as they already stand — so this response carries no
 * child ids and nothing writable.
 */
export const dailyAttendanceRowSchema = z.object({
  schoolYear: z.string(),
  groupId: z.string(),
  group: z.string(),
  date: z.string(),
  /** The roster: every actively enrolled child, marked or not. */
  expected: z.number(),
  recorded: z.number(),
  unrecorded: z.number(),
  /**
   * ★ A boolean, not a percentage.
   *
   * `expected` and `recorded` stay separate for the reason the admin dashboard
   * records: one ratio cannot tell "nobody has filled this in" from "nobody
   * came in". At this grain the useful form is yes/no, with `unrecorded` beside
   * it saying how far off.
   */
  complete: z.boolean(),
  /** `HALF_DAY` counts here — a half day is a child who came. */
  present: z.number(),
  excused: z.number(),
  sick: z.number(),
  absent: z.number(),
  /**
   * When this group-day was submitted — "Илгээсэн".
   *
   * ★ A real timestamp now, set by the Илгээх button; null until pressed.
   *
   * The eventual destination is ESIS, and that transport does not exist —
   * `docs/ESIS_API_READINESS.md` §1 records that access is a contract
   * with the ministry rather than a signup. What the button records today is
   * the act this system can witness: a director declaring a register final,
   * with who and when. The ESIS call attaches to the same `AttendanceSubmission`
   * row when it arrives, so this field does not change shape then.
   */
  sentAt: z.string().nullish(),
  /** Who pressed Илгээх. Null alongside a null `sentAt`. */
  sentBy: z.string().nullish(),
  /** The earliest write, not the last edit — when the register was started. */
  createdAt: z.string().nullish(),
  /** More than one name when a correction came from a second person. */
  createdBy: z.array(z.string()).default([]),
});
export type DailyAttendanceRow = z.infer<typeof dailyAttendanceRowSchema>;

export const dailyAttendanceSchema = z.object({
  kindergartenName: z.string(),
  from: z.string(),
  to: z.string(),
  items: z.array(dailyAttendanceRowSchema),
  totals: z.object({
    expected: z.number(),
    unrecorded: z.number(),
    present: z.number(),
    excused: z.number(),
    sick: z.number(),
    absent: z.number(),
    /** Group-days fully filled in — the figure that drives a chase. */
    complete: z.number(),
    /** How many are already submitted — what Илгээх has left to do. */
    sent: z.number(),
    days: z.number(),
  }),
});
export type DailyAttendance = z.infer<typeof dailyAttendanceSchema>;

/**
 * The result of pressing Илгээх — what was recorded as submitted.
 *
 * Returned rather than a bare 204 so the screen can confirm the count without a
 * refetch, and so a caller can see which days actually landed when some were
 * skipped as not belonging to this kindergarten.
 */
export const attendanceSubmissionSchema = z.object({
  groupId: z.string(),
  date: z.string(),
  submittedAt: z.string(),
});
export type AttendanceSubmissionResult = z.infer<typeof attendanceSubmissionSchema>;

/** Exact API-000269 request body, prepared before an attendance submission. */
export const esisAttendancePayloadSchema = z.object({
  institutionId: z.number().int().positive(),
  studentGroupId: z.number().int().positive(),
  dayDate: z.iso.date(),
  attendanceList: z.array(
    z.object({
      personId: z.number().int().positive(),
      attendReasonCode: z.enum(["PRESENT", "EXCUSED", "SICK", "UNEXCUSED"]),
      tardyMinutes: z.number().int().min(0),
      attendReasonList: z.array(z.string()),
    }),
  ),
});
export type EsisAttendancePayload = z.infer<typeof esisAttendancePayloadSchema>;

export const esisAttendancePreviewSchema = z.object({
  demo: z.boolean(),
  apiId: z.number().int().positive(),
  endpoint: z.string(),
  requests: z.array(
    z.object({
      groupId: z.string(),
      groupName: z.string(),
      payload: esisAttendancePayloadSchema,
    }),
  ),
});
export type EsisAttendancePreview = z.infer<typeof esisAttendancePreviewSchema>;

export const attendanceRequestStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type AttendanceRequestStatus = z.infer<typeof attendanceRequestStatusSchema>;

/** Who handed the child over — at drop-off and, separately, at pickup. See
 * the `AttendanceCompanion` doc comment in schema.prisma for why this is not
 * `GuardianRelation`. */
export const attendanceCompanionSchema = z.enum(["MOTHER", "FATHER", "OTHER"]);
export type AttendanceCompanion = z.infer<typeof attendanceCompanionSchema>;

export const attendanceRecordSchema = z.object({
  id: uuidSchema,
  childId: uuidSchema,
  date: z.string(),
  status: attendanceStatusSchema,
  note: z.string().nullish(),
  recordedBy: personRefSchema.nullish(),
  arrivedWith: attendanceCompanionSchema.nullish(),
  /** Set only when `arrivedWith` is OTHER — a category alone cannot carry a name. */
  arrivedWithName: z.string().nullish(),
  arrivedAt: z.string().nullish(),
  pickedUpWith: attendanceCompanionSchema.nullish(),
  /** Same, for `pickedUpWith` OTHER. */
  pickedUpWithName: z.string().nullish(),
  pickedUpAt: z.string().nullish(),
});
export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;

/** Per-status counts for a month — never a collapsed "funding day" figure. */
export const attendanceSummarySchema = z.record(attendanceStatusSchema, z.number());
export type AttendanceSummary = z.infer<typeof attendanceSummarySchema>;

/** One row of a group's day sheet — a child, reconciled against whatever has
 * already been marked. `record` is `null` for a child nobody has marked yet. */
export const groupAttendanceRowSchema = z.object({
  child: personRefSchema,
  enrollmentId: uuidSchema,
  record: z
    .object({ id: uuidSchema, status: attendanceStatusSchema, note: z.string().nullish() })
    .nullish(),
});
export type GroupAttendanceRow = z.infer<typeof groupAttendanceRowSchema>;

export const attendanceRequestSchema = z.object({
  id: uuidSchema,
  childId: uuidSchema,
  dateFrom: z.string(),
  dateTo: z.string(),
  requestedStatus: attendanceStatusSchema,
  reason: z.string().nullish(),
  reviewStatus: attendanceRequestStatusSchema,
  reviewedBy: personRefSchema.nullish(),
  reviewedAt: z.string().nullish(),
  requestedBy: personRefSchema.nullish(),
  createdAt: z.string(),
  /** A guardian's own arrival claim — set only when `requestedStatus` is
   * PRESENT ("Ирц мэдэгдэх"), not a leave notice. */
  arrivedWith: attendanceCompanionSchema.nullish(),
  arrivedWithName: z.string().nullish(),
  arrivedAt: z.string().nullish(),
  /** The same guardian's second, later request the same day — "Гарсныг
   * мэдэгдэх" at pickup. Always its own row; see schema.prisma's own note
   * on `AttendanceRequest.pickedUpWith`. */
  pickedUpWith: attendanceCompanionSchema.nullish(),
  pickedUpWithName: z.string().nullish(),
  pickedUpAt: z.string().nullish(),
  attachment: z
    .object({
      id: uuidSchema,
      originalName: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
    })
    .nullish(),
});
export type AttendanceRequest = z.infer<typeof attendanceRequestSchema>;

// ── Meals ────────────────────────────────────────────────────────────────────

export const mealKindSchema = z.enum([
  "BREAKFAST",
  "MID_MORNING_SNACK",
  "LUNCH",
  "AFTERNOON_SNACK",
  "EXTRA",
]);
export type MealKind = z.infer<typeof mealKindSchema>;

export const MEAL_KIND_LABEL: Record<string, string> = {
  BREAKFAST: "Өглөөний цай",
  MID_MORNING_SNACK: "Жүүс",
  LUNCH: "Өдрийн хоол",
  AFTERNOON_SNACK: "Их үдийн цай",
  EXTRA: "Оройн хоол",
};

/** Whether a child ate — `нэмэлт.md` §2. */
export const mealStatusSchema = z.enum(["TAKEN", "NOT_TAKEN", "PARTIAL", "SPECIAL"]);
export type MealStatus = z.infer<typeof mealStatusSchema>;

export const MEAL_STATUS_LABEL: Record<string, string> = {
  TAKEN: "Авсан",
  NOT_TAKEN: "Аваагүй",
  PARTIAL: "Хэсэгчлэн",
  SPECIAL: "Тусгай хоол",
};

export const menuDishSchema = z.object({
  name: z.string(),
  allergenTags: z.array(z.string()).default([]),
  /** Which sitting this dish belongs to. Absent on rows written before this existed. */
  kind: mealKindSchema.nullish(),
  /** The cook's full recipe line — separate from `allergenTags`, which stays a
   * short controlled list for the cross-check to match on. */
  ingredients: z.string().nullish(),
  note: z.string().nullish(),
  calories: z.number().int().nullish(),
  portions: z.number().nullish(),
  /**
   * The технологийн карт this dish was cooked from, if any — Хоол
   * үйлдвэрлэл's "батлагдсан цэс". When set, `name`/`allergenTags`/`calories`
   * above are resolved from the (APPROVED) recipe by the API rather than
   * trusted from what was typed; `portions` is what `POST .../consume` scales
   * the recipe's ingredient quantities by.
   */
  recipeId: uuidSchema.nullish(),
  /** A photograph of the dish as plated. */
  photoMediaFileId: uuidSchema.nullish(),
});
export type MenuDish = z.infer<typeof menuDishSchema>;

export const menuDayStatusSchema = z.enum(["DRAFT", "APPROVED"]);
export type MenuDayStatus = z.infer<typeof menuDayStatusSchema>;

export const MENU_DAY_STATUS_LABEL: Record<MenuDayStatus, string> = {
  DRAFT: "Ноорог",
  APPROVED: "Батлагдсан",
};

export const menuDaySchema = z.object({
  id: uuidSchema,
  date: z.string(),
  dishes: z.array(menuDishSchema),
  totalCalories: z.number().int().nullish(),
  status: menuDayStatusSchema,
  approvedAt: z.string().nullish(),
  consumedAt: z.string().nullish(),
});
export type MenuDay = z.infer<typeof menuDaySchema>;

/**
 * One saved record, as `PUT /groups/:id/meals` returns them — `нэмэлт.md` §2.
 *
 * A different resource from the menu above: `MenuDay` is what the kitchen
 * planned to cook, kindergarten-wide; `MealRecord` is what one child actually
 * ate at one sitting. They share the `MealKind` vocabulary and nothing else —
 * no foreign key, no join. §3 computes the food cost from **хооллосон өдөр**,
 * days eaten, which is why this cannot be inferred from `Attendance` either: a
 * child collected before lunch attended and did not eat.
 *
 * ★ The API answers with the whole Prisma row; this names the fields the
 * product uses and zod drops the rest. Adding `kindergartenId` or
 * `recordedById` here would put ids on the wire that no screen reads.
 */
export const mealRecordSchema = z.object({
  id: uuidSchema,
  childId: uuidSchema,
  date: z.string(),
  kind: mealKindSchema,
  status: mealStatusSchema,
  note: z.string().nullish(),
});
export type MealRecord = z.infer<typeof mealRecordSchema>;

/**
 * One row of a group's sitting — a child, reconciled against whatever has been
 * marked. `record` is `null` for a child nobody has marked yet, and that is the
 * point of a register rather than a list of what happened.
 *
 * The same shape as `groupAttendanceRowSchema`, because the API builds both the
 * same way: the roster comes from `Enrollment`, never from the records.
 */
export const groupMealRowSchema = z.object({
  child: personRefSchema,
  enrollmentId: uuidSchema,
  record: mealRecordSchema.nullish(),
});
export type GroupMealRow = z.infer<typeof groupMealRowSchema>;

/**
 * Тараалт — one group's sitting, marked as distributed. Client request,
 * 2026-09-05.
 *
 * ★ Not `MealRecord` with the child left off. `MealRecord` answers "did this
 * child eat" and is written by a teacher, per child; this answers "has the
 * kitchen sent food to this room yet" and is written by a cook, once per
 * group per sitting, off the same "Ирц" screen that shows headcounts for
 * portioning. Nothing here names a child.
 */
export const mealServingSchema = z.object({
  id: uuidSchema,
  groupId: uuidSchema,
  kind: mealKindSchema,
  servedAt: z.string(),
  servedBy: personRefSchema.nullish(),
});
export type MealServing = z.infer<typeof mealServingSchema>;

/*
 * ★ The staff menu — `menuDayWithWarningsSchema` — is NOT here.
 *
 * It carries allergy severities, so it needs `allergySeveritySchema`, which the
 * health section declares further down this file. A `const` is not hoisted:
 * referencing it from here would throw on module evaluation, not at build.
 * It lives at the end of the health section instead.
 */

// ── Surveys ──────────────────────────────────────────────────────────────────

export const surveyScopeSchema = z.enum(["CHILD", "KINDERGARTEN"]);
export type SurveyScope = z.infer<typeof surveyScopeSchema>;

export const surveyStatusSchema = z.enum(["DRAFT", "PUBLISHED", "CLOSED"]);
export type SurveyStatus = z.infer<typeof surveyStatusSchema>;

/** RFP Module 1.1's archival classification, and Module 1.2's pairing key. */
export const surveyPeriodSchema = z.enum(["BASELINE", "MIDLINE", "ENDLINE"]);
export type SurveyPeriod = z.infer<typeof surveyPeriodSchema>;

export const SURVEY_PERIOD_LABEL: Record<SurveyPeriod, string> = {
  BASELINE: "Эхний үнэлгээ",
  MIDLINE: "Завсрын үнэлгээ",
  ENDLINE: "Жилийн эцсийн үнэлгээ",
};

export const surveyQuestionTypeSchema = z.enum([
  "RATING",
  "YES_NO",
  "TEXT",
  /** Pick exactly one of `options` — the client's "Нэг сонголт". */
  "SINGLE_CHOICE",
  "CHECKBOX",
  /** RFP Module 1.1 — several indicators on one shared scale. */
  "MATRIX",
]);
export type SurveyQuestionType = z.infer<typeof surveyQuestionTypeSchema>;

/** Mongolian labels — CLAUDE.md §5. The composer and the answering form share them. */
export const SURVEY_QUESTION_TYPE_LABEL: Record<SurveyQuestionType, string> = {
  RATING: "Үнэлгээ (1–5)",
  YES_NO: "Тийм/Үгүй",
  TEXT: "Чөлөөт бичвэр",
  SINGLE_CHOICE: "Нэг сонголт",
  CHECKBOX: "Олон сонголт",
  MATRIX: "Матриц (олон үзүүлэлт)",
};

/** Which of the two question types carries a plain list of choices. */
export const OPTION_QUESTION_TYPES = ["SINGLE_CHOICE", "CHECKBOX"] as const;

/** Whether this question's `options` is a `string[]` the composer should edit. */
export function hasOptionList(type: SurveyQuestionType): boolean {
  return (OPTION_QUESTION_TYPES as readonly string[]).includes(type);
}

/**
 * Poll or form — the client's 2026-08-31 request.
 *
 * A poll is one question read as a bar on the class board; a form is a
 * questionnaire. See the note on `SurveyKind` in `schema.prisma` for why this
 * is stored rather than inferred from the question count.
 */
export const surveyKindSchema = z.enum(["POLL", "FORM"]);
export type SurveyKind = z.infer<typeof surveyKindSchema>;

export const SURVEY_KIND_LABEL: Record<SurveyKind, string> = {
  POLL: "Пол",
  FORM: "Форм судалгаа",
};

/** The one-line description each kind carries on the composer's two tabs. */
export const SURVEY_KIND_HINT: Record<SurveyKind, string> = {
  POLL: "Нэг асуулт, шууд дүн",
  FORM: "Олон асуулт, дэлгэрэнгүй хариулт",
};

/** A MATRIX question's shape — RFP Module 1.1. */
export const matrixOptionsSchema = z.object({
  rows: z.array(z.object({ key: z.string(), label: z.string() })),
  columns: z.array(z.object({ value: z.number(), label: z.string() })),
});
export type MatrixOptions = z.infer<typeof matrixOptionsSchema>;

export const surveyQuestionSchema = z.object({
  id: uuidSchema,
  order: z.number(),
  type: surveyQuestionTypeSchema,
  prompt: z.string(),
  /** CHECKBOX's choices, or a MATRIX's rows and columns. */
  options: z.union([z.array(z.string()), matrixOptionsSchema]).nullish(),
  /**
   * What this question measures, stable across waves — RFP Module 1.2.
   * Null means "not comparable", which is honest for a one-off poll.
   */
  indicatorKey: z.string().nullish(),
});
export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;

export const surveySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullish(),
  scope: surveyScopeSchema,
  /** Defaulted for rows written before the column existed. */
  kind: surveyKindSchema.catch("FORM"),
  status: surveyStatusSchema,
  publishedAt: z.string().nullish(),
  closedAt: z.string().nullish(),
  /**
   * The optional deadline. Null is "no closing date", which the client asked
   * to stay possible — see `Survey.closesAt` for why it is not `closedAt`.
   */
  closesAt: z.string().nullish(),
  createdAt: z.string(),
  /** "2025-2026" — a school year spans two calendar years. */
  schoolYear: z.string().nullish(),
  /** Which wave: RFP Module 1.1's эхний/завсрын/жилийн эцсийн үнэлгээ. */
  period: surveyPeriodSchema.nullish(),
  clonedFromSurveyId: uuidSchema.nullish(),
  /**
   * Which group the survey is for — null is every group.
   *
   * ★ Added 2026-09-06. Null and "every group listed" are deliberately not the
   * same thing: a survey aimed at everyone keeps reaching families who enrol
   * after it was published. `Survey.groupId` in the schema states the rule and
   * `notifications.dto.ts` states the same one for notices.
   */
  groupId: uuidSchema.nullish(),
  /** The group's name, for the staff list. Absent when `groupId` is null. */
  group: namedRefSchema.nullish(),
  questions: z.array(surveyQuestionSchema).default([]),
  /** Set only on the child-facing list — has this guardian already answered
   * for this child (or, for a KINDERGARTEN-scope survey, at all)? */
  respondedByMe: z.boolean().nullish(),
});
export type Survey = z.infer<typeof surveySchema>;

/** One indicator's begin-to-end movement — RFP Module 1.2. */
export const indicatorComparisonSchema = z.object({
  indicatorKey: z.string(),
  rowKey: z.string().nullish(),
  label: z.string(),
  baselineMean: z.number().nullish(),
  endlineMean: z.number().nullish(),
  maxScore: z.number().nullish(),
  delta: z.number().nullish(),
  /** Progress as a share of the scale, not of the baseline. */
  deltaPercent: z.number().nullish(),
  baselineCount: z.number(),
  endlineCount: z.number(),
});
export type IndicatorComparison = z.infer<typeof indicatorComparisonSchema>;

export const surveyComparisonSchema = z.object({
  baseline: z
    .object({ id: uuidSchema, title: z.string(), period: surveyPeriodSchema.nullish() })
    .nullable(),
  indicators: z.array(indicatorComparisonSchema),
  children: z.array(
    z.object({ childId: uuidSchema, indicators: z.array(indicatorComparisonSchema) }),
  ),
  /** Why there is nothing to compare, when there is nothing to compare. */
  note: z.string().nullable(),
});
export type SurveyComparison = z.infer<typeof surveyComparisonSchema>;

/**
 * A single answer's value: a number (RATING), a boolean (YES_NO), a string
 * (TEXT), a string array (CHECKBOX), or one score per row (MATRIX).
 *
 * The matrix case is a record keyed by the question's own row keys, so it
 * cannot be given a fixed shape here. The API checks each key and value against
 * the question's `options` before storing, so an answer naming a row that does
 * not exist is refused rather than saved as data nothing can score.
 */
export const surveyAnswerValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.array(z.string()),
  z.record(z.string(), z.number()),
]);
export type SurveyAnswerValue = z.infer<typeof surveyAnswerValueSchema>;

export const surveyAnswerSchema = z.object({
  questionId: uuidSchema,
  value: surveyAnswerValueSchema,
});
export type SurveyAnswer = z.infer<typeof surveyAnswerSchema>;

/** One question's aggregated results — shape depends on the question type:
 * RATING/YES_NO carry `counts` keyed by value; TEXT carries raw `responses`. */
export const surveyQuestionResultSchema = z.object({
  question: surveyQuestionSchema,
  responseCount: z.number(),
  counts: z.record(z.string(), z.number()).nullish(),
  responses: z.array(z.string()).nullish(),
});
export type SurveyQuestionResult = z.infer<typeof surveyQuestionResultSchema>;

/**
 * One group's answers to one survey — the row a comparison chart draws a bar
 * from.
 *
 * ★ `group.id` is nullable, and the null case is named rather than dropped.
 *
 * A response with no child — a survey aimed at staff — belongs to no group. It
 * is counted under "Бүлэггүй" because a breakdown whose parts do not sum to the
 * total is a breakdown nobody can check against the headline above it.
 */
export const surveyGroupResultSchema = z.object({
  group: z.object({ id: uuidSchema.nullable(), name: z.string() }),
  responseCount: z.number(),
  questions: z.array(
    z.object({
      questionId: uuidSchema,
      responseCount: z.number(),
      counts: z.record(z.string(), z.number()).nullable(),
    }),
  ),
});
export type SurveyGroupResult = z.infer<typeof surveyGroupResultSchema>;

export const surveyResultsSchema = z.object({
  survey: surveySchema,
  totalResponses: z.number(),
  /**
   * How many responses the survey is waiting on — the client's "Бөглөөгүй".
   *
   * `expectedResponses` is enrolled children for a CHILD survey and distinct
   * guardians for a KINDERGARTEN one, narrowed by `groupId` where it applies;
   * `missingResponses` is the difference, floored at zero. Both are computed by
   * the API, which is the only side that can see enrolments and memberships.
   *
   * Defaulted so a client reading a response from an older API renders a
   * headline of zero rather than crashing on a missing key.
   */
  expectedResponses: z.number().default(0),
  missingResponses: z.number().default(0),
  /** Which group the headline is narrowed to. Null when it covers everyone. */
  groupId: uuidSchema.nullish(),
  questions: z.array(surveyQuestionResultSchema),
  /**
   * ★ Always every group, never narrowed by `groupId`.
   *
   * The filter changes what the top of the screen counts; the comparison
   * beneath it stays whole, because a comparison filtered to one group is a
   * chart with one bar.
   */
  byGroup: z.array(surveyGroupResultSchema).default([]),
});
export type SurveyResults = z.infer<typeof surveyResultsSchema>;

// ── Assessment ───────────────────────────────────────────────────────────────

export const domainSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullish(),
  order: z.number().nullish(),
});

export const levelSchema = z.object({
  id: uuidSchema,
  value: z.number(),
  label: z.string(),
  color: z.string().nullish(),
});

export const assessmentConfigSchema = z.object({
  domains: z.array(domainSchema),
  levels: z.array(levelSchema),
});

export const termSchema = z.object({
  id: uuidSchema,
  number: z.number(),
  name: z.string(),
  startsOn: z.string().nullish(),
  endsOn: z.string().nullish(),
  schoolYear: namedRefSchema.nullish(),
});
export type Term = z.infer<typeof termSchema>;

export const assessmentSchema = z.object({
  id: uuidSchema,
  comment: z.string().nullish(),
  visibleToParents: z.boolean().nullish(),
  domain: domainSchema.nullish(),
  level: levelSchema.nullish(),
  term: z.object({ id: uuidSchema, number: z.number(), name: z.string() }).nullish(),
});

/** The teacher's one-domain-at-a-time grid. */
export const groupColumnSchema = z.object({
  group: namedRefSchema,
  term: z.object({ id: uuidSchema, number: z.number(), name: z.string() }),
  domain: domainSchema,
  levels: z.array(levelSchema),
  children: z.array(
    z.object({
      childId: uuidSchema,
      lastName: z.string(),
      firstName: z.string(),
      photoMediaFileId: uuidSchema.nullish(),
      assessment: z
        .object({
          levelId: uuidSchema,
          comment: z.string().nullish(),
          visibleToParents: z.boolean().nullish(),
        })
        .nullish(),
      /**
       * The level this child was given for the **same domain in the previous
       * term of the same year** — RFP §6.3's "өмнөх үнэлгээтэй харьцуулах".
       *
       * ★ `null` in the first term, and `null` for a child nobody assessed
       * last term. The screen shows "—" for both: a teacher cannot act on the
       * difference, and spelling it out would put two kinds of nothing on the
       * densest screen in the product.
       *
       * ★★ Carries `value` and `label`, not just an id. The level may since
       * have been renamed or retired by an administrator (§2.3), and this is a
       * record of what was said at the time — resolving the id against today's
       * list would silently relabel history.
       */
      previous: z.object({ id: uuidSchema, value: z.number(), label: z.string() }).nullish(),
    }),
  ),
});
export type GroupColumn = z.infer<typeof groupColumnSchema>;

/**
 * The term report.
 *
 * Absent and not-yet-final return the **same** shape — an object with
 * `exists: false` rather than a null body. Distinguishing them would tell a
 * parent that a draft about their child exists.
 */
export const termReportSchema = z.object({
  id: uuidSchema.nullish(),
  exists: z.boolean().nullish(),
  status: z.enum(["DRAFT", "FINAL"]).nullish(),
  strengths: z.string().nullish(),
  needsSupport: z.string().nullish(),
  nextGoals: z.string().nullish(),
  adviceForParents: z.string().nullish(),
  finalizedAt: z.string().nullish(),
  author: personRefSchema.nullish(),
});

// ── Portfolio ────────────────────────────────────────────────────────────────

export const aboutMeSchema = z.object({
  introduction: z.string().nullish(),
  nameMeaning: z.string().nullish(),
  memorableSayings: z.string().nullish(),
  dream: z.string().nullish(),
  distinguishingTraits: z.string().nullish(),
  // Added 2026-08-28, on the client's instruction — not in RFP §4.1.
  clanName: z.string().nullish(),
  nickname: z.string().nullish(),
  birthplace: z.string().nullish(),
  bloodType: z.string().nullish(),
  eyeColor: z.string().nullish(),
  // A guardian's manual pick, overriding birthFacts()'s computed answer —
  // see ChildProfile's own doc comment. Resolved server-side into
  // BirthdaySection's zodiac/yearAnimal; these two are the raw stored
  // override codes, present here only so the picker can show what's
  // currently selected.
  yearAnimalCode: z.string().nullish(),
  zodiacCode: z.string().nullish(),
  // Prisma Decimal serialises as a string.
  heightCm: z.union([z.string(), z.number()]).nullish(),
  weightKg: z.union([z.string(), z.number()]).nullish(),
  /**
   * ★ RFP §4.1 "тухайн мэдээллийг оруулсан огноо".
   *
   * `ChildProfile.recordedOn` has always existed and `PATCH /about-me` has
   * always accepted it — the schema simply never declared it, and Zod strips
   * what it is not told about. So a measurement's date could be written and
   * then never read back, which is worse than not storing it: a height with no
   * date is a number about a growing child that nobody can place in time.
   */
  recordedOn: z.string().nullish(),
});
export type AboutMe = z.infer<typeof aboutMeSchema>;

export const ageProfileSchema = z.object({
  age: z.number(),
  favoriteColor: z.string().nullish(),
  favoriteFood: z.string().nullish(),
  favoriteToy: z.string().nullish(),
  favoriteBook: z.string().nullish(),
  favoriteSong: z.string().nullish(),
  favoriteStory: z.string().nullish(),
  favoriteActivity: z.string().nullish(),
  favoriteClothes: z.string().nullish(),
  favoriteMovie: z.string().nullish(),
  favoriteTreat: z.string().nullish(),
  personality: z.string().nullish(),
  emotionalTraits: z.string().nullish(),
  familyMembers: z.string().nullish(),
  dream: z.string().nullish(),
  learningInterest: z.string().nullish(),
  newSkills: z.string().nullish(),
  kindergartenSkills: z.array(z.string()).default([]),
  kindergartenSkillNotes: z.record(z.string(), z.string()).default({}),
  kindergartenOtherSkill: z.string().nullish(),
  familyLearningSkills: z.array(z.string()).default([]),
  familyLearningNotes: z.record(z.string(), z.string()).default({}),
  familyLearningOther: z.string().nullish(),
  characterTraits: z.array(z.string()).default([]),
  characterObservation: z.string().nullish(),
  familyMemberTypes: z.array(z.string()).default([]),
  familyDescription: z.string().nullish(),
  parentNote: z.string().nullish(),
  teacherNote: z.string().nullish(),
});
export type AgeProfile = z.infer<typeof ageProfileSchema>;

export const birthdayNoteSchema = z.object({
  age: z.number(),
  note: z.string().nullish(),
  celebratedOn: z.string().nullish(),
});

export const zodiacSignSchema = z.object({ code: z.string(), name: z.string() });

export const yearAnimalSchema = z.object({
  code: z.string(),
  name: z.string(),
  /** See `mongolianYearAnimal` — the animal year turns at Цагаан сар, not on 1 January. */
  beforeLunarNewYear: z.boolean(),
});

/**
 * The whole of RFP §4.2 in one response: the birth date, the age, the western
 * zodiac sign, the Mongolian year animal and the per-year notes.
 *
 * ★ Not a second endpoint beside `birthday-notes`. That route returned the
 * notes alone, which was half a section — the screen had the birth date only
 * because the page above it happened to hold the child. Two fetches for one
 * card, and the PDF, which has no page above it, had neither.
 *
 * Photographs are deliberately absent: the album already filters by
 * `category=BIRTHDAY&age=N`, and duplicating rows into this response would give
 * the gallery and the birthday card two different orderings to disagree about.
 */
export const birthdaySectionSchema = z.object({
  dateOfBirth: z.string(),
  ageYears: z.number(),
  zodiac: zodiacSignSchema,
  yearAnimal: yearAnimalSchema,
  notes: z.array(birthdayNoteSchema),
});
export type BirthdaySection = z.infer<typeof birthdaySectionSchema>;

// ── Artwork comparison — RFP §5.3 ────────────────────────────────────────────

const comparisonMediaSchema = z.object({
  id: uuidSchema,
  caption: z.string().nullish(),
  takenAt: z.string().nullish(),
  uploadedAt: z.string().nullish(),
  originalName: z.string().nullish(),
});

export const artworkComparisonSchema = z.object({
  id: uuidSchema,
  conclusion: z.string(),
  /** Always the earlier work — the API sorts the pair by when it was made. */
  earlierMedia: comparisonMediaSchema,
  laterMedia: comparisonMediaSchema,
  author: personRefSchema.nullish(),
  createdAt: z.string().nullish(),
});
export type ArtworkComparison = z.infer<typeof artworkComparisonSchema>;

export const artworkTimelineSchema = z.object({
  /** Oldest first, by when the work was made — RFP §5.3's time order. */
  artwork: z.array(comparisonMediaSchema.extend({ observationId: uuidSchema.nullish() })),
  comparisons: z.array(artworkComparisonSchema),
});
export type ArtworkTimeline = z.infer<typeof artworkTimelineSchema>;

// ── Safety incidents — RFP Module 2.1 ────────────────────────────────────────

export const INCIDENT_KINDS = [
  "INJURY",
  "FALL",
  "BRUISE",
  "SCRATCH",
  "BITE",
  "ALLERGIC_REACTION",
  "FEVER",
  "ILLNESS",
  "OTHER",
] as const;

export const INCIDENT_KIND_LABEL: Record<string, string> = {
  INJURY: "Гэмтэл",
  FALL: "Уналт",
  BRUISE: "Хөхрөлт",
  SCRATCH: "Маажилт",
  BITE: "Хазуулсан",
  ALLERGIC_REACTION: "Харшлын шинж",
  FEVER: "Халууралт",
  ILLNESS: "Толгой/хэвлий өвдөх",
  OTHER: "Бусад",
};

export const incidentSchema = z.object({
  id: uuidSchema,
  kind: z.string(),
  occurredAt: z.string(),
  location: z.string().nullish(),
  bodyPart: z.string().nullish(),
  description: z.string(),
  firstAid: z.string().nullish(),
  followUp: z.string().nullish(),
  isHighPriority: z.boolean().default(false),
  /**
   * When the family was told, and by which notice. Null means recorded and not
   * yet reported — which is a workflow state, **not** a visibility one: a
   * family reads their own child's incidents either way.
   */
  reportedAt: z.string().nullish(),
  notificationId: uuidSchema.nullish(),
  recordedBy: personRefSchema.nullish(),
  child: personRefSchema.nullish(),
  media: z.array(observationMediaSchema).default([]),
});
export type Incident = z.infer<typeof incidentSchema>;

// ── Health — RFP Module 2 ────────────────────────────────────────────────────

export const allergySeveritySchema = z.enum(["MILD", "MODERATE", "SEVERE"]);
export const allergyKindSchema = z.enum(["FOOD", "MEDICATION", "ENVIRONMENTAL", "OTHER"]);

export const ALLERGY_SEVERITY_LABEL: Record<string, string> = {
  MILD: "Хөнгөн",
  MODERATE: "Дунд",
  SEVERE: "Ноцтой",
};

export const ALLERGY_KIND_LABEL: Record<string, string> = {
  FOOD: "Хоол хүнс",
  MEDICATION: "Эм",
  ENVIRONMENTAL: "Хүрээлэн буй орчин",
  OTHER: "Бусад",
};

export const allergySchema = z.object({
  id: uuidSchema,
  kind: allergyKindSchema,
  severity: allergySeveritySchema,
  allergen: z.string(),
  reaction: z.string().nullish(),
  treatment: z.string().nullish(),
  notedOn: z.string(),
  /** Ended rather than deleted — a child who outgrows one still had it. */
  endedOn: z.string().nullish(),
  recordedBy: personRefSchema.nullish(),
});
export type Allergy = z.infer<typeof allergySchema>;

export const medicationSchema = z.object({
  id: uuidSchema,
  medicineName: z.string(),
  dosage: z.string(),
  /** `HH:MM` strings — when a teacher should be reminded. */
  timesOfDay: z.array(z.string()).default([]),
  instructions: z.string().nullish(),
  startsOn: z.string(),
  /** Required: an open-ended authorisation to medicate a child is not a thing. */
  endsOn: z.string(),
  authorisedBy: personRefSchema.nullish(),
  /** Computed by the API against today, so every reader agrees on it. */
  isActive: z.boolean().default(false),
});
export type Medication = z.infer<typeof medicationSchema>;

export const vaccinationSchema = z.object({
  id: uuidSchema,
  vaccineName: z.string(),
  administeredOn: z.string(),
  doseLabel: z.string().nullish(),
  provider: z.string().nullish(),
  note: z.string().nullish(),
  recordedBy: personRefSchema.nullish(),
});
export type Vaccination = z.infer<typeof vaccinationSchema>;

/**
 * The special-needs classification — Order А/261, kindergarten criterion 11.
 *
 * ★ A reference row, not a free-text label — the opposite of `allergen` two
 * schemas up, and for the opposite reason. An allergen is matched against
 * whatever a cook typed on a dish, so a closed list would make a real allergy
 * unrecordable. A category is *counted by the state*, so free text would give
 * every kindergarten its own spelling of the same one and make the aggregate
 * meaningless.
 */
export const specialNeedsCategorySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  order: z.number().int().default(0),
  isActive: z.boolean().default(true),
  /** `null` marks a system row every kindergarten inherits and may not edit. */
  kindergartenId: uuidSchema.nullish(),
});
export type SpecialNeedsCategory = z.infer<typeof specialNeedsCategorySchema>;

export const specialNeedSchema = z.object({
  id: uuidSchema,
  category: specialNeedsCategorySchema,
  /** What support this child needs, in the staff's own words. */
  note: z.string().nullish(),
  /** The commission decision's number, once the paperwork has arrived. */
  documentNo: z.string().nullish(),
  assessedOn: z.string(),
  /** Ended rather than deleted, for `allergySchema.endedOn`'s reason. */
  endedOn: z.string().nullish(),
  recordedBy: personRefSchema.nullish(),
});
export type SpecialNeed = z.infer<typeof specialNeedSchema>;

/**
 * Everything a teacher needs before a meal or a nap, in one response.
 *
 * ★ One request, not three. The child's header renders a red badge from
 * `allergies` and a reminder from `medications`, and a screen that fetched them
 * separately would show the badge a beat before or after the record it belongs
 * to — on a slow connection, long enough to serve the wrong lunch.
 */
export const childHealthSchema = z.object({
  allergies: z.array(allergySchema),
  medications: z.array(medicationSchema),
  vaccinations: z.array(vaccinationSchema),
  /**
   * The special-needs classification — Order А/261, kindergarten criterion 11.
   *
   * ★ Defaulted, not required, unlike the three arrays above.
   *
   * This field arrived after the screen did, and `childHealthSchema.parse` runs
   * on every health response the browser receives. Without the default, a tab
   * still holding the bundle from before the deploy would fail to parse a
   * payload it otherwise understands — and the failure would take the allergy
   * badge down with it, which is the one thing on this screen that must never
   * go missing.
   */
  specialNeeds: z.array(specialNeedSchema).default([]),
  /** RFP §3.4's free-text note, carried here so one screen shows all of it. */
  healthNotes: z.string().nullish(),
});
export type ChildHealth = z.infer<typeof childHealthSchema>;

/**
 * One dish on the menu matched against one child's active allergy — the shape
 * `findAllergenWarnings` emits, in the order it emits it (severe first).
 *
 * ★ Declared in the health section, not beside the menu, because it needs
 * `allergySeveritySchema` above. A `const` is not hoisted, so referencing it
 * from the meals section would throw on module evaluation rather than fail at
 * build — the kind of break that only shows up when the bundle first runs.
 *
 * ★★ This names another family's child and what they react to, so it is staff
 * data. `GET /kindergartens/:id/menu/with-warnings` is `@Roles("TEACHER",
 * "ADMIN")` for that reason, and is a separate route from the plain menu rather
 * than a flag on it — a parent reads the menu and never this. Anything built on
 * this schema inherits that constraint and must not reach a parent surface.
 */
export const allergenWarningSchema = z.object({
  childId: uuidSchema,
  childName: z.string(),
  dishName: z.string(),
  /** What the menu was tagged with. */
  allergenTag: z.string(),
  /** What the child's record calls it — the two match loosely, never by equality. */
  allergen: z.string(),
  severity: allergySeveritySchema,
});
export type AllergenWarning = z.infer<typeof allergenWarningSchema>;

/**
 * A menu day as the staff route returns it — RFP Module 2's cross-check.
 *
 * Extends `menuDaySchema` rather than restating it: the API spreads the same
 * Prisma row into both responses and adds `warnings` to this one, so the day's
 * own fields must not be able to drift between the two schemas.
 */
export const menuDayWithWarningsSchema = menuDaySchema.extend({
  warnings: z.array(allergenWarningSchema).default([]),
});
export type MenuDayWithWarnings = z.infer<typeof menuDayWithWarningsSchema>;

// ── Kitchen production — ingredients, technology cards, suppliers, food
// orders and stock. "Хоол үйлдвэрлэл — хамгийн том дутуу хэсэг", the client's
// own gap list. Every quantity here is a decimal string, in the ingredient's
// own base unit — see `IngredientUnit` — never a JSON number, for the same
// reason money never is: a JSON double cannot round-trip `12.50` exactly. ──

export const ingredientUnitSchema = z.enum(["GRAM", "MILLILITER", "PIECE"]);
export type IngredientUnit = z.infer<typeof ingredientUnitSchema>;

/** The base unit's short form, for a quantity like "500 г" or "2 ш". */
export const INGREDIENT_UNIT_LABEL: Record<IngredientUnit, string> = {
  GRAM: "г",
  MILLILITER: "мл",
  PIECE: "ширхэг",
};

const unitRefSchema = namedRefSchema.extend({ unit: ingredientUnitSchema });

/**
 * Ingredient categories — грouping the kitchen's catalog for browsing. Not
 * named in the RFP; the client asked for the catalog to sort into buckets
 * like this on 2026-09-04.
 *
 * ★ A closed list and a plain `String` column — same reasoning as
 * `DOCUMENT_CATEGORIES`. The vocabulary is enforced at the form (a `Select`,
 * not free text), so nothing here drifts into five spellings of "мах", and if
 * a kindergarten ever needs its own categories these values are the seed rows
 * of that table.
 */
export const INGREDIENT_CATEGORIES = [
  "Мах, махан бүтээгдэхүүн",
  "Сүү, сүүн бүтээгдэхүүн",
  "Өндөг",
  "Гурилан бүтээгдэхүүн",
  "Тариа, будаа",
  "Хүнсний ногоо",
  "Жимс, жимсгэнэ",
  "Тос, өөх",
  "Амтлагч, зуурмаг",
  "Бусад",
] as const;
export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export const ingredientSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  unit: ingredientUnitSchema,
  /** One of `INGREDIENT_CATEGORIES`, or null for a row filed before the field
   * existed. Still a string column, not an enum — see the note above. */
  category: z.string().nullable(),
  /** Per 100 of the ingredient's own unit — 100 g, 100 ml or 100 pieces. */
  caloriesPer100: z.string().nullable(),
  proteinPer100: z.string().nullable(),
  fatPer100: z.string().nullable(),
  carbsPer100: z.string().nullable(),
  allergenTags: z.array(z.string()).default([]),
  note: z.string().nullable(),
  /** The cook's own reorder threshold, in this ingredient's own unit. Null
   * means no threshold is set — never treated as zero. */
  minStock: z.string().nullable(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const recipeStatusSchema = z.enum(["DRAFT", "APPROVED"]);
export type RecipeStatus = z.infer<typeof recipeStatusSchema>;

export const RECIPE_STATUS_LABEL: Record<RecipeStatus, string> = {
  DRAFT: "Ноорог",
  APPROVED: "Батлагдсан",
};

export const recipeIngredientRowSchema = z.object({
  id: uuidSchema,
  ingredient: unitRefSchema,
  /** In the ingredient's own unit — see `unitRefSchema`. */
  quantity: z.string(),
});
export type RecipeIngredientRow = z.infer<typeof recipeIngredientRowSchema>;

/**
 * Шим тэжээлийн тооцоо — always computed by the API from the recipe's
 * ingredient lines, never typed by hand. Any field is `null` the moment one
 * ingredient in the recipe is missing that figure, rather than silently
 * treating a gap as zero.
 */
export const nutritionSchema = z.object({
  calories: z.number().nullable(),
  protein: z.number().nullable(),
  fat: z.number().nullable(),
  carbs: z.number().nullable(),
});
export type Nutrition = z.infer<typeof nutritionSchema>;

/**
 * Технологийн карт. `nutritionTotal`/`nutritionPerPortion` and `allergenTags`
 * are derived from `ingredients` on every read, not stored columns — see the
 * schema comment on `Recipe` in `schema.prisma` for why.
 */
/**
 * Нэг хүүхдэд ногдох өртөг — Order А/261, kindergarten criterion 38.
 *
 * ★ Amounts are **strings**, like every other money field in these contracts.
 * `0.1 + 0.2 !== 0.3`, and a cost that disagrees with the order it was derived
 * from by a tögrög is the kind of discrepancy that destroys confidence in the
 * whole card. The API rounds with `decimal.js`; the client formats, never
 * arithmetics.
 *
 * ★★ `null` means **not priceable**, never free. It appears the moment one
 * ingredient has no purchase history, and `unpricedIngredients` names which —
 * so the screen can say what to buy rather than showing a confidently-too-low
 * figure nobody can tell is wrong.
 */
export const recipeCostSchema = z.object({
  /** For the whole batch, or `null` if any ingredient is unpriced. */
  total: z.string().nullable(),
  /** `total` divided by `yieldPortions` — what criterion 38 asks for. */
  perPortion: z.string().nullable(),
  /** The ingredients with no purchase history, by name. */
  unpricedIngredients: z.array(z.string()).default([]),
  /** `YYYY-MM-DD` — the date the prices were read as of. */
  pricedOn: z.string(),
});
export type RecipeCost = z.infer<typeof recipeCostSchema>;

export const recipeSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  mealKind: mealKindSchema.nullable(),
  yieldPortions: z.number(),
  instructions: z.string().nullable(),
  status: recipeStatusSchema,
  approvedAt: z.string().nullable(),
  ingredients: z.array(recipeIngredientRowSchema).default([]),
  /** For the whole batch — `yieldPortions` portions. */
  nutritionTotal: nutritionSchema,
  /** `nutritionTotal` divided by `yieldPortions`. */
  nutritionPerPortion: nutritionSchema,
  /**
   * ★ Optional, and only the single-card endpoint sends it.
   *
   * Costing needs a price lookup per card, so a list of forty would be forty
   * queries — the N+1 CLAUDE.md §3.4 forbids. Criterion 38 asks for the cost
   * *on the technology card*, so it is paid for once, there.
   */
  cost: recipeCostSchema.optional(),
  /** The union of every line ingredient's `allergenTags` — what feeds the
   * menu's allergy cross-check when a dish points at this recipe. */
  allergenTags: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type Recipe = z.infer<typeof recipeSchema>;

/** The list view — no ingredient lines, instructions or cost; one row per card. */
export const recipeSummarySchema = recipeSchema.omit({
  ingredients: true,
  instructions: true,
  cost: true,
});
export type RecipeSummary = z.infer<typeof recipeSummarySchema>;

// ── Suppliers ────────────────────────────────────────────────────────────────

export const supplierSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  registrationNumber: z.string().nullable(),
  contactPerson: z.string().nullable(),
  contactPhone: z.string().nullable(),
  address: z.string().nullable(),
  /** Гарал үүслийн тайлбар — free text, not a certification registry. */
  originNote: z.string().nullable(),
  isActive: z.boolean(),
});
export type Supplier = z.infer<typeof supplierSchema>;

// ── Food orders — Хүнсний захиалга ────────────────────────────────────────────

export const foodOrderStatusSchema = z.enum(["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"]);
export type FoodOrderStatus = z.infer<typeof foodOrderStatusSchema>;

export const FOOD_ORDER_STATUS_LABEL: Record<FoodOrderStatus, string> = {
  DRAFT: "Ноорог",
  ORDERED: "Захиалсан",
  RECEIVED: "Хүлээн авсан",
  CANCELLED: "Цуцалсан",
};

export const foodOrderLineSchema = z.object({
  id: uuidSchema,
  ingredient: unitRefSchema,
  quantity: z.string(),
  unitPrice: z.string(),
  totalPrice: z.string(),
  /** `null` until the order is received. */
  receivedQuantity: z.string().nullable(),
});
export type FoodOrderLine = z.infer<typeof foodOrderLineSchema>;

export const foodOrderSchema = z.object({
  id: uuidSchema,
  supplier: namedRefSchema,
  orderDate: z.string(),
  status: foodOrderStatusSchema,
  note: z.string().nullable(),
  lines: z.array(foodOrderLineSchema).default([]),
  /** Sum of every line's `totalPrice`. */
  totalAmount: z.string(),
  createdAt: z.string(),
});
export type FoodOrder = z.infer<typeof foodOrderSchema>;

/** The list view — no lines, one row per order. */
export const foodOrderSummarySchema = foodOrderSchema.omit({ lines: true });
export type FoodOrderSummary = z.infer<typeof foodOrderSummarySchema>;

// ── Stock — Нөөц, зарцуулалт ──────────────────────────────────────────────────

export const stockDirectionSchema = z.enum(["IN", "OUT", "ADJUSTMENT"]);
export type StockDirection = z.infer<typeof stockDirectionSchema>;

export const STOCK_DIRECTION_LABEL: Record<StockDirection, string> = {
  IN: "Орлого",
  OUT: "Зарлага",
  ADJUSTMENT: "Тохируулга",
};

export const stockSourceTypeSchema = z.enum(["PURCHASE", "CONSUMPTION", "ADJUSTMENT"]);
export type StockSourceType = z.infer<typeof stockSourceTypeSchema>;

export const stockMovementSchema = z.object({
  id: uuidSchema,
  ingredient: unitRefSchema,
  date: z.string(),
  direction: stockDirectionSchema,
  quantity: z.string(),
  sourceType: stockSourceTypeSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

/** Current on-hand quantity — `SUM(IN) + SUM(ADJUSTMENT) − SUM(OUT)`, computed
 * per read rather than kept as a running balance column. `low` is only ever
 * true when `minStock` is set — an ingredient nobody has set a threshold on
 * cannot be "low". */
export const stockLevelSchema = z.object({
  ingredient: unitRefSchema,
  onHand: z.string(),
  minStock: z.string().nullable(),
  low: z.boolean(),
});
export type StockLevel = z.infer<typeof stockLevelSchema>;

// ── Kitchen reports ──────────────────────────────────────────────────────────

export const consumptionReportRowSchema = z.object({
  ingredient: unitRefSchema,
  quantity: z.string(),
});
export type ConsumptionReportRow = z.infer<typeof consumptionReportRowSchema>;

/** One day's plan — the average nutrition of one portion that day, over every
 * recipe-linked dish. No attendance is read; §7's "explicit scope cut". */
export const nutritionReportRowSchema = z.object({
  date: z.string(),
  totalPortions: z.number(),
  perPortion: nutritionSchema,
});
export type NutritionReportRow = z.infer<typeof nutritionReportRowSchema>;

export const purchaseReportRowSchema = z.object({
  supplier: namedRefSchema,
  orderCount: z.number(),
  totalAmount: z.string(),
});
export type PurchaseReportRow = z.infer<typeof purchaseReportRowSchema>;

// ── Milestones — RFP §4.5 ────────────────────────────────────────────────────

/**
 * The seven firsts the RFP names, plus the escape hatch it also asks for.
 *
 * ★ A suggested vocabulary, not a closed set. RFP §4.5 lists these and then
 * says "хэрэглэгчийн өөрөө үүсгэсэн үйл явдал" — a family inventing their own.
 * `CUSTOM` is that: the API stores the family's `title` verbatim, and this list
 * exists so the form's chips and the API's labels cannot drift.
 */
export const MILESTONE_KINDS = [
  "FIRST_STEP",
  "FIRST_WORD",
  "FIRST_DAY_AT_KINDERGARTEN",
  "DRESSED_ALONE",
  "RODE_A_BICYCLE",
  "RECITED_A_POEM",
  "FIRST_TIME_ON_STAGE",
  "CUSTOM",
] as const;

export const milestoneKindSchema = z.enum(MILESTONE_KINDS);
export type MilestoneKind = z.infer<typeof milestoneKindSchema>;

export const MILESTONE_KIND_LABEL: Record<string, string> = {
  FIRST_STEP: "Анхны алхам",
  FIRST_WORD: "Анхны үг",
  FIRST_DAY_AT_KINDERGARTEN: "Анх цэцэрлэгт орсон өдөр",
  DRESSED_ALONE: "Анх өөрөө хувцасласан",
  RODE_A_BICYCLE: "Анх дугуй унасан",
  RECITED_A_POEM: "Анх шүлэг уншсан",
  FIRST_TIME_ON_STAGE: "Анх тайзан дээр гарсан",
  CUSTOM: "Өөрийн үйл явдал",
};

export const milestoneSchema = z.object({
  id: uuidSchema,
  kind: z.string(),
  /** The family's own words; overrides the suggested label when set. */
  title: z.string().nullish(),
  occurredOn: z.string(),
  description: z.string().nullish(),
  recordedBy: personRefSchema.nullish(),
  media: z.array(observationMediaSchema).default([]),
});
export type Milestone = z.infer<typeof milestoneSchema>;

// ── Growth — RFP §7 ──────────────────────────────────────────────────────────

export const growthPointSchema = z.object({
  id: uuidSchema,
  measuredOn: z.string(),
  /**
   * Completed calendar months at measurement time — the chart's precise age
   * axis. Optional while older API processes are still serving `ageYears` only.
   */
  ageMonths: z.number().int().nonnegative().optional(),
  ageYears: z.number(),
  heightCm: z.number().nullish(),
  weightKg: z.number().nullish(),
  headCircumferenceCm: z.number().nullish(),
  note: z.string().nullish(),
  recordedBy: personRefSchema.nullish(),
  /**
   * The change since the previous measurement in the series — RFP §7.2's
   * "өмнөх хэмжилттэй харьцуулах". Null on the first point, and null when the
   * earlier row did not carry this quantity: a delta against a measurement
   * nobody took would be a fabricated fact.
   */
  heightChangeCm: z.number().nullish(),
  weightChangeKg: z.number().nullish(),
});
export type GrowthPoint = z.infer<typeof growthPointSchema>;

export const referenceBandSchema = z.object({
  age: z.number(),
  median: z.number(),
  /** −2 SD and +2 SD — a band, deliberately not a percentile curve. */
  low: z.number(),
  high: z.number(),
});
export type ReferenceBand = z.infer<typeof referenceBandSchema>;

/**
 * ★ The source and the disclaimer are inside the reference object, not beside
 * it.
 *
 * RFP §7.2 requires that the source, its version and its date are shown, and
 * that the system states it gives no medical diagnosis. Nesting them here means
 * a screen cannot render the band without them — the requirement is structural
 * rather than a note somebody has to remember.
 */
export const growthReferenceSchema = z.object({
  height: z.array(referenceBandSchema),
  weight: z.array(referenceBandSchema),
  source: z.object({
    name: z.string(),
    version: z.string(),
    publishedOn: z.string(),
    url: z.string(),
    disclaimer: z.string(),
  }),
});

export const growthChartSchema = z.object({
  points: z.array(growthPointSchema),
  /** Null when the child's sex is unknown — a wrong band is worse than none. */
  reference: growthReferenceSchema.nullish(),
});
export type GrowthChart = z.infer<typeof growthChartSchema>;

// ── Notifications ────────────────────────────────────────────────────────────

/**
 * The client's nine categories, 2026-08-30, in the order they asked for.
 *
 * ★ The order is data, not a rendering detail. "Бүгд" then Зарлал, Мэдээлэл,
 * Зөвлөмж… is the sequence the client wrote down, and a filter row that sorts
 * them alphabetically or by usage is a different list than the one approved.
 * The array is the source of truth for both the chips and the composer.
 */
export const NOTIFICATION_CATEGORIES = [
  "ANNOUNCEMENT",
  "INFORMATION",
  "ADVICE",
  "ACTIVITY",
  "ROUTINE",
  "OUTING",
  "EVENT",
  "BIRTHDAY",
  "OTHER",
] as const;

export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

/** Mongolian labels — CLAUDE.md §5. Exactly the client's wording. */
export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  ANNOUNCEMENT: "Зарлал",
  INFORMATION: "Мэдээлэл",
  ADVICE: "Зөвлөмж",
  ACTIVITY: "Сургалт, үйл ажиллагаа",
  ROUTINE: "Өдрийн дэглэм",
  OUTING: "Зугаалга",
  EVENT: "Өдөрлөг",
  BIRTHDAY: "Төрсөн өдөр",
  OTHER: "Бусад",
};

export const notificationSchema = z.object({
  id: uuidSchema,
  /** Null when the author wrote a body and no heading — optional since 2026-08-30. */
  title: z.string().nullable(),
  /**
   * ★ `.catch("OTHER")` rather than `.default`.
   *
   * A default covers a missing key; this also covers a *present* one the web
   * app does not know — a tenth category added to the enum server-side would
   * otherwise throw at parse time and blank the whole board rather than
   * showing one notice under an unfamiliar label.
   */
  category: notificationCategorySchema.catch("OTHER"),
  body: z.string().nullish(),
  status: z.enum(["DRAFT", "PUBLISHED"]).nullish(),
  isImportant: z.boolean().nullish(),
  publishedAt: z.string().nullish(),
  createdAt: z.string().nullish(),
  author: personRefSchema.nullish(),
  /** Only this user's receipt — "have I read it", not who else has. */
  reads: z.array(z.object({ readAt: z.string().nullish() })).default([]),
  /**
   * Reactions, collapsed.
   *
   * A count and a boolean, never a list of who. A parent must not be able to
   * work out which other families are reading the board — the same reasoning as
   * `reads`. There is no comment field, and that is deliberate: see the `like`
   * endpoint in `notifications.controller.ts`.
   */
  likeCount: z.number().default(0),
  likedByMe: z.boolean().default(false),
  /**
   * Photos on the notice, in the order they were attached.
   *
   * Ids only — the bytes come from `GET /media/:id`, which checks permission
   * and redirects to a short-lived presigned URL. A storage key never leaves
   * the API.
   */
  media: z
    .array(
      z.object({
        id: uuidSchema,
        caption: z.string().nullish(),
        width: z.number().nullish(),
        height: z.number().nullish(),
      }),
    )
    .default([]),
  targets: z
    .array(
      z.object({
        groupId: uuidSchema.nullish(),
        childId: uuidSchema.nullish(),
        group: namedRefSchema.nullish(),
        child: personRefSchema.nullish(),
      }),
    )
    .default([]),
});
export type Notification = z.infer<typeof notificationSchema>;

export const unreadCountSchema = z.object({ count: z.number() });

// ── Media ────────────────────────────────────────────────────────────────────

export const mediaAttributionSchema = z.enum(["TEACHER", "PARENT", "JOINT"]);

export const MEDIA_ATTRIBUTION_LABEL: Record<string, string> = {
  TEACHER: "Багшийн",
  PARENT: "Эцэг эхийн",
  JOINT: "Хамтын",
};

/**
 * Album categories — RFP §4.4 "ангилал".
 *
 * ★ A closed list here and a plain `String` column in the database. The RFP
 * names the facet but not its values, so these are a proposal, not a
 * requirement: changing the list is a one-line edit with no migration, and if
 * the client asks for administrator-editable categories these values become the
 * seed rows of a new table. See the note on `MediaFile.category`.
 */
/**
 * The twelve parent-facing albums inside one age's photo library.
 *
 * Kept separate from `MEDIA_CATEGORIES`: the latter also contains workflow
 * categories (artwork, observation activity, first day and graduation) used
 * by older screens. The age-album grid must stay exactly twelve cards even as
 * those internal categories evolve.
 */
export const AGE_ALBUM_CATEGORIES = [
  "PORTRAIT",
  "FAMILY",
  "TRAVEL",
  "KINDERGARTEN",
  "FRIENDS",
  "ACHIEVEMENT",
  "NEW_YEAR",
  "TSAGAAN_SAR",
  "GOLDEN_AUTUMN",
  "CELEBRATION",
  "BIRTHDAY",
  "OTHER",
] as const;

export const AGE_ALBUM_CATEGORY_LABEL: Record<(typeof AGE_ALBUM_CATEGORIES)[number], string> = {
  PORTRAIT: "Цээж зураг",
  FAMILY: "Миний гэр бүл",
  TRAVEL: "Аялал, зугаалга",
  KINDERGARTEN: "Би цэцэрлэгтээ",
  FRIENDS: "Миний найзууд",
  ACHIEVEMENT: "Миний амжилтууд",
  NEW_YEAR: "Шинэ жил",
  TSAGAAN_SAR: "Цагаан сар",
  GOLDEN_AUTUMN: "Алтан намар",
  CELEBRATION: "Тэмдэглэлт баяр",
  BIRTHDAY: "Миний төрсөн өдөр",
  OTHER: "Бусад",
};

export const ageAlbumCategorySchema = z.enum(AGE_ALBUM_CATEGORIES);

export const MEDIA_CATEGORIES = [
  "ARTWORK",
  "ACTIVITY",
  "EVENT",
  "DAILY",
  "PORTRAIT",
  "FAMILY",
  "TRAVEL",
  "KINDERGARTEN",
  "FRIENDS",
  "ACHIEVEMENT",
  "NEW_YEAR",
  "TSAGAAN_SAR",
  "GOLDEN_AUTUMN",
  "CELEBRATION",
  "OTHER",
  /**
   * ★ RFP §4.2 asks for a "төрсөн өдрийн зураг" in the birthday section, and
   * `EVENT` cannot answer it: a query for this year's birthday photograph would
   * return every concert and Цагаан сар as well. With `age` already on the row,
   * `category=BIRTHDAY&age=4` is the whole birthday section's photograph.
   */
  "BIRTHDAY",
  /**
   * ★★ Added 2026-09-05, on the client's instruction, for the two fixed
   * galleries the overview page grew beside the age-filtered one: a child has
   * exactly one first day and, eventually, one graduation — `EVENT` would mix
   * these in with every concert and Цагаан сар the same way `BIRTHDAY` would
   * have, which is the same argument that added `BIRTHDAY` in the first place.
   */
  "FIRST_DAY",
  "GRADUATION",
] as const;

export const mediaCategorySchema = z.enum(MEDIA_CATEGORIES);

export const MEDIA_CATEGORY_LABEL: Record<string, string> = {
  ARTWORK: "Бүтээл",
  ACTIVITY: "Үйл ажиллагаа",
  EVENT: "Баяр ёслол",
  DAILY: "Өдөр тутам",
  ...AGE_ALBUM_CATEGORY_LABEL,
  FIRST_DAY: "Цэцэрлэгийн анхны өдөр",
  GRADUATION: "Төгсөлт",
};

export const mediaSchema = z.object({
  id: uuidSchema,
  caption: z.string().nullish(),
  originalName: z.string().nullish(),
  mimeType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  purpose: z.string().nullish(),
  observationId: uuidSchema.nullish(),
  // Album metadata — RFP §4.4. Nullish throughout: photographs stored before
  // these fields existed carry none of them.
  takenAt: z.string().nullish(),
  age: z.number().nullish(),
  category: z.string().nullish(),
  albumCoverAge: z.number().nullish(),
  attribution: mediaAttributionSchema.nullish(),
  uploadedBy: personRefSchema.nullish(),
});
export type Media = z.infer<typeof mediaSchema>;

/** The gallery response. Every list is paginated — CLAUDE.md §3.4. */
export const mediaListSchema = paginated(mediaSchema);

export const ageAlbumSummarySchema = z.object({
  age: z.number().int().min(2).max(5),
  coverMediaFileId: uuidSchema.nullable(),
  categories: z.array(
    z.object({
      category: ageAlbumCategorySchema,
      count: z.number().int().nonnegative(),
      thumbnailMediaId: uuidSchema.nullable(),
    }),
  ),
});
export type AgeAlbumSummary = z.infer<typeof ageAlbumSummarySchema>;

// ── Reports ──────────────────────────────────────────────────────────────────

export const reportJobSchema = z.object({
  id: uuidSchema,
  type: reportTypeSchema,
  status: reportStatusSchema,
  progressPercent: z.number().nullish(),
  pageCount: z.number().nullish(),
  fileSize: z.number().nullish(),
  errorMessage: z.string().nullish(),
  requestedAt: z.string().nullish(),
  completedAt: z.string().nullish(),
  expiresAt: z.string().nullish(),
  downloadable: z.boolean().nullish(),
});
export type ReportJob = z.infer<typeof reportJobSchema>;

export const downloadUrlSchema = z.object({
  url: z.string(),
  expiresIn: z.number().nullish(),
});

// ── Assessment configuration — RFP §6.1, §6.2 ────────────────────────────────

/**
 * ★ `isSystem` is the whole reason this schema exists separately.
 *
 * A row with `kindergartenId = null` is a shared default every kindergarten
 * inherits. An administrator may create and edit their *own* rows and may not
 * touch a system one — they create an override instead. The API computes the
 * flag; the UI uses it to decide whether to render an edit control at all,
 * rather than offering one that 404s.
 */
export const developmentDomainSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  color: z.string().nullish(),
  description: z.string().nullish(),
  order: z.number().nullish(),
  isActive: z.boolean().nullish(),
  isSystem: z.boolean().default(false),
});
export type DevelopmentDomainConfig = z.infer<typeof developmentDomainSchema>;

export const assessmentLevelSchema = z.object({
  id: uuidSchema,
  value: z.number(),
  label: z.string(),
  color: z.string().nullish(),
  description: z.string().nullish(),
  order: z.number().nullish(),
  isActive: z.boolean().nullish(),
  isSystem: z.boolean().default(false),
});
export type AssessmentLevelConfig = z.infer<typeof assessmentLevelSchema>;

export const observationTypeConfigSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  order: z.number().nullish(),
  isActive: z.boolean().nullish(),
  isSystem: z.boolean().default(false),
});
export type ObservationTypeConfig = z.infer<typeof observationTypeConfigSchema>;

// ── Document library — RFP §9 ────────────────────────────────────────────────

/**
 * What a document in the library *is* — RFP §9's own three, plus the fourth.
 *
 * ★ A vocabulary, where this was free text.
 *
 * §9 names the library's contents in one line — "Багшид зориулсан PDF баримт
 * бичгийн сан: хөтөлбөр, арга зүй, дотоод журам" — and the screen's own lede
 * repeats it. The field behind it accepted any eighty characters, so the same
 * shelf could be spelled "Журам", "журам", "Дотоод журам" and "Дүрэм журам",
 * and a teacher filtering by one of them would miss the other three. On a
 * library nobody can search by content, the category *is* the way in.
 *
 * ★★ Still a string column, not an enum.
 *
 * Unlike `NotificationCategory`, this is a shelf label rather than a
 * classification the system reasons about: nothing branches on it, existing
 * rows carry arbitrary values, and a migration to an enum would have to guess
 * what "Тушаал" was meant to be. The vocabulary is enforced where documents are
 * created — the form offers four choices — and an older row keeps whatever it
 * says, which the filter still lists.
 */
export const DOCUMENT_CATEGORIES = ["Хөтөлбөр", "Арга зүй", "Журам", "Бусад"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const documentSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  category: z.string().nullish(),
  description: z.string().nullish(),
  version: z.string().nullish(),
  fileMediaFileId: uuidSchema,
  coverMediaFileId: uuidSchema.nullish(),
  publishedAt: z.string().nullish(),
  publishedBy: personRefSchema.nullish(),
  /**
   * Which group's teachers this is for — null is all staff.
   *
   * ★ Added 2026-09-06. A teacher's list is already filtered by it on the
   * server, so this is for *display*: an administrator needs to see who a
   * document went to, and a teacher benefits from knowing a circular is theirs
   * rather than the kindergarten's.
   */
  groupId: uuidSchema.nullish(),
  group: namedRefSchema.nullish(),
  /** This reader's own bookmark, flattened from the join — RFP §9. */
  isBookmarked: z.boolean().default(false),
});
export type LibraryDocument = z.infer<typeof documentSchema>;

// ── Consent — RFP §16 ────────────────────────────────────────────────────────

export const consentKindSchema = z.enum(["DATA_PROCESSING", "PHOTO_PUBLISHING"]);

export const CONSENT_KIND_LABEL: Record<string, string> = {
  DATA_PROCESSING: "Мэдээлэл ашиглах зөвшөөрөл",
  PHOTO_PUBLISHING: "Зураг нийтлэх зөвшөөрөл",
};

export const consentDecisionSchema = z.object({
  granted: z.boolean(),
  decidedAt: z.string().nullish(),
  /**
   * Whether the family has been asked at all.
   *
   * ★ Distinct from `granted: false`. "Refused" and "never asked" are different
   * facts, and only the second one has an action attached — the kindergarten
   * still needs to ask.
   */
  asked: z.boolean(),
});

export const consentRecordSchema = z.object({
  id: uuidSchema,
  kind: consentKindSchema,
  granted: z.boolean(),
  decidedAt: z.string(),
  note: z.string().nullish(),
  decidedBy: personRefSchema.nullish(),
});

export const childConsentSchema = z.object({
  current: z.object({
    dataProcessing: consentDecisionSchema,
    photoPublishing: consentDecisionSchema,
  }),
  history: z.array(consentRecordSchema),
});
export type ChildConsent = z.infer<typeof childConsentSchema>;

// ── Tenancy ──────────────────────────────────────────────────────────────────

export const kindergartenSchema = z.object({
  id: uuidSchema,
  name: z.string(),
});

export const schoolYearSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isCurrent: z.boolean().nullish(),
  startsOn: z.string().nullish(),
  endsOn: z.string().nullish(),
});

export const groupSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  ageBand: z.string().nullish(),
  kindergartenId: uuidSchema.nullish(),
  schoolYearId: uuidSchema.nullish(),
  /**
   * ★ `nullish`, like `ageBand` above, because this schema doubles as the bare
   * group reference embedded in other payloads — the enrollment archive returns
   * `{ id, name }` and nothing more. Requiring the two new fields here would
   * make every one of those parses fail. `GET /groups` always sends them.
   */
  programKind: programKindSchema.nullish(),
  attendanceForm: attendanceFormSchema.nullish(),
});

/**
 * A user as the admin list returns them.
 *
 * `memberships` carries only the ones the requesting admin may see — the API
 * filters them by the same kindergarten scope it used to select the user, so an
 * admin of one kindergarten never learns that a parent also has a child at
 * another. The shape mirrors that; it is not a full user record.
 */
export const adminUserSchema = z.object({
  id: uuidSchema,
  username: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  lastName: z.string(),
  firstName: z.string(),
  isActive: z.boolean().nullish(),
  lastLoginAt: z.string().nullish(),
  memberships: z
    .array(
      z.object({
        id: uuidSchema,
        kindergartenId: uuidSchema,
        role: roleSchema,
        isActive: z.boolean().nullish(),
      }),
    )
    .default([]),
});

/**
 * Ажилтны туршлага, гэрчилгээ, зэрэг — Order А/261, шалгуур 51.
 *
 * ★ One shape for all three kinds, mirroring the one table.
 *
 * A discriminated union per kind would refuse an `issuer` on an EXPERIENCE
 * row, and "Багшийн хөгжлийн төв" is exactly what somebody writes there when
 * the post was a secondment. Unused fields are left blank, as on the paper
 * form.
 */
export const staffRecordKindSchema = z.enum(["EXPERIENCE", "CERTIFICATE", "QUALIFICATION"]);

export const STAFF_RECORD_KIND_LABEL: Record<string, string> = {
  EXPERIENCE: "Ажлын туршлага",
  CERTIFICATE: "Гэрчилгээ",
  QUALIFICATION: "Боловсрол, зэрэг",
};

export const staffRecordSchema = z.object({
  id: uuidSchema,
  kind: staffRecordKindSchema,
  title: z.string(),
  issuer: z.string().nullish(),
  documentNo: z.string().nullish(),
  note: z.string().nullish(),
  startedOn: z.string(),
  /** `null` means "still current" — an open-ended post, or a certificate that
   * does not expire. */
  endedOn: z.string().nullish(),
  createdBy: personRefSchema.nullish(),
});
export type StaffRecord = z.infer<typeof staffRecordSchema>;

/** `POST /kindergartens/:id/users` — the account plus the token to hand over. */
export const invitedUserSchema = z.object({
  user: adminUserSchema.partial({ memberships: true }),
  invitationToken: z.string(),
});

/**
 * A group as the *list* returns it.
 *
 * ★ No teachers here — `GET /groups` does not include them, only a count of
 * enrolments. Fetching the assignments for every row would be an N+1 the client
 * pays on a screen that mostly does not need them, so the list shows how many
 * children are in a group and the teacher list is fetched per group, on demand.
 */
export const groupListItemSchema = groupSchema.extend({
  status: z.string().nullish(),
  schoolYear: schoolYearSchema.nullish(),
  _count: z.object({ enrollments: z.number() }).nullish(),
  /** RFP §3.2 — ангийн зураг, so the assignment dialog can preview it. */
  photoMediaFileId: uuidSchema.nullish(),
});

/** A single group, from `GET /groups/:id` — this one carries the assignments. */
export const groupWithTeachersSchema = groupListItemSchema.extend({
  teachers: z
    .array(
      z.object({
        id: uuidSchema,
        role: z.string().nullish(),
        endedOn: z.string().nullish(),
        membership: z
          .object({
            id: uuidSchema,
            user: personRefSchema.nullish(),
          })
          .nullish(),
      }),
    )
    .default([]),
});

export const userProfileSchema = z.object({
  id: uuidSchema,
  username: z.string().nullish(),
  lastName: z.string(),
  firstName: z.string(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  bio: z.string().nullish(),
  photoMediaFileId: uuidSchema.nullish(),
});

// ── Dashboards ───────────────────────────────────────────────────────────────

/** One line in a "what happened recently" feed. */
export const feedObservationSchema = z.object({
  id: uuidSchema,
  observedOn: z.string(),
  situation: z.string().nullish(),
  source: observationSourceSchema.nullish(),
  reviewStatus: reviewStatusSchema.nullish(),
  visibleToParents: z.boolean().nullish(),
  child: personRefSchema.nullish(),
  type: namedRefSchema.nullish(),
});

export const teacherDashboardSchema = z.object({
  currentTerm: termSchema.nullable(),
  counts: z.object({
    children: z.number(),
    groups: z.number(),
    pendingReviews: z.number(),
  }),
  needsAttention: z.object({
    pendingReviews: z.number(),
    childrenMissingAssessment: z.array(
      z.object({
        id: uuidSchema,
        lastName: z.string(),
        firstName: z.string(),
        photoMediaFileId: uuidSchema.nullish(),
        group: namedRefSchema.nullish(),
      }),
    ),
  }),
  /**
   * This term's observations per configured type — counts, never a rate.
   *
   * There is no target in the schema to divide by, so a "биелэлт" percentage
   * would need an invented denominator. The share of the total is a fact; a
   * completion score against a number nobody set is not.
   */
  observationsByType: z.array(z.object({ type: namedRefSchema, count: z.number() })).default([]),
  /** Every birthday in the current month, day-ordered — what a teacher plans against. */
  birthdaysThisMonth: z
    .array(
      z.object({
        id: uuidSchema,
        lastName: z.string(),
        firstName: z.string(),
        dateOfBirth: z.string().nullish(),
        photoMediaFileId: uuidSchema.nullish(),
      }),
    )
    .default([]),
  /**
   * The class board's latest published notice.
   *
   * `readCount` is how many people opened it — a count, never the list. The
   * notifications repository draws the same line for reactions and says why.
   */
  boardNotice: z
    .object({
      id: uuidSchema,
      /**
       * ★ Nullable, and it was not — which took the whole teacher dashboard
       * down on 2026-09-06.
       *
       * `Notification.title` became optional on 2026-08-30 ("forcing one
       * produced titles that restated the first line of the body") and
       * `notificationSchema` was updated to match. This copy of the same field
       * was not, so the first notice published without a heading made
       * `GET /dashboard/teacher` unparseable — not a missing card, the entire
       * screen, because a client that validates its responses fails the whole
       * object. The error surfaced as the generic "Алдаа гарлаа. Дахин
       * оролдоно уу.", which is what `errorMessage` says for a `ZodError`.
       *
       * The lesson worth keeping: a field duplicated into a second schema is a
       * field that will be changed in one of them.
       */
      title: z.string().nullable(),
      body: z.string(),
      publishedAt: z.string().nullable(),
      isImportant: z.boolean(),
      readCount: z.number(),
    })
    .nullable()
    .default(null),
  /** RFP §12.1 — children whose birthday is today. */
  birthdaysToday: z
    .array(
      z.object({
        id: uuidSchema,
        lastName: z.string(),
        firstName: z.string(),
        dateOfBirth: z.string().nullish(),
        photoMediaFileId: uuidSchema.nullish(),
      }),
    )
    .default([]),
  /** RFP §12.1 — how many of the roster have been assessed this term. */
  termProgress: z
    .object({ assessed: z.number(), total: z.number() })
    .default({ assessed: 0, total: 0 }),
  /**
   * How many of the roster have been assessed in each development domain.
   *
   * ★ A count of children, not of assessment rows.
   *
   * A child may hold several rows in one domain across a term, so counting
   * rows would let one thoroughly-assessed child make a domain look covered
   * while eighteen others have nothing — the gap this is drawn to expose. The
   * denominator is `termProgress.total`, the same roster.
   *
   * Every configured domain appears, including those at zero: a domain that
   * vanishes from a chart because nobody has been assessed in it hides exactly
   * what a teacher is looking for. `observationsByType` argues the same.
   */
  assessmentByDomain: z
    .array(z.object({ domain: namedRefSchema, assessed: z.number() }))
    .default([]),
  /** Observations written per month, `YYYY-MM`, oldest first — six months. */
  observationsByMonth: z.array(z.object({ month: z.string(), count: z.number() })).default([]),
  recentObservations: z.array(feedObservationSchema).default([]),
});
export type TeacherDashboard = z.infer<typeof teacherDashboardSchema>;

export const parentDashboardSchema = z.object({
  children: z.array(
    z.object({
      id: uuidSchema,
      lastName: z.string(),
      firstName: z.string(),
      dateOfBirth: z.string().nullish(),
      photoMediaFileId: uuidSchema.nullish(),
      sex: sexSchema.nullish(),
      group: namedRefSchema.nullish(),
      assessments: z
        .array(z.object({ domain: domainSchema.nullish(), level: levelSchema.nullish() }))
        .default([]),
    }),
  ),
  currentTerm: z.object({ id: uuidSchema, number: z.number(), name: z.string() }).nullable(),
  recent: z.array(feedObservationSchema).default([]),
});
export type ParentDashboard = z.infer<typeof parentDashboardSchema>;

export const adminDashboardSchema = z.object({
  currentTerm: z.object({ id: uuidSchema, number: z.number(), name: z.string() }).nullable(),
  counts: z.object({
    children: z.number(),
    groups: z.number(),
    staff: z.number(),
    guardians: z.number(),
  }),
  /**
   * RFP §12.2 — "Хадгалалтын хэмжээ" and "Тайлангийн статистик".
   *
   * `totalBytes` is the size of the files this system has rows for, not of the
   * bucket: an object orphaned by a crash between the upload and the row is
   * invisible to it. The label says "stored files" for that reason.
   */
  storage: z
    .object({
      totalBytes: z.number(),
      fileCount: z.number(),
      reports: z.object({ total: z.number(), done: z.number(), failed: z.number() }),
    })
    .nullish(),
  /**
   * Assessment progress per group.
   *
   * A ratio, and the bar beside it is a reading aid rather than the content.
   * "12 of 18 assessed" is what tells an administrator which group to chase.
   *
   * ★ This note used to end "and the brief rules charts out", which read §13's
   * "хэт олон өнгө, хөдөлгөөн ашиглахгүй" — no excess of colour or motion — as
   * a ban. It is not one: §12.3 asks for six charts by name, including the
   * domain averages this same endpoint now returns. The narrow claim survives
   * (a ratio does not need a chart to be understood); the general one does not.
   */
  assessmentCoverage: z.array(
    z.object({
      groupId: uuidSchema,
      name: z.string(),
      children: z.number(),
      assessed: z.number(),
    }),
  ),
  recentActivity: z.array(
    z.object({
      id: uuidSchema,
      action: z.string(),
      actorLabel: z.string().nullish(),
      objectType: z.string().nullish(),
      createdAt: z.string(),
    }),
  ),
  /**
   * Today's register across the whole kindergarten — RFP §12.2.
   *
   * ★ Three numbers, because two of them answer different questions.
   *
   * `recorded` against `expected` says whether the register has been *taken*;
   * `present` against `expected` says how full the kindergarten *is*. A single
   * percentage would conflate "nobody has filled this in yet" with "nobody came
   * in", which are the two states an administrator most needs to tell apart at
   * nine in the morning.
   */
  /**
   * Children enrolled 30 days ago — the drawing's "↑ 0 Өмнөх сараас".
   *
   * ★ Only this count carries a comparison, and the omission is deliberate.
   *
   * `Enrollment` records when each one started and ended, so "how many children
   * were here a month ago" is a fact the table holds. `Group` and `Membership`
   * have no equivalent end date, so the same question about groups or staff
   * would count one archived last week and report a number nobody could
   * reproduce. A statistic that cannot be checked is worse on a dashboard than
   * an absent one.
   */
  childrenAMonthAgo: z.number(),
  attendanceToday: z.object({
    /** Active enrolments — the roster, not the number of rows written. */
    expected: z.number(),
    recorded: z.number(),
    /** `PRESENT` + `HALF_DAY`. A half day is a child who came. */
    present: z.number(),
  }),
  /**
   * Attendance per group over the last 30 days.
   *
   * ★ Raw per-status counts, never a rate.
   *
   * Which statuses count as "attending" is a policy question — the funding
   * rules answer it one way, a head count another — and burying that decision
   * in a dashboard query is how two screens end up disagreeing about the same
   * month. `counts` is keyed by `AttendanceStatus`; a status with no rows is
   * absent from the map rather than zero.
   */
  attendanceByGroup: z.array(
    z.object({
      groupId: uuidSchema,
      name: z.string(),
      counts: z.record(z.string(), z.number()),
    }),
  ),
  /**
   * Each group's mean level per development domain — RFP §12.3's "Хөгжлийн
   * чиглэлийн дундаж", at the group granularity §12.2 needs.
   *
   * ★ A domain nobody assessed is absent from `averageByDomain`, not zero.
   * Zero is a real score on the 1–4 scale's floor; "not assessed" is not a
   * score, and a radar that plots the two alike draws a group as failing at
   * something it has not been asked about yet.
   *
   * Empty without a current term: an assessment belongs to one.
   */
  domainAveragesByGroup: z.array(
    z.object({
      groupId: uuidSchema,
      name: z.string(),
      /** How many assessment rows the averages are computed from. */
      sampleSize: z.number(),
      averageByDomain: z.record(z.string(), z.number()),
    }),
  ),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;

/**
 * The cook's dashboard — "what needs my attention today", the same rule the
 * teacher and admin screens follow (`dashboard.service.ts`).
 *
 * ★ `attendanceToday`/`attendanceByGroup` share the admin dashboard's shapes
 * exactly, deliberately: both are aggregate counts with no child's name in
 * them, so exposing them to `COOK` needed no new authorization rule, only a
 * route that calls the same repository methods for a single day. A cook reads
 * them as headcount for tomorrow's portions, not as a register.
 */
export const cookDashboardSchema = z.object({
  attendanceToday: z.object({
    expected: z.number(),
    recorded: z.number(),
    present: z.number(),
  }),
  attendanceByGroup: z.array(
    z.object({
      groupId: uuidSchema,
      name: z.string(),
      counts: z.record(z.string(), z.number()),
    }),
  ),
  /** Orders still `DRAFT` or `ORDERED` — placed but nothing has arrived yet. */
  pendingFoodOrders: z.number(),
  /** Ingredients at or below their own `minStock` — opt-in per ingredient,
   * so this is never inflated by ingredients nobody has set a threshold on. */
  lowStockCount: z.number(),
});
export type CookDashboard = z.infer<typeof cookDashboardSchema>;

/**
 * One audit row, as the browser screen reads it — RFP §2.1.
 *
 * `metadata` is `unknown`: it is a free-form JSON column whose shape differs by
 * action, and typing it would be a promise this schema cannot keep. The screen
 * renders it as formatted JSON for the cases where an administrator needs to
 * see what actually changed.
 */
export const auditEntrySchema = z.object({
  id: uuidSchema,
  action: z.string(),
  objectType: z.string().nullish(),
  objectId: uuidSchema.nullish(),
  childId: uuidSchema.nullish(),
  actorUserId: uuidSchema.nullish(),
  /**
   * Who performed the action, as a name.
   *
   * ★ Resolved by the server on read, not read straight off the column.
   *
   * `AuditLog.actorLabel` is filled by two of the hundred and ten places that
   * append to the log, so the raw column is null for almost every action. The
   * API resolves the name from `actorUserId` and falls back to the stored text
   * for an actor whose user row is gone — `apps/api/src/dashboard/audit-actor.ts`
   * carries the reasoning.
   *
   * Null is a real answer: an unauthenticated action has no actor.
   */
  actorLabel: z.string().nullish(),
  createdAt: z.string(),
  metadata: z.unknown().nullish(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** Audit actions, in Mongolian. A raw enum is meaningless to an administrator. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  LOGIN: "Нэвтэрсэн",
  LOGIN_FAILED: "Нэвтрэх амжилтгүй",
  LOGOUT: "Гарсан",
  VIEW: "Үзсэн",
  CREATE: "Үүсгэсэн",
  UPDATE: "Засварласан",
  DELETE: "Устгасан",
  RESTORE: "Сэргээсэн",
  DOWNLOAD: "Татсан",
  PERMISSION_CHANGE: "Эрх өөрчилсөн",
  PASSWORD_RESET: "Нууц үг сэргээсэн",
  INVITE: "Урьсан",
  ACTIVATE: "Идэвхжүүлсэн",
};

/**
 * Audited record types, in Mongolian.
 *
 * ★ The other half of the sentence `AUDIT_ACTION_LABEL` translates.
 *
 * An audit line reads "<action> · <objectType>", and only the action was ever
 * translated — so a director's activity feed and their audit screen both said
 * "Үзсэн · Child", "Засварласан · Membership", "Устгасан · Guardianship". The
 * comment above that map is the whole argument, applied to one column and not
 * the other: a raw enum is meaningless to an administrator, and an English one
 * on a Mongolian screen is worse than meaningless — it reads as a fault.
 *
 * ★★ Keyed by the string the API writes to `AuditLog.objectType`, which is the
 * Prisma model name. Every value written anywhere in `apps/api/src` is listed;
 * a model added later that is not falls back to its own name at the call site
 * rather than rendering blank.
 */
export const AUDIT_OBJECT_LABEL: Record<string, string> = {
  AllergyRecord: "Харшил",
  ArtworkComparison: "Уран бүтээлийн харьцуулалт",
  Assessment: "Үнэлгээ",
  AssessmentLevel: "Үнэлгээний түвшин",
  Attendance: "Ирц",
  AttendanceRequest: "Чөлөөний хүсэлт",
  AuditLog: "Үйлдлийн бүртгэл",
  BirthdayNote: "Төрсөн өдрийн мэндчилгээ",
  Child: "Хүүхэд",
  ChildAgeProfile: "Хүүхдийн насны мэдээлэл",
  ChildExport: "Хүүхдийн жагсаалтын экспорт",
  ChildImport: "Хүүхдийн импорт",
  ChildProfile: "Хүүхдийн дэлгэрэнгүй",
  ConsentRecord: "Зураг ашиглах зөвшөөрөл",
  DevelopmentDomain: "Хөгжлийн чиглэл",
  Document: "Баримт бичиг",
  Enrollment: "Элсэлт",
  FundingCalculation: "Санхүүжилтийн тооцоо",
  FundingRule: "Санхүүжилтийн дүрэм",
  Group: "Бүлэг",
  GroupTeacher: "Бүлгийн багш",
  GrowthMeasurement: "Өсөлтийн хэмжилт",
  Guardianship: "Асран хамгаалагч",
  Invoice: "Нэхэмжлэл",
  InvoiceLineItem: "Нэхэмжлэлийн мөр",
  InvoiceReminder: "Төлбөрийн сануулга",
  Kindergarten: "Цэцэрлэг",
  MealRecord: "Хоолны бүртгэл",
  MediaFile: "Файл",
  MedicationAuthorisation: "Эм хэрэглэх зөвшөөрөл",
  Membership: "Эрх",
  Milestone: "Онцлох ахиц",
  Notification: "Мэдээ",
  Observation: "Ажиглалт",
  ObservationType: "Ажиглалтын төрөл",
  Payment: "Төлбөр",
  ReportJob: "Тайлан",
  SafetyIncident: "Ослын бүртгэл",
  SchoolYear: "Хичээлийн жил",
  Survey: "Судалгаа",
  SurveyResponse: "Судалгааны хариулт",
  Term: "Улирал",
  TermReport: "Улирлын тайлан",
  User: "Хэрэглэгч",
};

/**
 * Where the server says this user's session should land after login.
 *
 * `null` means the account holds no membership at all — a real state (an
 * invited user whose membership was revoked), and the UI has to say something
 * rather than redirect in a loop.
 *
 * `"platform"` is the superadmin, checked ahead of every membership role: they
 * hold none by design (CLAUDE.md §1.1 — platform routes stay outside tenant
 * scoping), so without this branch they fall through to the same `null` a
 * revoked user gets.
 */
export const primaryDashboardSchema = z.object({
  dashboard: z.enum(["platform", "admin", "teacher", "cook", "accountant", "parent"]).nullable(),
});

// ── Platform (superadmin) ───────────────────────────────────────────────────

/**
 * `GET /platform/stats` — system-wide totals, RFP §12.2's "Администраторын
 * хяналтын самбар": нийт цэцэрлэг/бүлэг/хүүхэд/багш/идэвхтэй эцэг эх.
 */
export const platformStatsSchema = z.object({
  kindergartens: z.number(),
  groups: z.number(),
  children: z.number(),
  staff: z.number(),
  guardians: z.number(),
});
export type PlatformStats = z.infer<typeof platformStatsSchema>;

/** A kindergarten as the platform operator's list returns it. */
export const platformKindergartenSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type PlatformKindergarten = z.infer<typeof platformKindergartenSchema>;

/**
 * `GET /platform/kindergartens/:id` — the list row plus the same
 * counts/coverage/activity shape `adminDashboardSchema` gives a kindergarten's
 * own admin, scoped by the API to just this one kindergarten.
 */
export const platformKindergartenDetailSchema = platformKindergartenSchema.extend({
  description: z.string().nullish(),
  esisInstitutionId: z.string().nullish(),
  esisEnvironment: z.enum(["TEST", "PRODUCTION"]).nullish(),
  esisMappedAt: z.string().nullish(),
  counts: z.object({
    children: z.number(),
    groups: z.number(),
    staff: z.number(),
    guardians: z.number(),
  }),
  currentTerm: z.object({ id: uuidSchema, number: z.number(), name: z.string() }).nullable(),
  assessmentCoverage: z.array(
    z.object({
      groupId: uuidSchema,
      name: z.string(),
      children: z.number(),
      assessed: z.number(),
    }),
  ),
  recentActivity: z.array(
    z.object({
      id: uuidSchema,
      action: z.string(),
      actorLabel: z.string().nullish(),
      objectType: z.string().nullish(),
      createdAt: z.string(),
    }),
  ),
});
export type PlatformKindergartenDetail = z.infer<typeof platformKindergartenDetailSchema>;

// ── ESIS integration operations ─────────────────────────────────────────────

export const esisResourceKeySchema = z.enum([
  "organization",
  "academicYearStatuses",
  "groups",
  "students",
  "studentByRegister",
  "groupStudents",
  "studentMovements",
  "teachers",
  "staff",
  "groupAttendance",
  "saveAttendanceV3",
  "foodProductTypes",
  "foodMaterialGroups",
  "foodMaterials",
  "foodProducts",
  "foodProductMaterials",
  "foodKit",
  "foodKitProducts",
]);
export type EsisResourceKey = z.infer<typeof esisResourceKeySchema>;

export const esisPreviewResourceKeySchema = z.enum([
  "organization",
  "academicYearStatuses",
  "groups",
  "students",
  "teachers",
  "staff",
  "foodProductTypes",
  "foodMaterialGroups",
  "foodMaterials",
  "foodProducts",
  "foodProductMaterials",
]);
export type EsisPreviewResourceKey = z.infer<typeof esisPreviewResourceKeySchema>;

const esisSyncStatusSchema = z.enum(["RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"]);

/**
 * One input or output field of an ESIS service, and whether NomadKids keeps it.
 *
 * `ingested: false` rows are shown on purpose — they are the record that a
 * field was read in the catalog and refused, with `omitReason` naming the
 * document that refused it.
 */
export const esisFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  io: z.enum(["OUTPUT", "INPUT"]),
  ingested: z.boolean(),
  omitReason: z.string().optional(),
  /**
   * An illustrative value, for showing the screen before a token exists.
   *
   * ★ Never a value ESIS returned. Set only on ingested fields, and the UI
   * shows it only while no live read has succeeded — see `esis.fields.ts`.
   */
  sample: z.string().optional(),
});
export type EsisField = z.infer<typeof esisFieldSchema>;

/** `PORTAL` — read from the ESIS developer catalog. `ADAPTER` — our schema. */
export const esisFieldSourceSchema = z.enum(["PORTAL", "ADAPTER"]);

/** One preview row: every ingested field name → its value, `null` when absent. */
export const esisRowSchema = z.record(z.string(), z.string().nullable());
export type EsisRow = z.infer<typeof esisRowSchema>;

export const esisOverviewSchema = z.object({
  deployment: z.object({
    configured: z.boolean(),
    baseUrl: z.string(),
    hasToken: z.boolean(),
  }),
  connection: z.object({
    mapped: z.boolean(),
    institutionId: z.string().nullable(),
    environment: z.enum(["TEST", "PRODUCTION"]).nullable(),
    mappedAt: z.string().nullable(),
    mappingMatchesDeployment: z.boolean(),
  }),
  stages: z.array(
    z.object({
      code: z.enum(["C1", "C2", "C3", "C4", "C5"]),
      label: z.string(),
      status: z.enum(["READY", "WAITING"]),
    }),
  ),
  endpoints: z.array(
    z.object({
      key: esisResourceKeySchema,
      /** The portal's own id, or null while it is still to be read off it. */
      apiId: z.number().nullable(),
      slug: z.string(),
      method: z.enum(["GET", "POST"]),
      path: z.string(),
      name: z.string(),
      domain: z.enum(["ORGANIZATION", "ROSTER", "ATTENDANCE", "FOOD"]),
      usage: z.string(),
      note: z.string().optional(),
      previewable: z.boolean(),
      readable: z.boolean(),
      params: z.array(z.string()),
      fields: z.array(esisFieldSchema),
      fieldSource: esisFieldSourceSchema,
      ingestedFieldCount: z.number(),
      /** One illustrative row — shown only until a live read succeeds. */
      sampleRow: esisRowSchema,
      /**
       * Every illustrative record of the service, `sampleRow` first.
       *
       * ★ A list service demonstrates a list. One row answers "what fields come
       * back?"; it does not answer "what does a synced kindergarten look like?",
       * which is the question asked before a token exists. Same rule as
       * `sampleRow`: the whole set disappears the moment ESIS returns anything.
       */
      sampleRows: z.array(esisRowSchema),
      accessStatus: z.literal("UNKNOWN"),
    }),
  ),
  recentRuns: z.array(
    z.object({
      id: uuidSchema,
      status: esisSyncStatusSchema,
      resources: z.array(z.string()),
      summary: z.unknown().nullable(),
      errorCode: z.string().nullable(),
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      initiatedBy: z.string(),
    }),
  ),
  canPreview: z.boolean(),
  blockers: z.array(z.string()),
});
export type EsisOverview = z.infer<typeof esisOverviewSchema>;

export const esisPreviewResultSchema = z.object({
  runId: uuidSchema,
  dryRun: z.literal(true),
  status: z.enum(["SUCCEEDED", "PARTIAL", "FAILED"]),
  results: z.array(
    z.object({
      resource: esisPreviewResourceKeySchema,
      count: z.number(),
      durationMs: z.number().nullable(),
      preview: z.array(esisRowSchema),
      status: z.enum(["SUCCEEDED", "FAILED"]),
      errorCode: z.string().nullable(),
    }),
  ),
});
export type EsisPreviewResult = z.infer<typeof esisPreviewResultSchema>;

/**
 * `GET /kindergartens/:id/esis/resource` — one service, read in place.
 *
 * A failed read is a result with an `errorCode`, not an HTTP error: the button
 * that triggered it exists to report whether the connection works.
 */
export const esisResourceReadSchema = z.object({
  resource: esisResourceKeySchema,
  status: z.enum(["SUCCEEDED", "FAILED"]),
  errorCode: z.string().nullable(),
  count: z.number(),
  durationMs: z.number().nullable(),
  fields: z.array(esisFieldSchema),
  rows: z.array(esisRowSchema),
});
export type EsisResourceRead = z.infer<typeof esisResourceReadSchema>;

/**
 * Safe ESIS student output used while registering a child.
 *
 * This deliberately contains the catalog row after field minimization, so
 * civil identifiers and provider credentials never reach the staff form.
 */
export const esisStudentRegistrationTemplateSchema = z.object({
  mode: z.enum(["DEMO", "LIVE"]),
  resource: z.literal("students"),
  apiId: z.number().int().positive(),
  slug: z.string(),
  method: z.literal("GET"),
  endpoint: z.string(),
  syncedAt: z.string(),
  fields: z.array(esisFieldSchema),
  row: esisRowSchema,
});
export type EsisStudentRegistrationTemplate = z.infer<typeof esisStudentRegistrationTemplateSchema>;

/** ESIS teacher/staff row matched to the signed-in user. */
export const esisMyProfileSchema = z.object({
  mode: z.enum(["DEMO", "LIVE"]),
  resource: z.enum(["teachers", "staff"]),
  apiId: z.number().int().positive(),
  slug: z.string(),
  endpoint: z.string(),
  syncedAt: z.string(),
  institutionId: z.string().nullable(),
  fields: z.array(esisFieldSchema),
  row: esisRowSchema,
});
export type EsisMyProfile = z.infer<typeof esisMyProfileSchema>;

/** `POST /platform/kindergartens` — the tenant, its first admin, and the invite. */
export const createdKindergartenSchema = z.object({
  kindergarten: platformKindergartenSchema.pick({ id: true, name: true }),
  admin: z.object({
    id: uuidSchema,
    username: z.string(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    lastName: z.string(),
    firstName: z.string(),
  }),
  invitationToken: z.string(),
});

/**
 * The radar — RFP §12.1, one child's standing across the five domains.
 *
 * ★ Every axis is present whether or not it has been assessed.
 *
 * A radar drawn from only the domains that have a score is a different *shape*
 * each time, and shape is the whole signal — a four-sided figure and a
 * five-sided one are not comparable at a glance. `score: null` is an axis at
 * the origin and a gap the reader can see, which is the honest rendering of
 * "not assessed yet".
 *
 * Scores are the `AssessmentLevel.value`, 1–4, not a percentage. The levels are
 * an ordinal scale a kindergarten can rename, so the axis is labelled with the
 * level's own words and the number is only what positions the point.
 */
export const radarAxisSchema = z.object({
  domain: domainSchema,
  /** 1–4, or null where this domain has no assessment for the term. */
  score: z.number().nullable(),
  level: levelSchema.nullish(),
});

/**
 * The cohort line, and the reason it is nullable.
 *
 * ★★ An average over a small group *is* an individual score.
 *
 * A parent who knows their own child's score and the mean of a group of two can
 * compute the other child's exactly: `other = mean × 2 − own`. At three it is a
 * narrow range. This product's entire authorization design exists to stop one
 * family reading another child's record, and an aggregate is the ordinary way
 * that protection is lost.
 *
 * So the comparison is withheld from guardians until the cohort is large enough
 * for the mean to describe a group rather than a person. Staff are not
 * suppressed: a teacher already opens every child in their group individually,
 * so hiding the average from them protects nobody and costs the feature.
 *
 * `sampleSize` is published so the UI can say what the line is an average *of* —
 * "18 хүүхдийн дундаж" is a fact about the comparison; an unlabelled second
 * line is an invitation to over-read it.
 */
export const radarCohortSchema = z.object({
  group: namedRefSchema,
  /** Children with at least one assessment this term, including this one. */
  sampleSize: z.number(),
  /** Mean level value per domain id. Domains nobody has been assessed on are absent. */
  averageByDomain: z.record(uuidSchema, z.number()),
});

export const assessmentRadarSchema = z.object({
  term: z.object({ id: uuidSchema, number: z.number(), name: z.string() }),
  axes: z.array(radarAxisSchema),
  /** Null when there is no group, or when the cohort is too small to disclose. */
  cohort: radarCohortSchema.nullable(),
});
export type AssessmentRadar = z.infer<typeof assessmentRadarSchema>;
export type RadarAxis = z.infer<typeof radarAxisSchema>;

/**
 * The roster's headline numbers — RFP §12.1.
 *
 * `averageAgeMonths` is months rather than years because a kindergarten's
 * roster spans about 2 to 5 years old: rounded to whole years the mean reads
 * "3" for most of a school year and stops carrying information. Null when no
 * child has a usable birth date — "0 нас" would be a claim rather than an
 * absence.
 */
export const rosterSummarySchema = z.object({
  total: z.number(),
  averageAgeMonths: z.number().nullable(),
  /**
   * Counted independently, so neither is derived from `total`. `Sex` is a
   * two-value enum today; the day it gains a third or becomes nullable, a
   * subtraction would silently file those children under the remaining label.
   */
  boys: z.number(),
  girls: z.number(),
});
export type RosterSummary = z.infer<typeof rosterSummarySchema>;

// ── Chat ─────────────────────────────────────────────────────────────────────

/**
 * A group message board — RFP Phase IV, in scope from 2026-08-29 (CLAUDE.md §7).
 *
 * ★ **No AI.** The client stated it three times and it is worth restating where
 * the types live: there is no assistant, no generated reply, no model call.
 * These are messages people typed, in rooms they already belong to.
 */
export const chatRoomKindSchema = z.enum(["GROUP", "STAFF"]);
export type ChatRoomKind = z.infer<typeof chatRoomKindSchema>;

/**
 * One room in the actor's list.
 *
 * `key` is the room's identity — `group:<uuid>` or `staff:<kindergartenId>`.
 * It is opaque to the client and authorizes nothing: the API resolves it
 * against the caller's own rooms on every request (`ChatAccessService`).
 */
export const chatRoomSchema = z.object({
  key: z.string(),
  kind: chatRoomKindSchema,
  kindergartenId: uuidSchema,
  groupId: uuidSchema.nullable(),
  name: z.string(),
  /** How many people can see this room — the drawing's "24 гишүүн". */
  memberCount: z.number(),
  /** Newest message, for the list's preview line. Null in an empty room. */
  lastMessage: z
    .object({
      id: uuidSchema,
      body: z.string(),
      createdAt: z.string(),
      author: personRefSchema.nullish(),
    })
    .nullable()
    .default(null),
  /** Messages since this reader's `lastReadAt`. */
  unreadCount: z.number().default(0),
});
export type ChatRoom = z.infer<typeof chatRoomSchema>;

export const chatMessageSchema = z.object({
  id: uuidSchema,
  roomKey: z.string(),
  body: z.string(),
  createdAt: z.string(),
  author: personRefSchema.nullish(),
  /** Whether the signed-in reader wrote it — the client aligns their own right. */
  mine: z.boolean().default(false),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Bodies are bounded: a chat message is not a document. */
export const sendChatMessageSchema = z.object({
  body: z.string().trim().min(1, "Мессеж хоосон байна").max(2000),
});
export type SendChatMessageDto = z.infer<typeof sendChatMessageSchema>;

// ── Platform revenue ─────────────────────────────────────────────────────────

/**
 * What one kindergarten produced in a month — the platform operator's view.
 *
 * ★ Totals only. There is deliberately no per-child breakdown on this shape,
 * and that is a security boundary rather than an omission: `platform-access.
 * service.ts` records that a superadmin registers kindergartens and does not
 * read children, and a funding row carries a child's id, their attendance and
 * what they were billed. Aggregates are the platform's business; the rows
 * behind them are the kindergarten's, and `/kindergartens/:id/funding` is where
 * an administrator reads those.
 */
export const kindergartenRevenueSchema = z.object({
  kindergartenId: uuidSchema,
  name: z.string(),
  /** How many funding rows the totals were computed from. Never who. */
  entries: z.number(),
  /** Decimal strings, not numbers — see `funding.dto.ts` for why. */
  calculated: z.string(),
  approved: z.string(),
  received: z.string(),
  /**
   * ★ The platform's **own** income from this kindergarten — paid portal
   * access fees. Added 2026-09-02; see `platformRevenueSchema` below for why
   * it had to be, and why it is not the same money as `received`.
   */
  accessFees: z.string(),
  /** How many access fees were paid. Never which children. */
  accessPayments: z.number(),
});
export type KindergartenRevenue = z.infer<typeof kindergartenRevenueSchema>;

/**
 * The platform operator's screen — and it reports **two different pots of
 * money**, which is the whole point of this shape.
 *
 * ★★★ **Corrected 2026-09-02, and the correction matters to real people's
 * money.**
 *
 * This screen used to report one set of figures — `calculated`/`approved`/
 * `received` from `FundingCalculation` — and `/platform/revenue/distribution`
 * divided the last of them among the revenue partners. Every one of those is
 * **state funding paid to a kindergarten**. It is the kindergarten's money.
 * The platform does not receive it, cannot receive it, and has no share in it.
 *
 * The platform's actual income is the **portal access fee** (CLAUDE.md §7 §8 —
 * "it is the platform operator's revenue", which is precisely why no `Payment`
 * row is written for one). That money appeared nowhere on this screen: a
 * repo-wide search for `accessSubscription` under `src/platform/` returned
 * nothing.
 *
 * So a partner checking their agreed percentage was reading a share of money
 * the platform never earned, while the money it did earn was invisible. Both
 * halves of that are now fixed: `platform` below is the operator's own income,
 * and `distribution` divides **that**.
 *
 * ★ `state` keeps the old figures under an honest name. They are worth showing
 * — an operator does want to know which kindergartens are running — but never
 * again under a heading that implies the platform is owed a slice.
 */
export const platformRevenueSchema = z.object({
  month: z.string(),
  kindergartens: z.array(kindergartenRevenueSchema).default([]),
  /**
   * State funding that reached the kindergartens. **Not the platform's.**
   * Named `state` rather than `totals` so no future reader can mistake it for
   * income again — the rename is deliberate and is what forces every call site
   * to be re-read.
   */
  state: z.object({
    calculated: z.string(),
    approved: z.string(),
    received: z.string(),
  }),
  /** The operator's own income for the month — what a share is taken from. */
  platform: z.object({
    /** Paid portal access fees. */
    accessFees: z.string(),
    /** How many fees were paid. */
    accessPayments: z.number(),
  }),
});
export type PlatformRevenue = z.infer<typeof platformRevenueSchema>;

/** A person with an agreed percentage of the platform's income. */
export const revenuePartnerSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sharePercent: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  note: z.string().nullable(),
});
export type RevenuePartner = z.infer<typeof revenuePartnerSchema>;

/**
 * The month's income divided by the agreed shares.
 *
 * ★ Computed from **paid access fees** — the platform's own income.
 *
 * It used to be computed from `FundingCalculation.receivedAmount`, which is
 * state money belonging to the kindergartens. See `platformRevenueSchema`
 * above for the full correction. The field is renamed `accessFees` rather than
 * left as `received` **on purpose**: the same name holding a different meaning
 * is how a reader keeps the old assumption without noticing, and this
 * codebase has already paid for that once (`previousBalance`,
 * `docs/FINANCE_MODULE.md` §1).
 *
 * ★★ Only money that has actually **arrived**. A share of an unpaid QPay
 * invoice is a share of a QR code nobody scanned.
 *
 * `unallocated` is what is left when the shares do not add to 100 — shown
 * rather than hidden, because a split that quietly loses 8% of a month is the
 * failure this screen exists to prevent.
 */
export const revenueDistributionSchema = z.object({
  month: z.string(),
  /** Paid portal access fees for the month — the sum being divided. */
  accessFees: z.string(),
  /** How many payments made it up, so the figure can be checked against QPay. */
  accessPayments: z.number(),
  allocatedPercent: z.string(),
  unallocated: z.string(),
  shares: z
    .array(
      z.object({
        partnerId: uuidSchema,
        name: z.string(),
        sharePercent: z.string(),
        amount: z.string(),
      }),
    )
    .default([]),
});
export type RevenueDistribution = z.infer<typeof revenueDistributionSchema>;

// ── One kindergarten's funding — `нэмэлт.md` §4–§6 ───────────────────────────

/**
 * ★ Not to be confused with `platformRevenueSchema`.
 *
 * That one is the operator's income across every kindergarten and carries no
 * per-child anything, deliberately. This is a single kindergarten's own money,
 * read by its administrator or its accountant, and it *does* name children —
 * because reconciling a state transfer means knowing which child was funded for
 * how many days. `assertCanReadFinance` is what keeps it to those two roles.
 */
export const fundingSourceSchema = z.enum(["STATE", "PARENT", "KINDERGARTEN", "OTHER"]);
export type FundingSource = z.infer<typeof fundingSourceSchema>;

export const FUNDING_SOURCE_LABEL: Record<FundingSource, string> = {
  STATE: "Улсын",
  PARENT: "Эцэг эхийн",
  KINDERGARTEN: "Цэцэрлэгийн",
  OTHER: "Бусад",
};

export const fundingRuleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  source: fundingSourceSchema,
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullish(),
  ageBand: z.string().nullish(),
  /** Money is a decimal **string** on the wire — see `funding.dto.ts` for why. */
  dailyRate: z.string().nullish(),
  monthlyRate: z.string().nullish(),
  dependsOnAttendance: z.boolean(),
  dependsOnMeals: z.boolean(),
  note: z.string().nullish(),
});
export type FundingRule = z.infer<typeof fundingRuleSchema>;

/*
 * The month as the funding screen reads it, row by row — `нэмэлт.md` §4.
 *
 * Kept beside the register below rather than folded into it: this is one
 * calculation per child with the stored amounts, and the register is the
 * director's month-end view that joins those amounts to attendance and meals.
 * Two readers of the same rows, asking different questions.
 */
export const fundingCalculationSchema = z.object({
  id: uuidSchema,
  source: fundingSourceSchema,
  daysAttended: z.number(),
  daysFed: z.number(),
  dailyRate: z.string().nullable(),
  calculatedAmount: z.string(),
  approvedAmount: z.string().nullable(),
  receivedAmount: z.string().nullable(),
  note: z.string().nullable(),
  child: z.object({
    id: uuidSchema,
    lastName: z.string().nullable(),
    firstName: z.string(),
  }),
});
export type FundingCalculation = z.infer<typeof fundingCalculationSchema>;

export const fundingMonthSchema = z.object({
  month: z.string(),
  items: z.array(fundingCalculationSchema).default([]),
  totals: z
    .array(
      z.object({
        source: fundingSourceSchema,
        children: z.number(),
        calculated: z.string(),
        approved: z.string(),
        received: z.string(),
      }),
    )
    .default([]),
});
export type FundingMonth = z.infer<typeof fundingMonthSchema>;

/**
 * A month's days, per status — all **six**, including `OTHER`.
 *
 * ★ Not `attendanceSummarySchema`, and the difference is deliberate.
 *
 * That one is `z.record(attendanceStatusSchema, …)` over the five statuses the
 * web app had when it was written; `AttendanceStatus` in schema.prisma has
 * carried a sixth since 2026-08-25 (see its doc comment). A register that
 * silently dropped `OTHER` would show a child with twenty-one recorded days as
 * having twenty, and the missing day would appear as an unexplained gap in a
 * figure somebody bills against. Explicit fields, so adding a seventh status is
 * a type error here rather than a quiet zero.
 */
export const attendanceCountsSchema = z.object({
  PRESENT: z.number().int(),
  HALF_DAY: z.number().int(),
  EXCUSED: z.number().int(),
  SICK: z.number().int(),
  ABSENT: z.number().int(),
  OTHER: z.number().int(),
});
export type AttendanceCounts = z.infer<typeof attendanceCountsSchema>;

/**
 * One group's month, as the attendance register's own panel reads it.
 *
 * ★ Counts, never a percentage.
 *
 * Which statuses count as "attended" is a policy question — the funding rules
 * answer it one way and a teacher reading a register another — so the endpoint
 * returns what was recorded and each screen states its own definition. The
 * same rule `attendanceCountsSchema` above is shaped by, and the reason
 * `dashboard.repository.ts` keeps its `ATTENDED` list at the call site.
 *
 * `days` holds only dates that carry a record: a kindergarten's working days
 * are the days somebody registered, not weekdays on a calendar, so a padded
 * weekend would read as a day the whole group missed.
 */
export const groupAttendanceSummarySchema = z.object({
  month: z.string(),
  /** Currently enrolled — the same roster the day sheet lists. */
  roster: z.number().int(),
  days: z.array(z.object({ date: z.string(), counts: attendanceCountsSchema })).default([]),
  totals: attendanceCountsSchema,
  /** Every child on the roster, including those with nothing recorded. */
  children: z
    .array(z.object({ child: personRefSchema, counts: attendanceCountsSchema }))
    .default([]),
});
export type GroupAttendanceSummary = z.infer<typeof groupAttendanceSummarySchema>;

/**
 * What the row needs a human to do about it.
 *
 * ★ Derived on every read, never stored.
 *
 * A stored flag would be a fourth thing that can disagree with the register,
 * the meal log and the calculation. All three of these are questions the data
 * already answers:
 *
 *  - `CHECK` — the kitchen fed the child on more days than the register says
 *    they attended. `funding-rules.ts` calls this out by name as "a data-entry
 *    error worth surfacing rather than silently pricing"; this is the surface.
 *  - `MISSING_DOCUMENT` — absence days with no approved request behind them.
 *    §6's "акт дутуу": the deduction cannot be justified to an auditor.
 *  - `SETTLED` — an approved or received amount has been recorded.
 *  - `CALCULATED` — the month has been run and nothing is outstanding.
 *  - `PENDING` — no calculation exists for this child yet.
 */
export const registerStateSchema = z.enum([
  "CHECK",
  "MISSING_DOCUMENT",
  "SETTLED",
  "CALCULATED",
  "PENDING",
]);
export type RegisterState = z.infer<typeof registerStateSchema>;

export const REGISTER_STATE_LABEL: Record<RegisterState, string> = {
  CHECK: "Шалгах",
  MISSING_DOCUMENT: "Акт дутуу",
  SETTLED: "Баталгаажсан",
  CALCULATED: "Тооцсон",
  PENDING: "Тооцоолоогүй",
};

/** The money on one row. Absent until the month has been calculated. */
export const registerFundingSchema = z.object({
  id: uuidSchema,
  source: fundingSourceSchema,
  daysAttended: z.number().int(),
  daysFed: z.number().int(),
  dailyRate: z.string().nullish(),
  /** Өдрийн тариф × ажлын өдөр — what a full month would have cost. */
  grossAmount: z.string(),
  /** Суутгал — the days not billed. `gross − net`, never independently stored. */
  deductionAmount: z.string(),
  /** Эцсийн төлбөр — the stored `calculatedAmount`, unmodified. */
  netAmount: z.string(),
  approvedAmount: z.string().nullish(),
  receivedAmount: z.string().nullish(),
  note: z.string().nullish(),
});

export const registerRowSchema = z.object({
  child: personRefSchema,
  group: z.object({ id: uuidSchema, name: z.string() }).nullish(),
  counts: attendanceCountsSchema,
  /** Days the kitchen served this child anything — one per date, not per sitting. */
  mealDays: z.number().int(),
  /** Absence days with no approved `AttendanceRequest` covering them. */
  undocumentedDays: z.number().int(),
  funding: registerFundingSchema.nullish(),
  state: registerStateSchema,
});
export type RegisterRow = z.infer<typeof registerRowSchema>;

/**
 * Totals over the **whole filtered set**, not the page.
 *
 * A footer that summed only the fifty rows on screen would read as the month's
 * total and be wrong by however many pages follow it.
 */
export const registerTotalsSchema = z.object({
  children: z.number().int(),
  counts: attendanceCountsSchema,
  mealDays: z.number().int(),
  grossAmount: z.string(),
  deductionAmount: z.string(),
  netAmount: z.string(),
  approvedAmount: z.string(),
  receivedAmount: z.string(),
  /** How many rows carry each state — what the alert strip counts. */
  needingCheck: z.number().int(),
  missingDocuments: z.number().int(),
});

export const attendanceRegisterSchema = paginated(registerRowSchema).extend({
  month: z.string(),
  source: fundingSourceSchema.nullish(),
  /**
   * Days the kindergarten actually operated — dates with at least one
   * attendance row, not weekdays on a calendar.
   *
   * ★ A holiday nobody registered is not a working day, and no table of
   * Mongolian public holidays is hard-coded anywhere for it to disagree with.
   */
  workingDays: z.number().int(),
  totals: registerTotalsSchema,
  rules: z.array(fundingRuleSchema),
  /** When the month was last run, from the newest calculation row. */
  calculatedAt: z.string().nullish(),
});
export type AttendanceRegister = z.infer<typeof attendanceRegisterSchema>;

// ── Group observation statistics ─────────────────────────────────────────────

/**
 * A group's note-keeping, summarised — the client's 2026-08-31 dashboard.
 *
 * ★ Counts only. Nothing here carries an observation's text, which is why the
 * endpoint needs no visibility filter: there is nothing in it a guardian's
 * `GET` would have to be stopped from seeing, and staff-only access is about
 * the group boundary rather than about the notes.
 */
const statBucketSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  count: z.number(),
});

export const groupObservationStatsSchema = z.object({
  /** Notes written in the window. */
  total: z.number(),
  /** Actively enrolled children — the denominator for coverage. */
  enrolled: z.number(),
  /** How many *different* children were written about, not how many notes. */
  childrenWithNotes: z.number(),
  /** Every configured type, including the ones sitting at zero. */
  byType: z.array(statBucketSchema).default([]),
  byDomain: z.array(statBucketSchema).default([]),
  /** The busiest activity names — free text, so keyed by name rather than id. */
  byActivity: z.array(z.object({ name: z.string(), count: z.number() })).default([]),
  /** `yyyy-mm` buckets, ascending. Months with no notes are absent. */
  byMonth: z.array(z.object({ month: z.string(), count: z.number() })).default([]),
});
export type GroupObservationStats = z.infer<typeof groupObservationStatsSchema>;

// ── Parent invoices and payments — `нэмэлт.md` §7–§8 ─────────────────────────

/**
 * ★ Every amount below is a decimal **string**, never a number.
 *
 * The same rule the API applies in `invoices.dto.ts`, restated here because
 * this is the file the web app validates against: a JSON number is an IEEE 754
 * double, and a bill a family is asked to pay cannot pass through one. The
 * screens format these strings — `money()` in the finance pages splits on the
 * decimal point rather than parsing.
 */

export const invoiceLineTypeSchema = z.enum(["TUITION", "MEAL", "CLUB", "BUS", "EXTRA", "OTHER"]);
export type InvoiceLineType = z.infer<typeof invoiceLineTypeSchema>;

/** нэмэлт.md §7's six payment types, in Mongolian. */
export const INVOICE_LINE_TYPE_LABEL: Record<InvoiceLineType, string> = {
  TUITION: "Сургалтын төлбөр",
  MEAL: "Хоолны мөнгө",
  CLUB: "Дугуйлан",
  BUS: "Автобус",
  EXTRA: "Нэмэлт үйлчилгээ",
  OTHER: "Бусад",
};

export const invoiceStatusSchema = z.enum([
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "REFUNDED",
]);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/** нэмэлт.md §8's five invoice states, in Mongolian. */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  UNPAID: "Төлөгдөөгүй",
  PARTIALLY_PAID: "Хэсэгчлэн төлсөн",
  PAID: "Төлсөн",
  OVERDUE: "Хугацаа хэтэрсэн",
  REFUNDED: "Буцаалт",
};

export const paymentMethodSchema = z.enum(["CASH", "BANK_TRANSFER", "QPAY", "SOCIALPAY", "OTHER"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** нэмэлт.md §8's payment methods, in Mongolian. */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Бэлнээр",
  BANK_TRANSFER: "Банкны шилжүүлэг",
  QPAY: "QPay",
  SOCIALPAY: "SocialPay",
  OTHER: "Бусад",
};

export const invoiceLineItemSchema = z.object({
  id: uuidSchema,
  type: invoiceLineTypeSchema,
  description: z.string().nullable(),
  /** Decimal string — see `funding.dto.ts`'s `money` for why. */
  amount: z.string(),
});
export type InvoiceLineItem = z.infer<typeof invoiceLineItemSchema>;

export const paymentSchema = z.object({
  id: uuidSchema,
  /** Negative on a reversal row — see the `Payment` model's own comment. */
  amount: z.string(),
  method: paymentMethodSchema,
  gatewayReference: z.string().nullable(),
  note: z.string().nullable(),
  voidedAt: z.string().nullable(),
  reversalOfId: uuidSchema.nullable(),
  recordedBy: personRefSchema.nullish(),
  createdAt: z.string(),
});
export type Payment = z.infer<typeof paymentSchema>;

/**
 * One child's bill for one month.
 *
 * ★ Not to be confused with `fundingCalculationSchema` — that is what the
 * state owes the kindergarten; this is what a parent owes it. §10's Child 360
 * finance tab reads both, side by side, for exactly that reason.
 */
export const invoiceSchema = z.object({
  id: uuidSchema,
  month: z.string(),
  baseAmount: z.string(),
  mealAmount: z.string(),
  extraAmount: z.string(),
  discountAmount: z.string(),
  previousBalance: z.string(),
  totalDue: z.string(),
  paidAmount: z.string(),
  balance: z.string(),
  dueDate: z.string(),
  status: invoiceStatusSchema,
  note: z.string().nullable(),
  child: z.object({
    id: uuidSchema,
    lastName: z.string().nullable(),
    firstName: z.string(),
  }),
  lineItems: z.array(invoiceLineItemSchema).default([]),
  payments: z.array(paymentSchema).default([]),
  createdAt: z.string(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

/** The list view — no line items or payments, one row per invoice. */
export const invoiceSummarySchema = invoiceSchema.omit({ lineItems: true, payments: true });
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

// ── QPay — нэмэлт.md §8's online-payment attempt ─────────────────────────────

export const qpayInvoiceStatusSchema = z.enum(["PENDING", "PAID", "EXPIRED", "CANCELLED"]);
export type QpayInvoiceStatus = z.infer<typeof qpayInvoiceStatusSchema>;

/**
 * One attempt to pay an `Invoice` through QPay — what
 * `ChildInvoiceQpayController`'s `create`/`status` return.
 */
/**
 * The portal access fee — client instruction, 2026-09-01: QPay charges parents
 * for the right to use the site, and nothing else. Tuition and meal bills are
 * still raised and still settled, but never through the gateway.
 */
export const accessSubscriptionSchema = z.object({
  id: z.string(),
  status: z.enum(["UNPAID", "ACTIVE", "EXPIRED"]),
  amount: z.string(),
  expiresAt: z.string(),
  paidAt: z.string().nullable(),
  schoolYear: z.object({ id: z.string(), name: z.string(), endsOn: z.string() }),
});
export type AccessSubscription = z.infer<typeof accessSubscriptionSchema>;

/** What the unlock screen reads. `required: false` means the deployment does not charge. */
export const accessStatusSchema = z.object({
  required: z.boolean(),
  active: z.boolean(),
  amount: z.string().nullable(),
  subscription: accessSubscriptionSchema.nullable(),
});
export type AccessStatus = z.infer<typeof accessStatusSchema>;

export const qpayInvoiceAttemptSchema = z.object({
  id: uuidSchema,
  status: qpayInvoiceStatusSchema,
  amount: z.string(),
  qrText: z.string().nullable(),
  /** Base64 PNG, no `data:` prefix — see `QpayClient`'s own comment. */
  qrImage: z.string().nullable(),
  expiresAt: z.string().nullable(),
  paidAt: z.string().nullable(),
});
export type QpayInvoiceAttempt = z.infer<typeof qpayInvoiceAttemptSchema>;

/**
 * The financial dashboard's month — `нэмэлт.md` §9.
 *
 * ★ Nine figures, none of them stored. Every one is aggregated on read from
 * the funding calculations, invoices and payments that already exist, so the
 * dashboard cannot drift from the register beneath it.
 *
 * ★★ `pending` and `unpaid` are derived server-side and clamped at zero —
 * an overpayment is a reconciliation question, not a negative amount owed.
 */
export const financeDashboardSchema = z.object({
  month: z.string(),
  state: z.object({
    children: z.number(),
    calculated: z.string(),
    approved: z.string(),
    received: z.string(),
    /** `approved − received`. */
    pending: z.string(),
  }),
  parents: z.object({
    invoices: z.number(),
    billed: z.string(),
    paid: z.string(),
    /** `billed − paid`. */
    unpaid: z.string(),
    /**
     * Past the due date with money still owed — **not** scoped to the month.
     * Arrears do not disappear on the first of the next one.
     */
    overdueCount: z.number(),
    overdueAmount: z.string(),
  }),
  meals: z.object({
    total: z.string(),
    fedDays: z.number(),
    /** Children who actually ate — the denominator for `perChild`. */
    children: z.number(),
    perChild: z.string(),
    bySource: z.array(z.object({ source: fundingSourceSchema, amount: z.string() })).default([]),
  }),
});
export type FinanceDashboard = z.infer<typeof financeDashboardSchema>;

/**
 * One child's finance tab — `нэмэлт.md` §10.
 *
 * ★ `funding` is **optional on purpose**, and its absence is an authorization
 * outcome rather than an empty list. State funding is what the government pays
 * the kindergarten for this child — the kindergarten's revenue, not the
 * family's debt — so the API omits the key entirely for a guardian rather than
 * sending it for a screen to hide.
 */
export const childFundingRowSchema = z.object({
  id: uuidSchema,
  month: z.string(),
  source: fundingSourceSchema,
  rule: z.string().nullable(),
  /** Which counter the daily rate multiplied. */
  basis: z.enum(["ATTENDANCE", "MEALS"]),
  daysAttended: z.number(),
  daysFed: z.number(),
  dailyRate: z.string().nullable(),
  calculated: z.string(),
  approved: z.string().nullable(),
  received: z.string().nullable(),
});

export const childFinanceSchema = z.object({
  childId: uuidSchema,
  invoices: z.number(),
  billed: z.string(),
  paid: z.string(),
  discounts: z.string(),
  /** Signed: negative means the family is in credit. */
  balance: z.string(),
  funding: z.array(childFundingRowSchema).optional(),
});
export type ChildFinance = z.infer<typeof childFinanceSchema>;

// ── The financial reports — `нэмэлт.md` §16 ──────────────────────────────────

/**
 * ★ Eight keys, not nine. §16 lists nine reports, but its third —
 * "Ирц–санхүүжилтийн тулгалт" — is the monthly register, which shipped with §6
 * and has its own screen and its own export. A ninth key here would give the
 * product two answers to one question.
 */
export const financeReportKeySchema = z.enum([
  "state-funding",
  "child-funding",
  "meal-days",
  "meal-cost",
  "parent-payments",
  "unpaid",
  "variance",
  "annual",
]);
export type FinanceReportKey = z.infer<typeof financeReportKeySchema>;

export const FINANCE_REPORT_LABEL: Record<FinanceReportKey, string> = {
  "state-funding": "Сарын улсын санхүүжилтийн тайлан",
  "child-funding": "Хүүхэд тус бүрийн санхүүжилтийн тайлан",
  "meal-days": "Хооллосон өдөр–хоолны зардлын тайлан",
  "meal-cost": "Сарын хоолны зардлын тайлан",
  "parent-payments": "Эцэг эхийн төлбөрийн тайлан",
  unpaid: "Төлөгдөөгүй төлбөрийн тайлан",
  variance: "Санхүүжилтийн зөрүүний тайлан",
  annual: "Хичээлийн жилийн санхүүгийн нэгтгэл",
};

/**
 * Which period each report takes.
 *
 * ★ Three shapes, and the screen has to know which control to show. `unpaid`
 * takes none at all — arrears are not a property of a month — so offering a
 * month picker beside it would imply a filter that does not apply.
 */
export const FINANCE_REPORT_PERIOD: Record<FinanceReportKey, "month" | "year" | "none"> = {
  "state-funding": "month",
  "child-funding": "month",
  "meal-days": "month",
  "meal-cost": "month",
  "parent-payments": "month",
  unpaid: "none",
  variance: "month",
  annual: "year",
};

/** A generic report table — the same shape for all eight. */
export const reportTableSchema = z.object({
  title: z.string(),
  columns: z.array(
    z.object({
      key: z.string(),
      header: z.string(),
      /** Rendered as tögrög and right-aligned. */
      money: z.boolean().optional(),
      width: z.number().optional(),
    }),
  ),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  totals: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
  note: z.string().optional(),
});
export type ReportTable = z.infer<typeof reportTableSchema>;

/**
 * A financial report queued as PDF — `нэмэлт.md` §16.
 *
 * ★ A job, not a file. Chromium takes ~2.5 s and a gigabyte of memory, so the
 * PDF goes through BullMQ (CLAUDE.md §6) while the spreadsheet is built inline.
 * The screen polls `status` until `downloadable`.
 */
export const financeReportJobSchema = z.object({
  id: uuidSchema,
  report: z.string().nullable(),
  period: z.string().nullable(),
  status: z.enum(["QUEUED", "RUNNING", "DONE", "FAILED"]),
  progressPercent: z.number(),
  pageCount: z.number(),
  fileSize: z.number(),
  errorMessage: z.string().nullable(),
  requestedAt: z.string(),
  completedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  downloadable: z.boolean(),
});
export type FinanceReportJob = z.infer<typeof financeReportJobSchema>;

export const financeReportDownloadSchema = z.object({
  url: z.string(),
  expiresIn: z.number(),
});

// ── Onboarding — цэцэрлэгтэй гэрээ байгуулах (docs/CONTRACT_ONBOARDING.md) ────

export const kindergartenApplicationStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type KindergartenApplicationStatus = z.infer<typeof kindergartenApplicationStatusSchema>;

export const KINDERGARTEN_APPLICATION_STATUS_LABEL: Record<KindergartenApplicationStatus, string> =
  {
    PENDING: "Хүлээгдэж буй",
    APPROVED: "Батлагдсан",
    REJECTED: "Татгалзсан",
  };

export const contractStatusSchema = z.enum(["PENDING_SIGNATURE", "SIGNED", "ACTIVE", "CANCELLED"]);
export type ContractStatus = z.infer<typeof contractStatusSchema>;

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  PENDING_SIGNATURE: "Гарын үсэг хүлээгдэж буй",
  SIGNED: "Гарын үсэг зурсан",
  ACTIVE: "Идэвхтэй",
  CANCELLED: "Цуцалсан",
};

/**
 * What the public form gets back.
 *
 * ★★ Deliberately thin: an id and a status, nothing else. The response to an
 * unauthenticated write must not become a way to read anything — and in
 * particular it must look **identical** whether or not the registration number
 * was already on file, or the form becomes a tool for asking "is this
 * kindergarten registered with you".
 */
export const applicationReceiptSchema = z.object({
  id: uuidSchema,
  status: kindergartenApplicationStatusSchema,
});
export type ApplicationReceipt = z.infer<typeof applicationReceiptSchema>;

/** One application, as the platform operator reviews it. */
export const kindergartenApplicationSchema = z.object({
  id: uuidSchema,
  kindergartenName: z.string(),
  registrationNumber: z.string(),
  address: z.string(),
  directorName: z.string(),
  phone: z.string(),
  email: z.string(),
  childCount: z.number(),
  note: z.string().nullable(),
  status: kindergartenApplicationStatusSchema,
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  kindergartenId: uuidSchema.nullable(),
  createdAt: z.string(),
  contract: z
    .object({
      id: uuidSchema,
      number: z.string(),
      version: z.number(),
      status: contractStatusSchema,
      pdfMediaFileId: uuidSchema.nullable(),
    })
    .nullable(),
});
export type KindergartenApplication = z.infer<typeof kindergartenApplicationSchema>;

/**
 * What approving an application answers with.
 *
 * ★★ The application, plus the first administrator's **one-time invitation
 * token**. `PlatformService.create` returns one the same way and for the same
 * reason: the kindergarten has no account yet, so there is nobody the product
 * can email it to. The operator hands it over. It is never logged, and it is
 * the only moment it exists in plaintext.
 */
export const applicationApprovalSchema = kindergartenApplicationSchema.extend({
  invitationToken: z.string(),
  adminUsername: z.string(),
});
export type ApplicationApproval = z.infer<typeof applicationApprovalSchema>;
