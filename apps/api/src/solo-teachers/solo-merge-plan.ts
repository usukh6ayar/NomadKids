/**
 * What the operator's merge (D3) does with every table that points at a
 * kindergarten — decided here, table by table, and pinned by
 * `test/solo-merge-plan.test.ts`, which reads every foreign key into
 * `kindergartens` from `pg_constraint` and fails on one this file does not
 * name. A table added later cannot be forgotten by the merge.
 *
 * - **MOVE** — the teacher's own work and the families': re-parented to the
 *   target kindergarten as it is.
 * - **BLOCK** — a kindergarten's configuration, money, kitchen and staff. A
 *   solo workspace has no use for them; if it holds any rows anyway, moving
 *   them would add to the target's configuration without its director's
 *   say, and leaving them would strand the rows that refer to them. So the
 *   merge refuses and the preview names the table.
 * - **KEEP** — stays with the archived solo row: the append-only audit log
 *   (history stays where it happened), onboarding, and ESIS, which is the
 *   target's own.
 * - **SPECIAL** — handled by name in `SoloMergeRepository`: memberships
 *   (ADMIN dropped, the rest moved or joined) and school years (the target
 *   keeps its one current year; references are re-pointed to it).
 */
export type MergeClass = "MOVE" | "BLOCK" | "KEEP" | "SPECIAL";

export const SPECIAL_TABLES = ["memberships", "school_years"] as const;

// `contract_payments` (№6) and `contract_acceptances` (2026-10-18) go with
// `contracts`: a solo workspace has no contract, so it has neither to move.
const KEEP = new Set([
  "audit_logs",
  "contracts",
  "contract_payments",
  "contract_acceptances",
  "kindergarten_applications",
]);

const BLOCK = new Set([
  // Configuration a director owns.
  "album_categories",
  "assessment_levels",
  "calendar_days",
  "curriculum_indicators",
  "development_domains",
  "observation_types",
  "special_needs_categories",
  "terms",
  "term_reports",
  "term_report_observations",
  "method_unions",
  "method_union_members",
  // Money.
  "funding_calculations",
  "funding_rules",
  "invoices",
  "payments",
  // The kitchen.
  "food_orders",
  "ingredients",
  "meal_servings",
  "menu_days",
  "recipes",
  "stock_movements",
  "suppliers",
  // Staff.
  "staff_records",
  // A PE/music teacher's groups (2026-10-15). Only a director assigns them and
  // a solo workspace has none, so a row here is something nobody meant.
  "group_specialists",
]);

export function classify(table: string): MergeClass | null {
  if ((SPECIAL_TABLES as readonly string[]).includes(table)) return "SPECIAL";
  if (KEEP.has(table) || table.startsWith("esis_")) return "KEEP";
  if (BLOCK.has(table)) return "BLOCK";
  return MOVE.has(table) ? "MOVE" : null;
}

const MOVE = new Set([
  "access_subscriptions",
  "allergy_records",
  "artwork_comparisons",
  "assessments",
  "attendance_esis_attempts",
  "attendance_records",
  "attendance_requests",
  "attendance_submissions",
  "birthday_notes",
  "chat_messages",
  "chat_reads",
  "child_age_profiles",
  "child_meal_notes",
  "child_profiles",
  "children",
  "club_requests",
  "clubs",
  "consent_records",
  "document_bookmarks",
  "documents",
  "enrollments",
  "feedback",
  "group_routines",
  "group_teachers",
  "groups",
  "growth_measurements",
  "guardianships",
  "meal_records",
  "media_files",
  "medication_authorisations",
  "milestones",
  "notification_reactions",
  "notification_targets",
  "notifications",
  "observation_a79_links",
  "observation_domains",
  "observations",
  "qpay_invoices",
  "report_jobs",
  "safety_incidents",
  "song_poem_months",
  "song_poems",
  "special_need_records",
  "survey_answer_drafts",
  "survey_answers",
  // «Гарааны үнэлгээ»'s children per level (#285) — moves with its survey.
  "survey_children",
  "survey_questions",
  "survey_responses",
  "survey_staff_reads",
  "surveys",
  "vaccination_records",
]);
