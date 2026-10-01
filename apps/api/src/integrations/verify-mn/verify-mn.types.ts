import { z } from "zod";

/**
 * Response shapes for verify.mn's session API.
 *
 * ★ Taken from the reference on https://verify.mn/ (the page's own
 * "AI code agent" section, which is the most literal description it gives),
 * 2026-10-01. Not yet exercised against the live service — no key existed when
 * this was written. `docs/reference/VERIFY_MN_INTEGRATION.md` records what is
 * assumed.
 *
 * Same discipline as `qpay.types.ts`: `.passthrough()`, and only the fields
 * this codebase reads are required. A renamed field fails here, loudly, as a
 * `VerifyMnError("invalid_response")` — not three layers in as a phone that
 * silently never verifies.
 */

export const verifyMnCreateSessionResponseSchema = z
  .object({
    sessionId: z.string().min(1),
    shortcode: z.string().min(1),
    text: z.string().min(1),
    /** `sms:144773?body=482916` — the tap-to-send link. */
    smsUri: z.string().min(1),
    /**
     * Mongolian, and it names the number the SMS must come from. Shown
     * verbatim: sending from the wrong SIM is the commonest failure.
     */
    displayInstruction: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .passthrough();
export type VerifyMnCreateSessionResponse = z.infer<typeof verifyMnCreateSessionResponseSchema>;

export const verifyMnSessionStatusSchema = z.enum(["PENDING", "VERIFIED", "EXPIRED"]);
export type VerifyMnSessionStatus = z.infer<typeof verifyMnSessionStatusSchema>;

export const verifyMnSessionResponseSchema = z
  .object({
    sessionId: z.string(),
    sessionStatus: verifyMnSessionStatusSchema,
  })
  .passthrough();
export type VerifyMnSessionResponse = z.infer<typeof verifyMnSessionResponseSchema>;

export type VerifyMnErrorKind =
  /** No key — no call was attempted. */
  | "not_configured"
  /** The request never completed: DNS, TLS, connection reset. */
  | "network"
  | "timeout"
  /** verify.mn answered with a non-2xx status. */
  | "http"
  /** A 2xx whose body is not the shape above. */
  | "invalid_response";
