import { z } from "zod";
import { ESIS_PREVIEW_RESOURCES } from "./esis.catalog";
import { ESIS_READABLE_KEYS, type EsisReadableKey } from "./esis.service";
import { ESIS_WRITE_SERVICES } from "./esis-group-writes";

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
  /*
   * ── Added 2026-09-14 ────────────────────────────────────────────────────
   *
   * ★ A worker's register number, for `workerInfo` (api 49). It is the same
   * kind of value as `personRegNumber` above and gets the same treatment: an
   * operator types it from the document in front of them, it is sent and never
   * stored, and `read()` keeps it out of the audit row.
   *
   * ★★ It is a **separate** key rather than a reuse of `personRegNumber`
   * because the two name different people — one a child, one a member of
   * staff — and the audit redaction has to be able to tell them apart if it is
   * ever narrowed. Shape-checked only, for the reason given above: the
   * ministry owns the format, and Mongolian register numbers start with two
   * Cyrillic letters, so anything tighter would refuse valid input.
   */
  primaryNidNumber: z.string().trim().min(1).max(32).optional(),
  /*
   * ── Added 2026-09-17, plan `2026-09-16-esis-sync-tiers.md` Task 9 ───────
   *
   * ★ A civil registry id, for `studentSearch` (api …784). The same treatment
   * as `personRegNumber`: an operator types it from a document already in
   * front of them, it travels to ESIS and nowhere else, and `read()` keeps it
   * out of the audit row (`REDACTED_READ_PARAMS`).
   */
  civilId: z.string().trim().min(1).max(32).optional(),
  /**
   * The kindergarten's own government register number, for
   * `buildingByRegisterNumber` (api 186). An organisation's identifier
   * rather than a person's, but shape-checked and redacted the same way —
   * see `REDACTED_READ_PARAMS`'s note on why.
   */
  registerNumber: z.string().trim().min(1).max(32).optional(),
  /*
   * ── Added 2026-09-22 ────────────────────────────────────────────────────
   *
   * ★ A мэргэшлийн зэрэг request number, for `degreeDecisions` (167) and
   * `degreeHistory` (170). An ESIS id rather than anybody's identifier — it
   * names a *request*, not a person — so it takes the ordinary id treatment
   * like `personId` above and is **not** added to `REDACTED_READ_PARAMS`: an
   * audit row saying which request was read is the useful half of the record.
   *
   * ★★ Shape-checked only. The ministry owns the format and nothing here has
   * ever seen a real one: 119, the service that turns a register number into a
   * request number, answers `403` on the live gateway. A pattern guessed from
   * the service's name would refuse valid input the first time a real number
   * arrives, which is the failure this file already avoids twice above.
   */
  requestId: z.string().trim().min(1).max(64).optional(),
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
  /*
   * ── Added 2026-09-15 ────────────────────────────────────────────────────
   *
   * ★ Adding a service to `ESIS_ENDPOINTS` and giving `EsisService` a `save…`
   * method does **not** make it reachable. This list is what `POST
   * …/esis/write` accepts, and the ten below were wired everywhere else first
   * and stayed unreachable until they were named here — the route rejected
   * them at schema validation with no hint that the method existed.
   *
   * ★★ `studentAttachmentSave` is deliberately **absent**. It is in the
   * catalogue so the grant is visible and it has no method on `EsisService`
   * either: sending a child's medical document to a third party is a consent
   * decision, not a route. See the endpoint's note and CLAUDE.md §1.4.
   */
  "studentAllergySave",
  "studentProhibitedFoodSave",
  "studentDisabilitySave",
  "studentAssessmentsSave",
  "studentMeasurementSave",
  "studentSurgerySave",
  "studentIncidentSave",
  "groupMeasurementsSave",
  "studentScreeningSave",
] as const;

export type EsisWriteResource = (typeof ESIS_WRITE_RESOURCES)[number];

/**
 * The writes whose field names have never been confirmed by anything.
 *
 * ★ Six of the thirteen. Their **read** halves answered `203` for every child
 * on institution 42778, so no live row exists to compare against; the developer
 * portal renders none of them; and the probe cannot reach their validation —
 * each answers `institutionId дутуу байна`, then `NJS-105: value is not a
 * number (NaN)`, an Oracle driver error from the missing `personId` rather than
 * a list of what it wanted (`scripts/esis-write-probe.ts`, 2026-09-18).
 *
 * ★★ So their field lists are **inference with nothing behind it** — which is
 * exactly what 162's were until the client produced the ministry's own page
 * and three of its five fields turned out to be wrong, including the verb. The
 * difference is the subject: 162 describes a group, these describe a child's
 * allergies, disability, surgery and safety incidents.
 *
 * ★★★ Refused at the route rather than noted in a comment, because a comment
 * stopped nothing last time. Everything else about them stays wired — the
 * catalogue shows the grant, the panel shows the fields, the method exists —
 * so confirming one is an edit to this list and nothing else.
 */
