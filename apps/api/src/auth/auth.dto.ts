import { z } from "zod";
import { guardianRelationSchema } from "@kinder/contracts";

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

/**
 * Accepting an invitation.
 *
 * The same shape as a password reset, and deliberately not merged with it: the
 * two look alike and mean different things. A reset recovers an account its
 * owner already had; this one is the first time anybody has been able to open
 * the account at all. Sharing a schema would invite sharing the endpoint, and
 * then an invitation token would be usable to reset an existing password.
 */
/**
 * ★ The guardian introduces themselves here, not the teacher at invite time.
 *
 * `firstName`, `phone` and `relation` used to be typed by a teacher into
 * `inviteGuardianSchema`. All three are facts about the person accepting, and
 * this is the moment they are present to state them — a father recorded as a
 * mother is the failure that motivated the change.
 *
 * **No surname.** The client was explicit — "эцэг эхийн овог хэрэггүй, зөвхөн
 * нэр нь байхад болно" — and it is right for a screen finished on a phone in a
 * corridor.
 *
 * ★★ All three are **optional**, and that is not laxity — this endpoint serves
 * two invitations.
 *
 * A guardian's account is a placeholder created by a teacher pressing one
 * button: no name, no phone, no relationship, so the acceptance form must
 * collect them and the web form marks all three required.
 *
 * A **director's** account is not. `POST /platform/kindergartens` registers a
 * kindergarten *and* its administrator, with the name the platform operator
 * typed — that account arrives complete, and its acceptance form asks only for
 * a password. Requiring a name here would have made every director invitation
 * fail with a 400, which is exactly what `platform.test.ts` caught.
 *
 * The rule the server enforces is the honest one: if these are sent they are
 * written, and a field that is absent leaves what is already there alone.
 */
export const invitationAcceptSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8, "Нууц үг дор хаяж 8 тэмдэгт байх ёстой").max(200),
  firstName: z.string().trim().min(1, "Нэрээ оруулна уу").max(100).optional(),
  phone: z.string().trim().min(6, "Утасны дугаараа оруулна уу").max(32).optional(),
  relation: guardianRelationSchema.optional(),
  /*
   * ★ Staff-shaped invitations, added 2026-09-04.
   *
   * A guardian gives a given name only — the client asked for that explicitly
   * ("эцэг эхийн овог хэрэггүй"). A member of staff needs a surname, because
   * a register and an audit row name them in full, and an e-mail, because it
   * is what they will log in with: `findByIdentifier` accepts username, e-mail
   * or phone, and an operator invited this way has a generated username they
   * never see.
   *
   * Optional here rather than in a second schema: the endpoint is one route
   * that writes only what it was given (`completeInvitedProfile`), and a
   * `.strict()` schema that refused these would make the guardian and staff
   * paths two endpoints with one purpose.
   */
  lastName: z.string().trim().min(1, "Овгоо оруулна уу").max(100).optional(),
  email: z.string().trim().email("И-мэйл хаяг буруу байна").max(200).optional(),
});
export type InvitationAcceptDto = z.infer<typeof invitationAcceptSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, "Нууц үг дор хаяж 8 тэмдэгт байх ёстой").max(200),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
