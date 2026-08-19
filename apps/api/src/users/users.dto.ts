import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";

export const roleSchema = z.enum(["ADMIN", "TEACHER", "PARENT"]);

/**
 * Mongolian mobile numbers: eight digits, first digit 5–9.
 *
 * Validated rather than accepted as free text because the phone is a login
 * identifier — a malformed one silently locks the user out of a route they were
 * told they could use.
 */
const phoneSchema = z
  .string()
  .regex(/^[5-9]\d{7}$/, "Утасны дугаар 8 оронтой байх ёстой")
  .nullable();

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3, "Нэвтрэх нэр дор хаяж 3 тэмдэгт байх ёстой")
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Нэвтрэх нэр латин үсэг, тоо, . _ - агуулна"),
  email: z.string().email().max(254).nullable().optional(),
  phone: phoneSchema.optional(),
  lastName: z.string().min(1, "Овгийг оруулна уу").max(100),
  firstName: z.string().min(1, "Нэрийг оруулна уу").max(100),
  role: roleSchema,
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  email: z.string().email().max(254).nullable().optional(),
  phone: phoneSchema.optional(),
  lastName: z.string().min(1).max(100).optional(),
  firstName: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export const updateProfileSchema = z.object({
  email: z.string().email().max(254).nullable().optional(),
  phone: phoneSchema.optional(),
  lastName: z.string().min(1).max(100).optional(),
  firstName: z.string().min(1).max(100).optional(),
  specialization: z.string().max(200).nullable().optional(),
  education: z.string().max(1000).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
});
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  kindergartenId: uuidSchema.optional(),
  role: roleSchema.optional(),
  isActive: z.coerce.boolean().optional(),
  q: z.string().max(100).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const addMembershipSchema = z.object({
  kindergartenId: uuidSchema,
  role: roleSchema,
});
export type AddMembershipDto = z.infer<typeof addMembershipSchema>;
