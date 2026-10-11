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
  })
  .strict();
export type SoloMergeInput = z.infer<typeof soloMergeInputSchema>;

export const soloMergeResultSchema = z.object({
  moved: z.record(z.string(), z.number()),
  membershipsMoved: z.number().int(),
  membershipsJoined: z.number().int(),
  adminsDropped: z.number().int(),
  groupsRenamed: z.array(z.object({ from: z.string(), to: z.string() })),
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
  z.object({ kind: z.literal("conflict"), constraint: z.string() }),
  z.object({ kind: z.literal("noSchoolYear") }),
  z.object({ kind: z.literal("notMergeable") }),
]);
export type SoloMergeRefusal = z.infer<typeof soloMergeRefusalSchema>;

/** What the preview answers: the counts, or why the merge would stop. */
export const soloMergePreviewSchema = z.union([
  z.object({ ok: z.literal(true), result: soloMergeResultSchema }),
  z.object({ ok: z.literal(false), refusal: soloMergeRefusalSchema }),
]);
export type SoloMergePreview = z.infer<typeof soloMergePreviewSchema>;
