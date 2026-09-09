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
/**
 * Every path value a readable service may be given, and how it is validated.
 *
 * ★ One object, and `esis.fields.test.ts` asserts it covers every name the
 * readers declare — because nothing else ties the two together and the failure
 * is silent. A reader that declares `personRegNumber` while this object does
 * not carry it drops the value at the pipe, and `read` then answers "Дараах
 * утга дутуу байна" about a parameter the caller did supply. That is exactly
 * what happened to `studentByRegister` and to both livelihood statements.
 */
export const ESIS_READ_PARAMS = {
  studentGroupId: z.string().trim().min(1).max(64).optional(),
  productId: z.string().trim().min(1).max(64).optional(),
  /**
   * A national identifier the operator types — sent, never stored.
   *
   * Shape-checked only: the ministry owns the format, and a stricter pattern
   * here would refuse a valid number rather than catch an invalid one.
   * `read()` keeps it out of the audit row — see its note.
   */
  personRegNumber: z.string().trim().min(1).max(32).optional(),
  academicYear: z
    .string()
    .trim()
    .regex(/^\d{4}$/)
    .optional(),
  academicMonth: z
    .string()
    .trim()
    .regex(/^(1[0-2]|[1-9])$/)
    .optional(),
  dayDate: z.iso.date().optional(),
  beginDate: z.iso.date().optional(),
} as const;

export const esisReadSchema = z.object({
  resource: z.enum(ESIS_READABLE_KEYS as [EsisReadableKey, ...EsisReadableKey[]]),
  params: z.object(ESIS_READ_PARAMS).optional(),
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
