import { z } from "zod";

/**
 * A teacher signing up alone — «Багш» on the pricing page (#195; the user,
 * 2026-10-11). No ESIS code and no approval: the answer is a one-time
 * invitation token, and the web goes straight to `/invitation/[token]` to set
 * a password, as staff self-registration does. The workspace that comes with
 * it is a `Kindergarten` of kind SOLO_TEACHER: one group, parents only.
 */
export const teacherSignupSchema = z
  .object({
    /** «Овог нэр» in one field — split on the first space, family name first. */
    fullName: z.string().trim().min(2).max(120),
    phone: z
      .string()
      .trim()
      .regex(/^\d{8}$/, "Утасны дугаар 8 оронтой байна"),
    email: z.string().trim().email("И-мэйл хаяг буруу байна").max(200),
    propertyType: z.string().trim().max(40).optional(),
    location: z.string().trim().max(80).optional(),
    /** The kindergarten they work at — what the operator merges into later. */
    kindergartenName: z.string().trim().max(200).optional(),
  })
  .strict();
export type TeacherSignup = z.infer<typeof teacherSignupSchema>;

export const teacherSignupResultSchema = z.object({ invitationToken: z.string() });
export type TeacherSignupResult = z.infer<typeof teacherSignupResultSchema>;

/**
 * The operator's merge of a solo workspace into a contracted kindergarten (D3,
 * the user 2026-10-11). The preview runs the merge itself and rolls back, so
 * what it shows is what the merge does — or why it would stop.
 */
export const soloWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  location: z.string().nullable(),
  /** Where the teacher said they work — what to merge into. */
  workplace: z.string().nullable(),
  childCount: z.number().int(),
  createdAt: z.string(),
});
export type SoloWorkspace = z.infer<typeof soloWorkspaceSchema>;

export const soloMergeInputSchema = z
  .object({
    targetKindergartenId: z.string().uuid(),
    /** The group's name in the target, when its own is taken there. */
    groupName: z.string().trim().min(1).max(100).optional(),
    /**
     * D3b — merge into this existing group of the target's current year rather
     * than moving the teacher's group in beside it.
     */
    targetGroupId: z.string().uuid().optional(),
    /**
     * D3b — solo children the operator says are *not* the matched target
     * child: they move as children of their own instead of being attached.
     */
    keepSeparate: z.array(z.string().uuid()).max(500).optional(),
  })
  .strict();
export type SoloMergeInput = z.infer<typeof soloMergeInputSchema>;

export const soloMergeResultSchema = z.object({
  moved: z.record(z.string(), z.number()),
  membershipsMoved: z.number().int(),
  membershipsJoined: z.number().int(),
  adminsDropped: z.number().int(),
  groupsRenamed: z.array(z.object({ from: z.string(), to: z.string() })),
  /**
   * D3b — solo children attached to the target's own record of the same child
   * (one child, one record; the user 2026-10-11).
   */
  childrenAttached: z.array(
    z.object({ soloChildId: z.string(), targetChildId: z.string(), name: z.string() }),
  ),
  /**
   * Rows that could not join the target's record without breaking a rule
   * (a second profile, a second active enrollment…) — kept on the archived
   * solo record, never deleted. Per `table.column`.
   */
  kept: z.record(z.string(), z.number()),
  /** Whether the target group was an existing one (D3b) rather than the moved group. */
  intoExistingGroup: z.boolean(),
});
export type SoloMergeResult = z.infer<typeof soloMergeResultSchema>;

export const soloMergeRefusalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blocked"), tables: z.record(z.string(), z.number()) }),
  z.object({
    kind: z.literal("duplicates"),
    children: z.array(
      z.object({ soloChildId: z.string(), targetChildId: z.string(), name: z.string() }),
    ),
  }),
  /** A solo child matching more than one target child — the operator decides first. */
  z.object({
    kind: z.literal("ambiguous"),
    children: z.array(z.object({ soloChildId: z.string(), name: z.string() })),
  }),
  z.object({ kind: z.literal("badGroup") }),
  z.object({ kind: z.literal("conflict"), constraint: z.string() }),
  z.object({ kind: z.literal("noSchoolYear") }),
  z.object({ kind: z.literal("notMergeable") }),
]);
export type SoloMergeRefusal = z.infer<typeof soloMergeRefusalSchema>;

/** What the preview answers: the counts, or why the merge would stop. */
/** The target's groups of its current year — what «into an existing group» picks from (D3b). */
const targetGroupsSchema = z.array(z.object({ id: z.string(), name: z.string() }));

export const soloMergePreviewSchema = z.union([
  z.object({
    ok: z.literal(true),
    result: soloMergeResultSchema,
    targetGroups: targetGroupsSchema,
  }),
  z.object({
    ok: z.literal(false),
    refusal: soloMergeRefusalSchema,
    targetGroups: targetGroupsSchema,
  }),
]);
export type SoloMergePreview = z.infer<typeof soloMergePreviewSchema>;

/**
 * A kindergarten's name as people type it: no case, no «цэцэрлэг», no
 * punctuation or spaces — «Нарлаг», «нарлаг цэцэрлэг» and «Нарлаг-цэцэрлэг»
 * are one name. The web's look-alike warning and the server's refusal of a
 * solo sign-up for a contracted kindergarten (#211) read the same rule.
 */
export function normalizeKindergartenName(name: string): string {
  return name
    .toLocaleLowerCase("mn")
    .replace(/цэцэрлэг/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * «Баянзүрх дүүрэг» → «Баянзүрх». The sign-up form sends a district or
 * province with its kind; a kindergarten's own profile may hold the bare name,
 * or an address that contains it.
 */
export function locationStem(location: string): string {
  return location
    .trim()
    .replace(/\s+(дүүрэг|аймаг)$/u, "")
    .trim();
}

/**
 * `GET /public/kindergartens?location=…` — the contracted kindergartens of one
 * district, for staff sign-up (#211). Letters, spaces and hyphens only: the
 * value is matched as text and must carry no pattern characters.
 */
export const publicKindergartensQuerySchema = z.object({
  location: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[\p{L}\s-]+$/u),
});
export type PublicKindergartensQuery = z.infer<typeof publicKindergartensQuerySchema>;

export const publicKindergartenSchema = z.object({ id: z.string(), name: z.string() });
export type PublicKindergarten = z.infer<typeof publicKindergartenSchema>;
