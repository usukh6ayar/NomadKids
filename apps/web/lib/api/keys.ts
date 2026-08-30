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

  enrollmentArchive: (childId: string) => ["child", childId, "enrollment-archive"] as const,

  attendance: (childId: string, month: string) => ["child", childId, "attendance", month] as const,
  attendanceSummary: (childId: string, month: string) =>
    ["child", childId, "attendance", "summary", month] as const,
  attendanceRequests: (childId: string) => ["child", childId, "attendance-requests"] as const,
  growth: (childId: string) => ["child", childId, "growth"] as const,
  milestones: (childId: string) => ["child", childId, "milestones"] as const,
  health: (childId: string) => ["child", childId, "health"] as const,
  incidents: (childId: string) => ["child", childId, "incidents"] as const,
  artwork: (childId: string) => ["child", childId, "artwork"] as const,
  consent: (childId: string) => ["child", childId, "consent"] as const,
  audit: (filters: Record<string, unknown> = {}) => ["admin", "audit", filters] as const,
  surveyComparison: (surveyId: string) => ["survey", surveyId, "comparison"] as const,
  configDomains: (kindergartenId: string) =>
    ["admin", "config", "domains", kindergartenId] as const,
  configLevels: (kindergartenId: string) => ["admin", "config", "levels", kindergartenId] as const,
  configTypes: (kindergartenId: string) => ["admin", "config", "types", kindergartenId] as const,
  documents: (kindergartenId: string, filters: Record<string, unknown> = {}) =>
    ["documents", kindergartenId, filters] as const,
  documentCategories: (kindergartenId: string) =>
    ["documents", kindergartenId, "categories"] as const,
  groupAttendance: (groupId: string, date: string) =>
    ["group", groupId, "attendance", date] as const,
  /**
   * One sitting of one group on one day — the meal register's unit of work.
   *
   * ★ `kind` is part of the key, not a filter applied after the fetch. The API
   * requires it on the query and answers with that sitting alone, so breakfast
   * and lunch are different responses; sharing a key would let a cached
   * breakfast sheet satisfy a request for lunch and show the wrong marks.
   */
  groupMeals: (groupId: string, date: string, kind: string) =>
    ["group", groupId, "meals", date, kind] as const,
  /**
   * The staff menu — dishes plus the allergy cross-check.
   *
   * ★ A different key from the plain menu `child-menu.tsx` reads, deliberately.
   * The two routes answer with different bodies for different audiences, and
   * sharing a key would let a parent's cached menu satisfy a teacher's query
   * for the warnings — or worse, the reverse.
   */
  menuWithWarnings: (kindergartenId: string, from: string, to: string) =>
    ["kindergarten", kindergartenId, "menu", "with-warnings", from, to] as const,
  attendanceReviewQueue: (filters: Record<string, unknown> = {}) =>
    ["attendance-requests", "review-queue", filters] as const,

  childSurveys: (childId: string) => ["child", childId, "surveys"] as const,
  kindergartenSurveys: (kindergartenId: string) =>
    ["kindergarten", kindergartenId, "surveys"] as const,
  survey: (surveyId: string) => ["survey", surveyId] as const,
  /** The group filter is part of the key: each cut is its own cached answer. */
  surveyResults: (surveyId: string, groupId = "") =>
    ["survey", surveyId, "results", groupId] as const,

  childAssessments: (childId: string, termId?: string) =>
    ["child", childId, "assessments", termId ?? "all"] as const,
  rosterSummary: (filters: Record<string, unknown>) => ["children", "summary", filters] as const,
  assessmentRadar: (childId: string, termId: string) =>
    ["child", childId, "assessment-radar", termId] as const,
  termReport: (childId: string, termId: string) =>
    ["child", childId, "term-report", termId] as const,
  groupAssessment: (groupId: string, termId: string, domainId: string) =>
    ["group", groupId, "assessment", termId, domainId] as const,

  /** The coverage dashboard. Keyed by window, so a new school year is a new entry. */
  groupObservationStats: (groupId: string, from: string, to: string) =>
    ["group", groupId, "observation-stats", from, to] as const,

  assessmentConfig: (kindergartenId: string) =>
    ["kindergarten", kindergartenId, "assessment-config"] as const,
  terms: (kindergartenId: string, schoolYearId?: string) =>
    ["kindergarten", kindergartenId, "terms", schoolYearId ?? "all"] as const,
  schoolYears: (kindergartenId: string) =>
    ["kindergarten", kindergartenId, "school-years"] as const,
  kindergartens: () => ["kindergartens"] as const,
  groups: (filters: Record<string, unknown> = {}) => ["groups", filters] as const,

  /**
   * The monthly attendance-and-funding register.
   *
   * ★ `["funding", "register", …]` in that order, so the whole namespace can be
   * invalidated with the prefix after a recalculation without naming the
   * filters the screen happened to have set.
   */
  fundingRegister: (kindergartenId: string, filters: Record<string, unknown> = {}) =>
    ["funding", "register", kindergartenId, filters] as const,

  notifications: (filters: Record<string, unknown> = {}) => ["notifications", filters] as const,
  notification: (id: string) => ["notifications", "detail", id] as const,
  unreadCount: () => ["notifications", "unread-count"] as const,

  /*
   * Chat. Its own namespace rather than hanging off `notifications`: the two
   * carry different unread counts and invalidating one must not clear the
   * other's cache.
   */
  chatRooms: () => ["chat", "rooms"] as const,
  chatMessages: (roomKey: string) => ["chat", "messages", roomKey] as const,
  chatUnread: () => ["chat", "unread-count"] as const,

  /*
   * The platform operator's money. Keyed by month because the screen switches
   * between them and each is a different answer — a single "revenue" key would
   * serve August's figures under September's heading for as long as it stayed
   * fresh.
   */
  platformRevenue: (month: string) => ["platform", "revenue", month] as const,
  platformDistribution: (month: string) => ["platform", "distribution", month] as const,
  platformPartners: () => ["platform", "partners"] as const,

  /** The kitchen's week, keyed by its Monday. */
  weeklyMenu: (kindergartenId: string, weekStart: string) =>
    ["menu", "week", kindergartenId, weekStart] as const,
  /** One kindergarten's own funding — not the platform's revenue. */
  kindergartenFunding: (kindergartenId: string, month: string) =>
    ["funding", kindergartenId, month] as const,
  fundingRules: (kindergartenId: string) => ["funding", "rules", kindergartenId] as const,

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
  platformKindergarten: (id: string) => ["platform", "kindergartens", "detail", id] as const,
  platformStats: () => ["platform", "stats"] as const,
} as const;
