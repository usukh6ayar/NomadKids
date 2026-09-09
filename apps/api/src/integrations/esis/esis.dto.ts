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
  /*
   * ── Added 2026-09-10 ────────────────────────────────────────────────────
   * `personId` is an **ESIS** person id, not a national identifier: it is the
   * number the roster services already return and the one the суралцагч
   * services key on. Unlike `personRegNumber` it is safe to pre-fill and safe
   * in an audit row, so it is shape-checked the same way every other ESIS id
   * is rather than being given the register number's special handling.
   */
  personId: z.string().trim().min(1).max(64).optional(),
  programOfStudyId: z.string().trim().min(1).max(64).optional(),
  programStageId: z.string().trim().min(1).max(64).optional(),
  programPlanId: z.string().trim().min(1).max(64).optional(),
} as const;

export const esisReadSchema = z.object({
  resource: z.enum(ESIS_READABLE_KEYS as [EsisReadableKey, ...EsisReadableKey[]]),
  params: z.object(ESIS_READ_PARAMS).optional(),
});
export type EsisReadDto = z.infer<typeof esisReadSchema>;

/**
 * One write to ESIS.
 *
 * ★ **`institutionId` is deliberately not accepted from the caller.** Every
 * upload schema requires it, and the service fills it from the tenant's own
 * confirmed mapping — the same place `getList` gets it. Taking it from the
 * request body would let a signed-in teacher at one kindergarten write a
 * record into another institution's ESIS entry, which no role check on this
 * route could catch because the route's tenant is the one in the path.
 *
 * ★★ `payload` is loose here and strict one layer down: the three
 * `…UploadSchema`s in `esis.schemas.ts` are `.strict()`, so an invented key
 * fails before anything is sent. Validating twice with two different shapes is
 * how a field would drift; validating loosely here and strictly there is one
 * shape, checked where the payload is actually assembled.
 */
export const ESIS_WRITE_RESOURCES = [
  "studentContactsSave",
  "studentStatisticsSave",
  "studentConditionSave",
] as const;

export type EsisWriteResource = (typeof ESIS_WRITE_RESOURCES)[number];

export const esisWriteSchema = z.object({
  resource: z.enum(ESIS_WRITE_RESOURCES),
  payload: z.record(z.string(), z.unknown()),
});
export type EsisWriteDto = z.infer<typeof esisWriteSchema>;

export const updateEsisMappingSchema = z.discriminatedUnion("mapped", [
  z.object({ mapped: z.literal(false) }),
  z.object({
    mapped: z.literal(true),
    institutionId: z.string().trim().min(1).max(64),
    environment: z.enum(["TEST", "PRODUCTION"]),
  }),
]);
export type UpdateEsisMappingDto = z.infer<typeof updateEsisMappingSchema>;
