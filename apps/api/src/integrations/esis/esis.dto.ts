import { z } from "zod";
import { ESIS_PREVIEW_RESOURCES } from "./esis.catalog";

export const esisPreviewSchema = z.object({
  resources: z.array(z.enum(ESIS_PREVIEW_RESOURCES)).min(1).max(4),
});
export type EsisPreviewDto = z.infer<typeof esisPreviewSchema>;

export const updateEsisMappingSchema = z.discriminatedUnion("mapped", [
  z.object({ mapped: z.literal(false) }),
  z.object({
    mapped: z.literal(true),
    institutionId: z.string().trim().min(1).max(64),
    environment: z.enum(["TEST", "PRODUCTION"]),
  }),
]);
export type UpdateEsisMappingDto = z.infer<typeof updateEsisMappingSchema>;
