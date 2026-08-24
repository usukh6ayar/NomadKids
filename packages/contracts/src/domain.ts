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
export const enrollmentStatusSchema = z.enum(["ACTIVE", "ENDED", "TRANSFERRED"]);
export const guardianRelationSchema = z.enum([
  "MOTHER",
  "FATHER",
  "GRANDPARENT",
  "SIBLING",
  "OTHER",
]);

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
export const reportTypeSchema = z.enum(["CHILD_PORTFOLIO", "TERM_REPORT"]);

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

export const attendanceRecordSchema = z.object({
  id: uuidSchema,
  childId: uuidSchema,
  date: z.string(),
  status: attendanceStatusSchema,
  note: z.string().nullish(),
  recordedBy: personRefSchema.nullish(),
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
});
export type AttendanceRequest = z.infer<typeof attendanceRequestSchema>;

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
export const MEDIA_CATEGORIES = ["ARTWORK", "ACTIVITY", "EVENT", "DAILY", "PORTRAIT"] as const;

export const mediaCategorySchema = z.enum(MEDIA_CATEGORIES);

export const MEDIA_CATEGORY_LABEL: Record<string, string> = {
  ARTWORK: "Бүтээл",
  ACTIVITY: "Үйл ажиллагаа",
  EVENT: "Баяр ёслол",
  DAILY: "Өдөр тутам",
  PORTRAIT: "Хөрөг",
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
  observationsByType: z
    .array(z.object({ type: namedRefSchema, count: z.number() }))
    .default([]),
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
   * Assessment progress per group.
   *
   * A ratio, not a chart. "12 of 18 assessed" tells an administrator which
   * group to chase; a bar of the same number tells them nothing more and the
   * brief rules charts out.
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
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;

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
});
export type RosterSummary = z.infer<typeof rosterSummarySchema>;
