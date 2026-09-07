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
    cook: () => ["dashboard", "cook"] as const,
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
  /**
   * ★ Deliberately not nested under `health(childId)`.
   *
   * The reference list does not change when a child's records do, and nesting
   * it would make every save on the health tab invalidate the categories too —
   * refetching rows that were already correct.
   */
  specialNeedsCategories: (childId: string) =>
    ["child", childId, "special-needs-categories"] as const,
  incidents: (childId: string) => ["child", childId, "incidents"] as const,
  /** Ажилтны хувийн хэрэг — А/261 шалгуур 51. Keyed by both ids because a
   * person may work at two kindergartens and each keeps its own file. */
  staffRecords: (kindergartenId: string, userId: string) =>
    ["admin", "staff-records", kindergartenId, userId] as const,
  artwork: (childId: string) => ["child", childId, "artwork"] as const,
  consent: (childId: string) => ["child", childId, "consent"] as const,
  audit: (filters: Record<string, unknown> = {}) => ["admin", "audit", filters] as const,
  esis: (kindergartenId: string) => ["admin", "esis", kindergartenId] as const,
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
   * One group's month, for the register's own panel.
   *
   * ★ Shares the `["group", id, "attendance"]` prefix with the day sheet on
   * purpose: marking a child changes both, and invalidating the prefix after a
   * mutation refreshes the sheet and the month behind it in one call rather
   * than leaving the panel a minute stale on the screen that just changed it.
   */
  groupAttendanceSummary: (groupId: string, month: string) =>
    ["group", groupId, "attendance", "summary", month] as const,
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
  /** The attendance journal — child × day. Filters are part of the key. */
  attendanceJournal: (kindergartenId: string, filters: Record<string, unknown> = {}) =>
    ["attendance", "journal", kindergartenId, filters] as const,
  /** The director's register — group × day. A different grain, so a different key. */
  attendanceDaily: (kindergartenId: string, filters: Record<string, unknown> = {}) =>
    ["attendance", "daily", kindergartenId, filters] as const,
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

  /** The kitchen's menu, keyed by the fetched date range — a single day
   * (Өнөөдөр/Маргааш) and the Mon–Fri week share this key shape, and must
   * both appear in it: "today" can land on the same date a week view's
   * Monday does, and a `from`-only key would then serve one's cache to the
   * other. */
  weeklyMenu: (kindergartenId: string, from: string, to: string) =>
    ["menu", "week", kindergartenId, from, to] as const,

  /** Хоол үйлдвэрлэл — ingredients, technology cards, suppliers, food
   * orders, stock and reports. Its own namespace, one per sub-domain. */
  kitchen: {
    ingredients: (kindergartenId: string, filters: Record<string, unknown> = {}) =>
      ["kitchen", "ingredients", kindergartenId, filters] as const,
    recipes: (kindergartenId: string, filters: Record<string, unknown> = {}) =>
      ["kitchen", "recipes", kindergartenId, filters] as const,
    approvedRecipes: (kindergartenId: string) =>
      ["kitchen", "recipes", "approved", kindergartenId] as const,
    recipe: (recipeId: string) => ["kitchen", "recipe", recipeId] as const,
    suppliers: (kindergartenId: string, filters: Record<string, unknown> = {}) =>
      ["kitchen", "suppliers", kindergartenId, filters] as const,
    foodOrders: (kindergartenId: string, filters: Record<string, unknown> = {}) =>
      ["kitchen", "food-orders", kindergartenId, filters] as const,
    foodOrder: (orderId: string) => ["kitchen", "food-order", orderId] as const,
    stock: (kindergartenId: string) => ["kitchen", "stock", kindergartenId] as const,
    stockMovements: (kindergartenId: string, filters: Record<string, unknown> = {}) =>
      ["kitchen", "stock-movements", kindergartenId, filters] as const,
    reportConsumption: (kindergartenId: string, from: string, to: string) =>
      ["kitchen", "report", "consumption", kindergartenId, from, to] as const,
    reportNutrition: (kindergartenId: string, from: string, to: string) =>
      ["kitchen", "report", "nutrition", kindergartenId, from, to] as const,
    reportPurchases: (kindergartenId: string, from: string, to: string) =>
      ["kitchen", "report", "purchases", kindergartenId, from, to] as const,
    mealServings: (kindergartenId: string, date: string) =>
      ["kitchen", "meal-servings", kindergartenId, date] as const,
  },
  /** One kindergarten's own funding — not the platform's revenue. */
  kindergartenFunding: (kindergartenId: string, month: string) =>
    ["funding", kindergartenId, month] as const,
  fundingRules: (kindergartenId: string) => ["funding", "rules", kindergartenId] as const,
  /** нэмэлт.md §13 — the accountant's own door to the audit trail. */
  financialAuditLog: (kindergartenId: string, page: number) =>
    ["funding", "audit-log", kindergartenId, page] as const,
  /** Filters are part of the key so switching month/status does not reuse a page. */
  invoices: (kindergartenId: string, filters: Record<string, unknown>) =>
    ["invoices", kindergartenId, filters] as const,
  invoice: (invoiceId: string) => ["invoice", invoiceId] as const,
  /**
   * A guardian's own read of one child's invoices — `нэмэлт.md` §7, §10.
   *
   * ★ Prefixed `["child", childId, …]` deliberately, so that `qk.child(id)`
   * invalidates a family's bills along with everything else hanging off the
   * child. Paying one changes the child's finance tab, and a parent who has
   * just paid must not see "Төлөгдөөгүй" on the way back.
   */
  childInvoices: (childId: string, page: number) => ["child", childId, "invoices", page] as const,
  /** Whether this child's family owes the portal access fee — нэмэлт-free, client 2026-09-01. */
  childAccess: (childId: string) => ["child", childId, "access"] as const,
  /** The latest QPay attempt against that fee — polled while a QR is on screen. */
  accessQpay: (childId: string) => ["child", childId, "access", "qpay"] as const,

  /** The month's financial summary — `нэмэлт.md` §9. */
  financeDashboard: (kindergartenId: string, month: string) =>
    ["funding", kindergartenId, "dashboard", month] as const,
  /** One child's balance and funding history — `нэмэлт.md` §10. */
  childFinance: (childId: string) => ["child", childId, "finance"] as const,
  /** One of §16's reports. The period is part of the key — switching month refetches. */
  financeReport: (kindergartenId: string, report: string, period: string) =>
    ["funding", kindergartenId, "report", report, period] as const,
  /** One queued PDF job — polled while Chromium works. */
  financeReportJob: (jobId: string) => ["finance-report-job", jobId] as const,

  /**
   * ★ Filters are an optional trailing element, not always present like
   * `childObservations`'s — `["child", id, "media"]` has to stay a true
   * structural prefix of every filtered variant so the three call sites that
   * invalidate it with no filters (a delete, an upload, a profile-photo pick)
   * clear every one of the overview page's filtered galleries too, not just
   * the unfiltered one.
   */
  childMedia: (childId: string, filters?: Record<string, unknown>) =>
    filters && Object.keys(filters).length > 0
      ? (["child", childId, "media", filters] as const)
      : (["child", childId, "media"] as const),
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
