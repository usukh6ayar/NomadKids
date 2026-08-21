import { z } from "zod";
import { uuidSchema } from "./ids";

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

export const mediaSchema = z.object({
  id: uuidSchema,
  caption: z.string().nullish(),
  originalName: z.string().nullish(),
  mimeType: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  purpose: z.string().nullish(),
  observationId: uuidSchema.nullish(),
});

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
 */
export const primaryDashboardSchema = z.object({
  dashboard: z.enum(["admin", "teacher", "parent"]).nullable(),
});