export const ESIS_UNPROVEN_WRITES = [
  "studentAllergySave",
  "studentProhibitedFoodSave",
  "studentDisabilitySave",
  "studentSurgerySave",
  "studentIncidentSave",
  "studentScreeningSave",
] as const satisfies readonly EsisWriteResource[];

export const esisWriteSchema = z.object({
  resource: z.enum(ESIS_WRITE_RESOURCES),
  payload: z.record(z.string(), z.unknown()),
});
export type EsisWriteDto = z.infer<typeof esisWriteSchema>;

/**
 * `POST …/esis/sync`'s body — which tier to pull, nothing else.
 *
 * ★ An unknown tier is rejected here, by the `ZodValidationPipe`, before the
 * controller method runs at all — so a typo never reaches the run lock, never
 * calls ESIS and never writes an `EsisSyncRun` row. See `EsisSyncService.sync`
 * for why `REFERENCE` and `ROSTER` are the only two values: they are the two
 * tiers Tasks 3 and 4 built, and tier 3 (per-child) is deliberately never
 * scheduled or manually swept (plan §"What this plan does not do").
 */
export const esisSyncTierSchema = z.object({
  tier: z.enum(["REFERENCE", "ROSTER"]),
});
export type EsisSyncTierDto = z.infer<typeof esisSyncTierSchema>;

export const updateEsisMappingSchema = z.discriminatedUnion("mapped", [
  z.object({ mapped: z.literal(false) }),
  z.object({
    mapped: z.literal(true),
    institutionId: z.string().trim().min(1).max(64),
  }),
]);
export type UpdateEsisMappingDto = z.infer<typeof updateEsisMappingSchema>;

/**
 * `POST …/esis/group-writes` — which write, about which group. Spec №3б.
 *
 * ★ **No `payload` field.** The caller names a service and a subject; the body
 * is built from our own `Group` by `esis-group-writes.ts`. A payload field
 * here would be the pass-through model this design rejected, and would let a
 * browser post whatever it liked into the ministry's production register.
 *
 * ★★ `confirmGroupName` is required for `groupDelete` only, and the service
 * rather than this schema enforces that — the refusal is one a director reads
 * ("бүлгийн нэрийг яг бичнэ үү"), not a 422 about a missing field.
 */
export const prepareEsisGroupWriteSchema = z.object({
  service: z.enum(ESIS_WRITE_SERVICES),
  groupId: z.uuid(),
  confirmGroupName: z.string().min(1).optional(),
});
export type PrepareEsisGroupWriteDto = z.infer<typeof prepareEsisGroupWriteSchema>;

/**
 * `GET platform/esis/institutions/:institutionId` — the ministry's own id.
 *
 * ★ Not `idParamSchema`, which is a uuid. This value is the ministry's, not
 * ours: 42778 on the granted institution. The bounds mirror
 * `updateEsisMappingSchema.institutionId`, the other place a caller supplies
 * one, rather than pinning a digits-only shape this product has no authority
 * over.
 */
export const esisInstitutionParamSchema = z.object({
  institutionId: z.string().trim().min(1).max(64),
});
export type EsisInstitutionParams = z.infer<typeof esisInstitutionParamSchema>;

/** `:id` is the kindergarten, `:writeId` the request being approved or cancelled. */
export const esisWriteParamSchema = z.object({
  id: z.uuid(),
  writeId: z.uuid(),
});
export type EsisWriteParams = z.infer<typeof esisWriteParamSchema>;

/**
 * `GET …/esis/coverage` — how far back to count.
 *
 * ★ One month by default, because that is the trial's own unit and the window
 * the ministry asked about. Capped at twelve: a wider one would read the whole
 * audit table for a question nobody asked.
 */
export const esisCoverageQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(12).default(1),
});
export type EsisCoverageQuery = z.infer<typeof esisCoverageQuerySchema>;

/**
 * `POST …/esis/staff-link` — attach an ESIS person to an existing account.
 *
 * ★ `esisPersonId` is a digit string, not a number. Every ESIS identifier in
 * this product is: `personId` values run to fifteen digits
 * (`90000003401632`), which is past what a JSON number round-trips exactly,
 * and the ministry sends them as strings. Parsing one into a number here is
 * how a link silently attaches the wrong person.
 */
export const linkEsisStaffSchema = z.object({
  userId: z.string().uuid(),
  esisPersonId: z
    .string()
    .trim()
    .min(1)
    .regex(/^\d+$/, "ЭСИС-ийн хүний дугаар зөвхөн тооноос бүрдэнэ."),
});
export type LinkEsisStaffDto = z.infer<typeof linkEsisStaffSchema>;
