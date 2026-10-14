import { z } from "zod";
import { mobilePhoneSchema } from "../users/users.dto";

/** The opaque handle `start` returns: 32 random bytes, base64url. */
export const phoneVerificationHandleSchema = z.string().min(20).max(200);

export const startPhoneVerificationSchema = z.object({ phone: mobilePhoneSchema });
export type StartPhoneVerificationDto = z.infer<typeof startPhoneVerificationSchema>;

export const startInvitationPhoneVerificationSchema = z.object({
  token: z.string().min(10).max(200),
  /** Left out: the number the person gave when they registered themselves. */
  phone: mobilePhoneSchema.optional(),
});
export type StartInvitationPhoneVerificationDto = z.infer<
  typeof startInvitationPhoneVerificationSchema
>;

export const checkPhoneVerificationSchema = z.object({ handle: phoneVerificationHandleSchema });
export type CheckPhoneVerificationDto = z.infer<typeof checkPhoneVerificationSchema>;
