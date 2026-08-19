import { z } from "zod";

/**
 * Request schemas for the auth endpoints.
 *
 * Zod rather than class-validator, so the web app can import the same schemas
 * from packages/contracts for form validation and the two cannot drift into a
 * state where the form accepts what the API rejects.
 */

export const loginSchema = z.object({
  /** Username, email or phone — the user should not have to remember which. */
  identifier: z.string().min(1, "Нэвтрэх нэрээ оруулна уу").max(254),
  password: z.string().min(1, "Нууц үгээ оруулна уу").max(200),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const passwordResetRequestSchema = z.object({
  identifier: z.string().min(1).max(254),
});
export type PasswordResetRequestDto = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8, "Нууц үг дор хаяж 8 тэмдэгт байх ёстой").max(200),
});
export type PasswordResetConfirmDto = z.infer<typeof passwordResetConfirmSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, "Нууц үг дор хаяж 8 тэмдэгт байх ёстой").max(200),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
