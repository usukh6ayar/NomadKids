-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TEACHER', 'PARENT');

-- CreateEnum
CREATE TYPE "AuthTokenPurpose" AS ENUM ('PASSWORD_RESET', 'INVITATION');

-- CreateEnum
CREATE TYPE "AgeBand" AS ENUM ('NURSERY', 'JUNIOR', 'MIDDLE', 'SENIOR');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TeacherRole" AS ENUM ('LEAD', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "ChildStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GuardianRelation" AS ENUM ('MOTHER', 'FATHER', 'GRANDPARENT', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'ENDED', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "ObservationSource" AS ENUM ('TEACHER', 'PARENT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('CHILD_PHOTO', 'OBSERVATION', 'REPORT_OUTPUT');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "TermReportStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('CHILD_PORTFOLIO', 'TERM_REPORT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'VIEW', 'CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'DOWNLOAD', 'PERMISSION_CHANGE', 'PASSWORD_RESET', 'INVITE', 'ACTIVATE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "specialization" TEXT,
    "education" TEXT,
    "bio" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "ipAddress" TEXT,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kindergartens" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "kindergartens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_years" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "school_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ageBand" "AgeBand" NOT NULL,
    "status" "GroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_teachers" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "role" "TeacherRole" NOT NULL DEFAULT 'LEAD',
    "startedOn" DATE,
    "endedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "group_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "children" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "nationalId" TEXT,
    "sex" "Sex" NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "status" "ChildStatus" NOT NULL DEFAULT 'ACTIVE',
    "healthNotes" TEXT,
    "photoMediaFileId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "children_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardianships" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "guardianUserId" UUID NOT NULL,
    "relation" "GuardianRelation" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "guardianships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "startedOn" DATE NOT NULL,
    "endedOn" DATE,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_profiles" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "introduction" TEXT,
    "nameMeaning" TEXT,
    "memorableSayings" TEXT,
    "dream" TEXT,
    "distinguishingTraits" TEXT,
    "heightCm" DECIMAL(5,1),
    "weightKg" DECIMAL(5,2),
    "recordedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "child_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child_age_profiles" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "age" SMALLINT NOT NULL,
    "schoolYearId" UUID,
    "favoriteColor" TEXT,
    "favoriteFood" TEXT,
    "favoriteToy" TEXT,
    "favoriteBook" TEXT,
    "favoriteSong" TEXT,
    "favoriteStory" TEXT,
    "favoriteActivity" TEXT,
    "personality" TEXT,
    "emotionalTraits" TEXT,
    "familyMembers" TEXT,
    "learningInterest" TEXT,
    "newSkills" TEXT,
    "parentNote" TEXT,
    "teacherNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "child_age_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birthday_notes" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "age" SMALLINT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "birthday_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "development_domains" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#94a3b8',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "development_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_levels" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID,
    "value" SMALLINT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#94a3b8',
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "assessment_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation_types" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "observation_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "source" "ObservationSource" NOT NULL DEFAULT 'TEACHER',
    "observedOn" DATE NOT NULL,
    "activityName" TEXT,
    "situation" TEXT,
    "childDid" TEXT,
    "childSaid" TEXT,
    "teacherComment" TEXT,
    "nextSteps" TEXT,
    "visibleToParents" BOOLEAN NOT NULL DEFAULT false,
    "includeInReport" BOOLEAN NOT NULL DEFAULT true,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observation_domains" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "domainId" UUID NOT NULL,
    "levelId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "observation_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "schoolYearId" UUID NOT NULL,
    "number" SMALLINT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "domainId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "levelId" UUID NOT NULL,
    "comment" TEXT,
    "visibleToParents" BOOLEAN NOT NULL DEFAULT false,
    "assessedById" UUID,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "term_reports" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "strengths" TEXT,
    "needsSupport" TEXT,
    "nextGoals" TEXT,
    "adviceForParents" TEXT,
    "status" "TermReportStatus" NOT NULL DEFAULT 'DRAFT',
    "authorId" UUID,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "term_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID,
    "observationId" UUID,
    "order" INTEGER NOT NULL DEFAULT 0,
    "purpose" "MediaPurpose" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "status" "MediaStatus" NOT NULL DEFAULT 'READY',
    "caption" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "startsOn" DATE,
    "endsOn" DATE,
    "isImportant" BOOLEAN NOT NULL DEFAULT false,
    "status" "NotificationStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_targets" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "groupId" UUID,
    "childId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "notification_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_reads" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID NOT NULL,
    "childId" UUID,
    "type" "ReportType" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "requestedById" UUID,
    "status" "ReportStatus" NOT NULL DEFAULT 'QUEUED',
    "progressPercent" SMALLINT NOT NULL DEFAULT 0,
    "resultMediaFileId" UUID,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "pageCount" SMALLINT NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "kindergartenId" UUID,
    "actorUserId" UUID,
    "actorRole" TEXT,
    "actorLabel" TEXT,
    "action" "AuditAction" NOT NULL,
    "objectType" TEXT,
    "objectId" TEXT,
    "childId" UUID,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE INDEX "memberships_userId_isActive_idx" ON "memberships"("userId", "isActive");

-- CreateIndex
CREATE INDEX "memberships_kindergartenId_role_isActive_idx" ON "memberships"("kindergartenId", "role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_kindergartenId_role_key" ON "memberships"("userId", "kindergartenId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_tokens_userId_purpose_usedAt_idx" ON "auth_tokens"("userId", "purpose", "usedAt");

-- CreateIndex
CREATE INDEX "auth_tokens_expiresAt_idx" ON "auth_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "login_attempts_identifier_succeeded_createdAt_idx" ON "login_attempts"("identifier", "succeeded", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_ipAddress_succeeded_createdAt_idx" ON "login_attempts"("ipAddress", "succeeded", "createdAt");

-- CreateIndex
CREATE INDEX "kindergartens_deletedAt_idx" ON "kindergartens"("deletedAt");

-- CreateIndex
CREATE INDEX "school_years_kindergartenId_isCurrent_idx" ON "school_years"("kindergartenId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "school_years_kindergartenId_name_key" ON "school_years"("kindergartenId", "name");

-- CreateIndex
CREATE INDEX "groups_kindergartenId_status_idx" ON "groups"("kindergartenId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "groups_schoolYearId_name_key" ON "groups"("schoolYearId", "name");

-- CreateIndex
CREATE INDEX "group_teachers_groupId_membershipId_idx" ON "group_teachers"("groupId", "membershipId");

-- CreateIndex
CREATE INDEX "group_teachers_membershipId_endedOn_idx" ON "group_teachers"("membershipId", "endedOn");

-- CreateIndex
CREATE UNIQUE INDEX "children_photoMediaFileId_key" ON "children"("photoMediaFileId");

-- CreateIndex
CREATE INDEX "children_kindergartenId_status_idx" ON "children"("kindergartenId", "status");

-- CreateIndex
CREATE INDEX "children_kindergartenId_lastName_firstName_idx" ON "children"("kindergartenId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "children_kindergartenId_dateOfBirth_idx" ON "children"("kindergartenId", "dateOfBirth");

-- CreateIndex
CREATE UNIQUE INDEX "children_kindergartenId_nationalId_key" ON "children"("kindergartenId", "nationalId");

-- CreateIndex
CREATE INDEX "guardianships_guardianUserId_canView_idx" ON "guardianships"("guardianUserId", "canView");

-- CreateIndex
CREATE INDEX "guardianships_childId_idx" ON "guardianships"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "guardianships_childId_guardianUserId_key" ON "guardianships"("childId", "guardianUserId");

-- CreateIndex
CREATE INDEX "enrollments_groupId_status_idx" ON "enrollments"("groupId", "status");

-- CreateIndex
CREATE INDEX "enrollments_schoolYearId_status_idx" ON "enrollments"("schoolYearId", "status");

-- CreateIndex
CREATE INDEX "enrollments_childId_schoolYearId_idx" ON "enrollments"("childId", "schoolYearId");

-- CreateIndex
CREATE INDEX "enrollments_childId_status_idx" ON "enrollments"("childId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "child_profiles_childId_key" ON "child_profiles"("childId");

-- CreateIndex
CREATE INDEX "child_age_profiles_childId_age_idx" ON "child_age_profiles"("childId", "age");

-- CreateIndex
CREATE UNIQUE INDEX "child_age_profiles_childId_age_key" ON "child_age_profiles"("childId", "age");

-- CreateIndex
CREATE UNIQUE INDEX "birthday_notes_childId_age_key" ON "birthday_notes"("childId", "age");

-- CreateIndex
CREATE INDEX "development_domains_kindergartenId_isActive_order_idx" ON "development_domains"("kindergartenId", "isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "development_domains_kindergartenId_code_key" ON "development_domains"("kindergartenId", "code");

-- CreateIndex
CREATE INDEX "assessment_levels_kindergartenId_isActive_order_idx" ON "assessment_levels"("kindergartenId", "isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_levels_kindergartenId_value_key" ON "assessment_levels"("kindergartenId", "value");

-- CreateIndex
CREATE INDEX "observation_types_kindergartenId_isActive_order_idx" ON "observation_types"("kindergartenId", "isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "observation_types_kindergartenId_code_key" ON "observation_types"("kindergartenId", "code");

-- CreateIndex
CREATE INDEX "observations_childId_observedOn_idx" ON "observations"("childId", "observedOn" DESC);

-- CreateIndex
CREATE INDEX "observations_kindergartenId_observedOn_idx" ON "observations"("kindergartenId", "observedOn" DESC);

-- CreateIndex
CREATE INDEX "observations_enrollmentId_observedOn_idx" ON "observations"("enrollmentId", "observedOn" DESC);

-- CreateIndex
CREATE INDEX "observations_source_reviewStatus_idx" ON "observations"("source", "reviewStatus");

-- CreateIndex
CREATE INDEX "observations_childId_visibleToParents_observedOn_idx" ON "observations"("childId", "visibleToParents", "observedOn" DESC);

-- CreateIndex
CREATE INDEX "observation_domains_domainId_idx" ON "observation_domains"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "observation_domains_observationId_domainId_key" ON "observation_domains"("observationId", "domainId");

-- CreateIndex
CREATE INDEX "terms_kindergartenId_startsOn_idx" ON "terms"("kindergartenId", "startsOn");

-- CreateIndex
CREATE UNIQUE INDEX "terms_schoolYearId_number_key" ON "terms"("schoolYearId", "number");

-- CreateIndex
CREATE INDEX "assessments_childId_termId_idx" ON "assessments"("childId", "termId");

-- CreateIndex
CREATE INDEX "assessments_kindergartenId_termId_idx" ON "assessments"("kindergartenId", "termId");

-- CreateIndex
CREATE INDEX "assessments_enrollmentId_termId_idx" ON "assessments"("enrollmentId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_childId_termId_domainId_key" ON "assessments"("childId", "termId", "domainId");

-- CreateIndex
CREATE INDEX "term_reports_childId_termId_idx" ON "term_reports"("childId", "termId");

-- CreateIndex
CREATE INDEX "term_reports_kindergartenId_termId_idx" ON "term_reports"("kindergartenId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "term_reports_childId_termId_key" ON "term_reports"("childId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "media_files_storageKey_key" ON "media_files"("storageKey");

-- CreateIndex
CREATE INDEX "media_files_childId_purpose_uploadedAt_idx" ON "media_files"("childId", "purpose", "uploadedAt" DESC);

-- CreateIndex
CREATE INDEX "media_files_kindergartenId_uploadedAt_idx" ON "media_files"("kindergartenId", "uploadedAt" DESC);

-- CreateIndex
CREATE INDEX "media_files_observationId_order_idx" ON "media_files"("observationId", "order");

-- CreateIndex
CREATE INDEX "media_files_status_deletedAt_idx" ON "media_files"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "notifications_kindergartenId_status_publishedAt_idx" ON "notifications"("kindergartenId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "notification_targets_notificationId_idx" ON "notification_targets"("notificationId");

-- CreateIndex
CREATE INDEX "notification_targets_groupId_idx" ON "notification_targets"("groupId");

-- CreateIndex
CREATE INDEX "notification_targets_childId_idx" ON "notification_targets"("childId");

-- CreateIndex
CREATE INDEX "notification_reads_userId_readAt_idx" ON "notification_reads"("userId", "readAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_reads_notificationId_userId_key" ON "notification_reads"("notificationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "report_jobs_resultMediaFileId_key" ON "report_jobs"("resultMediaFileId");

-- CreateIndex
CREATE INDEX "report_jobs_childId_requestedAt_idx" ON "report_jobs"("childId", "requestedAt" DESC);

-- CreateIndex
CREATE INDEX "report_jobs_kindergartenId_status_requestedAt_idx" ON "report_jobs"("kindergartenId", "status", "requestedAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_childId_createdAt_idx" ON "audit_logs"("childId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_kindergartenId_createdAt_idx" ON "audit_logs"("kindergartenId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_years" ADD CONSTRAINT "school_years_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "school_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_teachers" ADD CONSTRAINT "group_teachers_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_teachers" ADD CONSTRAINT "group_teachers_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_teachers" ADD CONSTRAINT "group_teachers_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "children" ADD CONSTRAINT "children_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "children" ADD CONSTRAINT "children_photoMediaFileId_fkey" FOREIGN KEY ("photoMediaFileId") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "school_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_profiles" ADD CONSTRAINT "child_profiles_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_age_profiles" ADD CONSTRAINT "child_age_profiles_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_age_profiles" ADD CONSTRAINT "child_age_profiles_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_age_profiles" ADD CONSTRAINT "child_age_profiles_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "school_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "birthday_notes" ADD CONSTRAINT "birthday_notes_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "birthday_notes" ADD CONSTRAINT "birthday_notes_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_domains" ADD CONSTRAINT "development_domains_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_levels" ADD CONSTRAINT "assessment_levels_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_types" ADD CONSTRAINT "observation_types_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "observation_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_domains" ADD CONSTRAINT "observation_domains_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_domains" ADD CONSTRAINT "observation_domains_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_domains" ADD CONSTRAINT "observation_domains_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "development_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observation_domains" ADD CONSTRAINT "observation_domains_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "assessment_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "school_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "development_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "assessment_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_reports" ADD CONSTRAINT "term_reports_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_reports" ADD CONSTRAINT "term_reports_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_reports" ADD CONSTRAINT "term_reports_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_reports" ADD CONSTRAINT "term_reports_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "term_reports" ADD CONSTRAINT "term_reports_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_targets" ADD CONSTRAINT "notification_targets_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_targets" ADD CONSTRAINT "notification_targets_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_targets" ADD CONSTRAINT "notification_targets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_targets" ADD CONSTRAINT "notification_targets_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_resultMediaFileId_fkey" FOREIGN KEY ("resultMediaFileId") REFERENCES "media_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_kindergartenId_fkey" FOREIGN KEY ("kindergartenId") REFERENCES "kindergartens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_childId_fkey" FOREIGN KEY ("childId") REFERENCES "children"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Partial unique indexes for system configuration rows.
--
-- Prisma emits UNIQUE("kindergartenId", "code"), but Postgres treats NULLs as
-- distinct, so that constraint does NOT prevent two system rows (kindergartenId
-- IS NULL) sharing a code. Without the indexes below, running the seed twice
-- would silently create duplicate development domains and every screen that
-- resolves a domain by code would start picking one arbitrarily.
--
-- Prisma cannot express a partial index, so they are added by hand here.
-- docs/DATABASE.md §7.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "development_domains_system_code_key"
  ON "development_domains" ("code")
  WHERE "kindergartenId" IS NULL;

CREATE UNIQUE INDEX "assessment_levels_system_value_key"
  ON "assessment_levels" ("value")
  WHERE "kindergartenId" IS NULL;

CREATE UNIQUE INDEX "observation_types_system_code_key"
  ON "observation_types" ("code")
  WHERE "kindergartenId" IS NULL;

-- Only one school year per kindergarten may be current. Expressed as a partial
-- unique index because the constraint applies to `true` only.
CREATE UNIQUE INDEX "school_years_one_current_per_kindergarten"
  ON "school_years" ("kindergartenId")
  WHERE "isCurrent" = true;

-- A child may hold at most one ACTIVE enrollment per school year. Ended and
-- transferred rows are unconstrained — the history is the point.
CREATE UNIQUE INDEX "enrollments_one_active_per_child_year"
  ON "enrollments" ("childId", "schoolYearId")
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;
