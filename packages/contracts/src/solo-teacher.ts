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
