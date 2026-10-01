import { z } from "zod";

/**
 * verify.mn phone verification — 2026-10-01.
 *
 * The person texts `code` from their phone to `shortcode`; the browser polls
 * `POST /phone-verifications/check` until the server has seen it arrive.
 * `handle` is the bearer the consuming flow sends back — password reset,
 * invitation acceptance or a profile save.
 */

/** `GET /phone-verifications/availability` — whether the deployment verifies phones at all. */
export const phoneVerificationAvailabilitySchema = z.object({ enabled: z.boolean() });

/** Every route that starts a verification answers this. */
export const phoneVerificationStartSchema = z.object({
  handle: z.string(),
  shortcode: z.string(),
  code: z.string(),
  /** `sms:144773?body=…` — opens the phone's SMS app with the message ready. */
  smsUri: z.string(),
  /** verify.mn's own Mongolian instruction, naming the number to send from. Shown verbatim. */
  displayInstruction: z.string(),
  expiresAt: z.string(),
});
export type PhoneVerificationStartResponse = z.infer<typeof phoneVerificationStartSchema>;

export const phoneVerificationStatusSchema = z.enum(["PENDING", "VERIFIED", "EXPIRED"]);
export type PhoneVerificationStatus = z.infer<typeof phoneVerificationStatusSchema>;

export const phoneVerificationCheckSchema = z.object({
  status: phoneVerificationStatusSchema,
  expiresAt: z.string(),
  /** Password reset only, and only once VERIFIED. */
  accountFound: z.boolean().optional(),
});
export type PhoneVerificationCheckResponse = z.infer<typeof phoneVerificationCheckSchema>;
