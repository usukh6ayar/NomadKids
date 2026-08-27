/**
 * The domain enums, re-exported from the generated Prisma client.
 *
 * ★ This file is the single sanctioned seam through which non-repository code
 * reaches into `generated/`. Everything else imports from here.
 *
 * Why a seam rather than letting everyone import the generated enums directly:
 * the ESLint boundary treats `generated/prisma/**` as one blocked directory, and
 * carving an exception out of a security rule weakens the rule for every future
 * file. One controlled re-export keeps the boundary absolute while still letting
 * authorization code compare against `Role.TEACHER`.
 *
 * Re-declaring these by hand was the alternative and is worse — a hand-written
 * copy drifts from the schema silently, and the first symptom is an
 * authorization comparison that never matches.
 */

export {
  AgeBand,
  AttendanceCompanion,
  AttendanceRequestStatus,
  AttendanceStatus,
  AuditAction,
  AuthTokenPurpose,
  ChildStatus,
  EnrollmentStatus,
  GroupStatus,
  GuardianRelation,
  MediaAttribution,
  MediaPurpose,
  MediaStatus,
  NotificationStatus,
  ObservationSource,
  ReportStatus,
  ReportType,
  ReviewStatus,
  Role,
  Sex,
  SurveyQuestionType,
  SurveyScope,
  SurveyStatus,
  TeacherRole,
  TermReportStatus,
} from "../generated/prisma/enums";
