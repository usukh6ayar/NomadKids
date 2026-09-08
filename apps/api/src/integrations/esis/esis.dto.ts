import { z } from "zod";
import { ESIS_PREVIEW_RESOURCES } from "./esis.catalog";
import { ESIS_READABLE_KEYS, type EsisReadableKey } from "./esis.service";

export const esisPreviewSchema = z.object({
  resources: z.array(z.enum(ESIS_PREVIEW_RESOURCES)).min(1).max(4),
});
export type EsisPreviewDto = z.infer<typeof esisPreviewSchema>;

/**
 * One read of one catalog service.
 *
 * ★ `params` names the four path values the catalog actually uses rather than
 * accepting an open record. A path value is interpolated into the ESIS URL, so
 * "whatever the client sent" is the wrong shape for it — even though
 * `esisPath` encodes every value, the narrower type is what stops a fifth
 * parameter from appearing without anyone deciding it should.
 */
export const esisReadSchema = z.object({
  resource: z.enum(ESIS_READABLE_KEYS as [EsisReadableKey, ...EsisReadableKey[]]),
  params: z
    .object({
      studentGroupId: z.string().trim().min(1).max(64).optional(),
      productId: z.string().trim().min(1).max(64).optional(),
      dayDate: z.iso.date().optional(),
      beginDate: z.iso.date().optional(),
    })
    .optional(),
});
export type EsisReadDto = z.infer<typeof esisReadSchema>;

export const updateEsisMappingSchema = z.discriminatedUnion("mapped", [
  z.object({ mapped: z.literal(false) }),
  z.object({
    mapped: z.literal(true),
    institutionId: z.string().trim().min(1).max(64),
    environment: z.enum(["TEST", "PRODUCTION"]),
  }),
]);
export type UpdateEsisMappingDto = z.infer<typeof updateEsisMappingSchema>;
