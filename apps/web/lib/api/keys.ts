/**
 * Query keys.
 *
 * Every key in one file, built by a function rather than written inline. Two
 * reasons, both of which bite late:
 *
 *  - **Invalidation has to match exactly.** A mutation that invalidates
 *    `["children", id]` while the query registered `["child", id]` leaves stale
 *    data on screen with no error anywhere. Sharing the builder makes that
 *    impossible.
 *  - **Prefix invalidation is a design decision.** `qk.child(id)` is a prefix of
 *    `qk.childObservations(id, …)`, so invalidating the child refreshes
 *    everything hanging off it. That only works if the shapes are consistent,
 *    which is easy to see here and invisible when keys are scattered.
 */
export const qk = {
  session: () => ["session"] as const,

  dashboard: {
    primary: () => ["dashboard", "primary"] as const,
    teacher: () => ["dashboard", "teacher"] as const,
    parent: () => ["dashboard", "parent"] as const,
    admin: () => ["dashboard", "admin"] as const,
  },

  children: (filters: Record<string, unknown> = {}) => ["children", "list", filters] as const,
  myChildren: () => ["children", "mine"] as const,
  child: (childId: string) => ["child", childId] as const,

  childObservations: (childId: string, filters: Record<string, unknown> = {}) =>
    ["child", childId, "observations", filters] as const,
  observation: (childId: string, observationId: string) =>
    ["child", childId, "observations", "detail", observationId] as const,
  observationTypes: (childId: string) => ["child", childId, "observation-types"] as const,
  reviewQueue: (filters: Record<string, unknown> = {}) =>
    ["observations", "review-queue", filters] as const,

  portfolio: (childId: string) => ["child", childId, "portfolio"] as const,
  aboutMe: (childId: string) => ["child", childId, "about-me"] as const,
  ageProfiles: (childId: string) => ["child", childId, "age-profiles"] as const,
  birthdayNotes: (childId: string) => ["child", childId, "birthday-notes"] as const,

  attendance: (childId: string, month: string) => ["child", childId, "attendance", month] as const,
  attendanceSummary: (childId: string, month: string) =>
    ["child", childId, "attendance", "summary", month] as const,
  attendanceRequests: (childId: string) => ["child", childId, "attendance-requests"] as const,
  growth: (childId: string) => ["child", childId, "growth"] as const,
  groupAttendance: (groupId: string, date: string) =>
    ["group", groupId, "attendance", date] as const,
  attendanceReviewQueue: (filters: Record<string, unknown> = {}) =>
    ["attendance-requests", "review-queue", filters] as const,

  childSurveys: (childId: string) => ["child", childId, "surveys"] as const,
  kindergartenSurveys: (kindergartenId: string) =>
    ["kindergarten", kindergartenId, "surveys"] as const,
  survey: (surveyId: string) => ["survey", surveyId] as const,
  surveyResults: (surveyId: string) => ["survey", surveyId, "results"] as const,

  childAssessments: (childId: string, termId?: string) =>
    ["child", childId, "assessments", termId ?? "all"] as const,
  rosterSummary: (filters: Record<string, unknown>) => ["children", "summary", filters] as const,
  assessmentRadar: (childId: string, termId: string) =>
    ["child", childId, "assessment-radar", termId] as const,
  termReport: (childId: string, termId: string) =>
    ["child", childId, "term-report", termId] as const,
  groupAssessment: (groupId: string, termId: string, domainId: string) =>
    ["group", groupId, "assessment", termId, domainId] as const,

  assessmentConfig: (kindergartenId: string) =>
    ["kindergarten", kindergartenId, "assessment-config"] as const,
  terms: (kindergartenId: string, schoolYearId?: string) =>
    ["kindergarten", kindergartenId, "terms", schoolYearId ?? "all"] as const,
  schoolYears: (kindergartenId: string) =>
    ["kindergarten", kindergartenId, "school-years"] as const,
  kindergartens: () => ["kindergartens"] as const,
  groups: (filters: Record<string, unknown> = {}) => ["groups", filters] as const,

  notifications: (filters: Record<string, unknown> = {}) => ["notifications", filters] as const,
  notification: (id: string) => ["notifications", "detail", id] as const,
  unreadCount: () => ["notifications", "unread-count"] as const,

  childMedia: (childId: string) => ["child", childId, "media"] as const,
  childReports: (childId: string) => ["child", childId, "reports"] as const,
  report: (jobId: string) => ["report", jobId] as const,
  /** Admin lists. Filters are part of the key so a search does not reuse a page. */
  adminUsers: (filters: Record<string, string>) => ["admin", "users", filters] as const,
  adminGroups: () => ["admin", "groups"] as const,
  adminSchoolYears: (kindergartenId: string) => ["admin", "school-years", kindergartenId] as const,
  adminKindergarten: (kindergartenId: string) => ["admin", "kindergarten", kindergartenId] as const,
  adminTerms: (kindergartenId: string) => ["admin", "terms", kindergartenId] as const,

  profile: () => ["me", "profile"] as const,

  platformKindergartens: (filters: Record<string, unknown> = {}) =>
    ["platform", "kindergartens", filters] as const,
} as const;
