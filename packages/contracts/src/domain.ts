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

export const roleSchema = z.enum(["ADMIN", "TEACHER", "PARENT"]);
export type Role = z.infer<typeof roleSchema>;

export const sexSchema = z.enum(["MALE", "FEMALE"]);
export const childStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const enrollmentStatusSchema = z.enum(["ACTIVE", "ENDED", "TRANSFERRED", "GRADUATED"]);
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

export const childSummarySchema = z.object({
  id: uuidSchema,
  lastName: z.string(),
  firstName: z.string(),
  sex: sexSchema.nullish(),
  dateOfBirth: z.string(),
  status: childStatusSchema.nullish(),
  photoMediaFileId: uuidSchema.nullish(),
  // `/children/mine` returns a slimmer row with no enrollments at all, so this
  // defaults rather than being required.
  enrollments: z.array(enrollmentSummarySchema).default([]),
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
  /**
   * On the detail response only, never on a list. It is the one field on a
   * child that identifies them outside this system, so it travels with the
   * single record a member of staff opened rather than with every row of a
   * roster.
   */
  nationalId: z.string().nullish(),
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

export const attendanceStatusSchema = z.enum(["PRESENT", "HALF_DAY", "EXCUSED", "SICK", "ABSENT"]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

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
});
export type AttendanceRequest = z.infer<typeof attendanceRequestSchema>;

// ── Meals ────────────────────────────────────────────────────────────────────

export const menuDishSchema = z.object({
  name: z.string(),
  allergenTags: z.array(z.string()).default([]),
});
export type MenuDish = z.infer<typeof menuDishSchema>;

export const menuDaySchema = z.object({
  id: uuidSchema,
  date: z.string(),
  dishes: z.array(menuDishSchema),
  totalCalories: z.number().int().nullish(),
});
export type MenuDay = z.infer<typeof menuDaySchema>;

/**
 * The meal register — `нэмэлт.md` §2. A different resource from the menu above.
 *
 * ★ `MenuDay` is what the kitchen planned to cook, kindergarten-wide;
 * `MealRecord` is what one child actually ate at one sitting. They share the
 * `MealKind` vocabulary and nothing else — no foreign key, no join. §3 computes
 * the food cost from **хооллосон өдөр**, days eaten, which is why this cannot
 * be inferred from `Attendance` either: a child collected before lunch attended
 * and did not eat.
 */
export const mealKindSchema = z.enum(["BREAKFAST", "LUNCH", "AFTERNOON_SNACK", "EXTRA"]);
export type MealKind = z.infer<typeof mealKindSchema>;

export const mealStatusSchema = z.enum(["TAKEN", "NOT_TAKEN", "PARTIAL", "SPECIAL"]);
export type MealStatus = z.infer<typeof mealStatusSchema>;

/**
 * One saved record, as `PUT /groups/:id/meals` returns them.
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
  "CHECKBOX",
  /** RFP Module 1.1 — several indicators on one shared scale. */
  "MATRIX",
]);
export type SurveyQuestionType = z.infer<typeof surveyQuestionTypeSchema>;

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
  status: surveyStatusSchema,
  publishedAt: z.string().nullish(),
  closedAt: z.string().nullish(),
  createdAt: z.string(),
  /** "2025-2026" — a school year spans two calendar years. */
  schoolYear: z.string().nullish(),
  /** Which wave: RFP Module 1.1's эхний/завсрын/жилийн эцсийн үнэлгээ. */
  period: surveyPeriodSchema.nullish(),
  clonedFromSurveyId: uuidSchema.nullish(),
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

export const surveyResultsSchema = z.object({
  survey: surveySchema,
  totalResponses: z.number(),
  questions: z.array(surveyQuestionResultSchema),
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
  personality: z.string().nullish(),
  emotionalTraits: z.string().nullish(),
  familyMembers: z.string().nullish(),
  learningInterest: z.string().nullish(),
  newSkills: z.string().nullish(),
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

export const notificationSchema = z.object({
  id: uuidSchema,
  title: z.string(),
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
export const MEDIA_CATEGORIES = [
  "ARTWORK",
  "ACTIVITY",
  "EVENT",
  "DAILY",
  "PORTRAIT",
  /**
   * ★ RFP §4.2 asks for a "төрсөн өдрийн зураг" in the birthday section, and
   * `EVENT` cannot answer it: a query for this year's birthday photograph would
   * return every concert and Цагаан сар as well. With `age` already on the row,
   * `category=BIRTHDAY&age=4` is the whole birthday section's photograph.
   */
  "BIRTHDAY",
] as const;

export const mediaCategorySchema = z.enum(MEDIA_CATEGORIES);

export const MEDIA_CATEGORY_LABEL: Record<string, string> = {
  ARTWORK: "Бүтээл",
  ACTIVITY: "Үйл ажиллагаа",
  EVENT: "Баяр ёслол",
  DAILY: "Өдөр тутам",
  PORTRAIT: "Хөрөг",
  BIRTHDAY: "Төрсөн өдөр",
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
  attribution: mediaAttributionSchema.nullish(),
  uploadedBy: personRefSchema.nullish(),
});

/** The gallery response. Every list is paginated — CLAUDE.md §3.4. */
export const mediaListSchema = paginated(mediaSchema);

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
      title: z.string(),
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
  Kindergarten: "Цэцэрлэг",
  MealRecord: "Хоолны бүртгэл",
  MediaFile: "Файл",
  MedicationAuthorisation: "Эм хэрэглэх зөвшөөрөл",
  Membership: "Эрх",
  Milestone: "Онцлох ахиц",
  Notification: "Мэдээ",
  Observation: "Ажиглалт",
  ObservationType: "Ажиглалтын төрөл",
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
  dashboard: z.enum(["platform", "admin", "teacher", "parent"]).nullable(),
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
