import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";
import { searchTermSchema } from "../common/repository/search";

export const roleSchema = z.enum(["ADMIN", "TEACHER", "PARENT", "COOK", "ACCOUNTANT"]);

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
  q: searchTermSchema,
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const addMembershipSchema = z.object({
  kindergartenId: uuidSchema,
  role: roleSchema,
});
export type AddMembershipDto = z.infer<typeof addMembershipSchema>;

/**
 * Moving a member of staff from one role to another — "албан тушаал солих",
 * requested 2026-09-04.
 *
 * ★ One request, not a revoke followed by a grant.
 *
 * Those two endpoints already existed and a client could have called them in
 * order, which is exactly the problem: between them the person holds no role
 * at all, and a failure on the second leaves a teacher who has been demoted to
 * nothing. `Membership` is also `@@unique([userId, kindergartenId, role])`, so
 * the target row may already exist in a revoked state — a naive "update the
 * role column" would collide with a membership somebody deactivated last year.
 * The service resolves both inside one transaction.
 *
 * ★★ No `kindergartenId`: the membership names it, and taking one from the
 * caller would let a request name a different kindergarten from the row it is
 * about. The service reads it off the record it just authorized.
 */
export const changeMembershipRoleSchema = z.object({ role: roleSchema });
export type ChangeMembershipRoleDto = z.infer<typeof changeMembershipRoleSchema>;
