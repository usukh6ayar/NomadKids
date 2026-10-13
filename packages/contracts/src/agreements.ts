import { z } from "zod";
import { paginationQuerySchema } from "./pagination";

/**
 * The user agreements a teacher and a guardian accept on first sign-in (#211,
 * the user 2026-10-12).
 *
 * ★ The version each kind is at now. The web shows the text
 * (`apps/web/lib/agreements.ts`); the server accepts an acceptance of **this**
 * version only, so a record cannot claim a version nobody was shown. When the
 * client's drafted contracts replace the trial text, both the text and this
 * value change in one commit — and everyone is asked again.
 */
export const CURRENT_AGREEMENT_VERSIONS = {
  TEACHER: "trial-2026-10-12",
  PARENT: "trial-2026-10-12",
} as const;

export const agreementKindSchema = z.enum(["TEACHER", "PARENT"]);
export type AgreementKindValue = z.infer<typeof agreementKindSchema>;

export const acceptAgreementSchema = z
  .object({ kind: agreementKindSchema, version: z.string().trim().min(1).max(64) })
  .strict();
export type AcceptAgreement = z.infer<typeof acceptAgreementSchema>;

export const acceptedAgreementsSchema = z.object({
  accepted: z.array(
    z.object({ kind: agreementKindSchema, version: z.string(), acceptedAt: z.string() }),
  ),
});

/** The operator's list of who accepted which version, and when. */
export const listAgreementAcceptancesQuerySchema = paginationQuerySchema.extend({
  kind: agreementKindSchema.optional(),
  version: z.string().trim().max(64).optional(),
});
export type ListAgreementAcceptancesQuery = z.infer<typeof listAgreementAcceptancesQuerySchema>;
