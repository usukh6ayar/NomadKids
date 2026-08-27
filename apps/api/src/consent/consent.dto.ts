import { z } from "zod";

export const consentKindSchema = z.enum(["DATA_PROCESSING", "PHOTO_PUBLISHING"]);

export const recordConsentSchema = z
  .object({
    kind: consentKindSchema,
    granted: z.boolean(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type RecordConsentDto = z.infer<typeof recordConsentSchema>;
