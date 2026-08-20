import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";

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

/**
 * Mongolian national id: two Cyrillic letters then eight digits.
 *
 * Optional throughout — a newly arrived child may not have one recorded yet,
 * and blocking registration on it would push staff into typing a placeholder.
 */
const nationalIdSchema = z
  .string()
  .regex(/^[А-ЯӨҮ]{2}\d{8}$/, "Регистрийн дугаар буруу байна (жишээ: УБ12345678)")
  .nullable();

/**
 * A birth date must be in the past and within a plausible range. The upper
 * bound catches a mistyped year (2062 instead of 2026) that would otherwise
 * make the child's age negative on every screen.
 */
const dateOfBirthSchema = z.coerce
  .date()
  .refine((d) => d < new Date(), { message: "Төрсөн огноо ирээдүйд байж болохгүй" })
  .refine((d) => d > new Date("2005-01-01"), { message: "Төрсөн огноо буруу байна" });

export const createChildSchema = z.object({
  lastName: z.string().min(1, "Овгийг оруулна уу").max(100),
  firstName: z.string().min(1, "Нэрийг оруулна уу").max(100),
  nationalId: nationalIdSchema.optional(),
  sex: sexSchema,
  dateOfBirth: dateOfBirthSchema,
  healthNotes: z.string().max(2000).nullable().optional(),
  /** Optional: a child may be registered before their group is decided. */
  groupId: uuidSchema.optional(),
});
export type CreateChildDto = z.infer<typeof createChildSchema>;

export const updateChildSchema = z.object({
  lastName: z.string().min(1).max(100).optional(),
  firstName: z.string().min(1).max(100).optional(),
  nationalId: nationalIdSchema.optional(),
  sex: sexSchema.optional(),
  dateOfBirth: dateOfBirthSchema.optional(),
  healthNotes: z.string().max(2000).nullable().optional(),
  status: childStatusSchema.optional(),
});
export type UpdateChildDto = z.infer<typeof updateChildSchema>;

export const listChildrenQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(100).optional(),
  status: childStatusSchema.optional(),
  groupId: uuidSchema.optional(),
  schoolYearId: uuidSchema.optional(),
});
export type ListChildrenQuery = z.infer<typeof listChildrenQuerySchema>;

export const addGuardianSchema = z.object({
  guardianUserId: uuidSchema,
  relation: guardianRelationSchema,
  isPrimary: z.boolean().default(false),
});
export type AddGuardianDto = z.infer<typeof addGuardianSchema>;

/**
 * Inviting a guardian who has no account yet.
 *
 * ★ No `guardianUserId`, unlike `addGuardianSchema` — that one links an account
 * that already exists, which is an administrator's job because it grants an
 * existing person access to a child. This creates a *new* account that nobody
 * can open until its invitation is accepted, which is a far smaller act and one
 * a teacher can be trusted with for a child in their own group.
 *
 * No password field. An adult who types a password for someone else knows that
 * password, and "temporary" credentials are permanent in practice.
 */
export const inviteGuardianSchema = z.object({
  username: z
    .string()
    .min(3, "Нэвтрэх нэр дор хаяж 3 тэмдэгт байх ёстой")
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Нэвтрэх нэр латин үсэг, тоо, . _ - агуулна"),
  email: z.email().max(254).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  lastName: z.string().min(1, "Овгийг оруулна уу").max(100),
  firstName: z.string().min(1, "Нэрийг оруулна уу").max(100),
  relation: guardianRelationSchema,
  isPrimary: z.boolean().default(false),
});
export type InviteGuardianDto = z.infer<typeof inviteGuardianSchema>;

export const updateGuardianshipSchema = z.object({
  relation: guardianRelationSchema.optional(),
  isPrimary: z.boolean().optional(),
  /** `false` revokes access while preserving the record of the relationship. */
  canView: z.boolean().optional(),
});
export type UpdateGuardianshipDto = z.infer<typeof updateGuardianshipSchema>;

export const enrollSchema = z.object({
  groupId: uuidSchema,
  startedOn: z.coerce.date().optional(),
});
export type EnrollDto = z.infer<typeof enrollSchema>;

export const endEnrollmentSchema = z.object({
  status: z.enum(["ENDED", "TRANSFERRED"]).default("ENDED"),
});
export type EndEnrollmentDto = z.infer<typeof endEnrollmentSchema>;
