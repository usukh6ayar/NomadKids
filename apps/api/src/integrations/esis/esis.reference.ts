import type { EsisReadableKey } from "./esis.service";

/**
 * `NATIONAL` — no `institutionId` is sent; the ministry's answer is the same
 * for every kindergarten in the country. `INSTITUTION` — scoped to this
 * deployment's one institution, 42778.
 */
export type EsisReferenceScope = "NATIONAL" | "INSTITUTION";

/**
 * `idField` names the field in the row that carries the ministry's own
 * identifier — usually one field. A handful of resources have no field that
 * is unique on its own; for those `idField` is a tuple and `externalIdFor`
 * joins the parts, documented per entry below.
 */
export interface EsisReferenceResource {
  resource: EsisReadableKey;
  scope: EsisReferenceScope;
  idField: string | readonly [string, string];
}

/**
 * ★ **The closed list of what a scheduled sweep may copy.**
 *
 * A resource on this list is fetched monthly whether or not anybody looks at
 * it — defensible for a catalogue, indefensible for a child's medical
 * record. So membership is a decision written down here, not a property a
 * resource acquires by being readable: `esis.reference.test.ts` asserts that
 * no reader whose path carries `:personId` ever ends up on this array, and
 * that assertion is the point of the file existing.
 *
 * ★★ **`foodKit` and `foodKitProducts` are deliberately absent**, though both
 * are `cook/*` and both are `institution: false` like their five siblings
 * below. Both carry `params: ["productId"]` (`esis.service.ts`) — a path
 * parameter, not a query filter — so "sweep this resource" has no meaning
 * without first choosing which products to sweep it for. Against a
 * thousand-row product catalogue that is one ministry call per product: a
 * per-row fan-out that would put *more* traffic in the ministry's log than
 * the live reads this tier exists to remove. They stay reachable on demand,
 * through `GET …/esis/resource`, triggered by an operator opening one
 * product — never by the schedule.
 *
 * ★★★ **A path parameter is the general signal**, not a rule specific to the
 * two food-kit services: it means the resource is a lookup keyed by something
 * an operator supplies, not a catalogue that exists independently of any one
 * request. `esis.reference.test.ts`'s "excludes every per-child service" case
 * is the sharpest instance of the same signal — `:personId` in the path — but
 * the check is general. Every reader considered for this list was checked
 * against its own `params` in `esis.service.ts` before being added; none of
 * the thirteen below carries one.
 *
 * ★★★★ **Every `idField` below was verified against a live response on
 * 2026-09-16** — 13 of 13 present on every row, and unique across the rows the
 * ministry returned:
 *
 * | resource | rows | resource | rows |
 * | --- | --- | --- | --- |
 * | `foodProductTypes` | 6 | `buildings` | 1 |
 * | `foodMaterialGroups` | 40 | `rooms` | 5 |
 * | `foodMaterials` | 294 | `programs` | 2 |
 * | `foodProducts` | 1000 | `subjectAreas` | 287 |
 * | `foodProductMaterials` | 1000 | `academicOrg` | 1 |
 * | `screeningQuestions` | 25 | `vaccineCatalog` | 26 |
 * | | | `academicYearStatuses` | 2 |
 *
 * That check matters more than it looks. Seven of these names came from the
 * portal's documentation rather than from an observed response, and a wrong
 * one fails **silently**: `externalIdFor` returns `null` for every row, the
 * sweep stores nothing, and the run finishes green with `stored: 0`. There is
 * no error to notice. `esis.reference.test.ts` cannot catch it either — it
 * checks the shape of this file, not what the ministry sends.
 *
 * Re-run the check after any change here. The script is a dozen lines: read
 * each resource once, map its rows through `externalIdFor`, count the nulls.
 */
export const REFERENCE_RESOURCES: readonly EsisReferenceResource[] = [
  // ── National — cook/* catalogues, `institution: false` ────────────────

  /*
   * idField derived from `ESIS_FIELDS.foodProductTypes[0]`
   * (esis.fields.ts:373, source PORTAL). The resource has only two fields —
   * `productType`, `productTypeName` — and `productType` ("Хоолны төрлийн
   * код") is the type's own code; there is no separate "…Id" field because
   * the row *is* the type.
   */
  { resource: "foodProductTypes", scope: "NATIONAL", idField: "productType" },

  // idField from `ESIS_FIELDS.foodMaterialGroups[0]` (esis.fields.ts:377, PORTAL).
  { resource: "foodMaterialGroups", scope: "NATIONAL", idField: "groupId" },

  // idField from `ESIS_FIELDS.foodMaterials[0]` (esis.fields.ts:384, PORTAL).
  { resource: "foodMaterials", scope: "NATIONAL", idField: "materialId" },

  // idField from `ESIS_FIELDS.foodProducts[0]` (esis.fields.ts:394, PORTAL).
  { resource: "foodProducts", scope: "NATIONAL", idField: "productId" },

  /*
   * idField from `ESIS_FIELDS.foodProductMaterials[0]` (esis.fields.ts:405,
   * PORTAL) — `productMaterialId`, the join row's own key, not `productId`
   * (the second field), which is a foreign key shared by every ingredient of
   * the same product.
   */
  { resource: "foodProductMaterials", scope: "NATIONAL", idField: "productMaterialId" },

  // idField from `ESIS_FIELDS.screeningQuestions[0]` (esis.fields.ts:952, LIVE).
  { resource: "screeningQuestions", scope: "NATIONAL", idField: "surveyNameId" },

  // ── Institution-scoped — this deployment's one institution ────────────

  // idField from `ESIS_FIELDS.buildings[0]` (esis.fields.ts:238, PORTAL).
  { resource: "buildings", scope: "INSTITUTION", idField: "buildingId" },

  /*
   * idField from `ESIS_FIELDS.rooms[0]` (esis.fields.ts:783, LIVE) —
   * `facilityId`, corrected 2026-09-14 from an invented `roomId` that was
   * never in a real response. See the doc comment above that catalogue entry.
   */
  { resource: "rooms", scope: "INSTITUTION", idField: "facilityId" },

  /*
   * idField from `ESIS_FIELDS.programs[1]` (esis.fields.ts:733, LIVE) —
   * `programOfStudyId`, not the first field (`institutionId`), which is the
   * same value on every row of this list and identifies nothing about the
   * row itself.
   */
  { resource: "programs", scope: "INSTITUTION", idField: "programOfStudyId" },

  // idField from `ESIS_FIELDS.subjectAreas[0]` (esis.fields.ts:823, LIVE).
  { resource: "subjectAreas", scope: "INSTITUTION", idField: "subjectAreaId" },

  /*
   * idField from `ESIS_FIELDS.academicOrg[1]` (esis.fields.ts:807, LIVE) —
   * `subjectDepartmentId`, corrected 2026-09-14 from an invented
   * `academicOrgId`; `institutionId` (the first field) is shared across the
   * list for the same reason it is skipped for `programs` above.
   */
  { resource: "academicOrg", scope: "INSTITUTION", idField: "subjectDepartmentId" },

  /*
   * ★ Hand-written — could not be derived from a single catalogue field.
   * `ESIS_FIELDS.vaccineCatalog` (esis.fields.ts:884, LIVE) has exactly two
   * fields, `VACCINE_NAME` and `VACCINE_DOSE`, and neither is unique alone: a
   * vaccine with several doses (БЦЖ, dose 1 / dose 2 / …) repeats
   * `VACCINE_NAME` once per dose. The pair together is what the ministry's
   * own response distinguishes one row by, so `externalIdFor` joins them
   * rather than inventing an id field that has never appeared in a response.
   */
  { resource: "vaccineCatalog", scope: "INSTITUTION", idField: ["VACCINE_NAME", "VACCINE_DOSE"] },

  /*
   * ★ Hand-written — `ESIS_FIELDS.academicYearStatuses` (esis.fields.ts:252,
   * PORTAL) has no field named with an "…Id" suffix. `academicYear` (the
   * first field, e.g. "2024-2025") is the natural key: one row exists per
   * academic year for this institution, so it is unique within the sweep
   * even though it is not an id in the ministry's naming convention.
   */
  { resource: "academicYearStatuses", scope: "INSTITUTION", idField: "academicYear" },
] as const;

function readPart(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/**
 * Reads the stable ministry id off one row of `resource`, or `null` when the
 * row does not carry it — so a row with no recognisable id is skipped by a
 * sweep rather than stored under the literal string `"undefined"`.
 *
 * `resource` need not be on `REFERENCE_RESOURCES`; an unlisted resource has
 * no known id field and always answers `null`.
 */
export function externalIdFor(resource: EsisReadableKey, row: unknown): string | null {
  const entry = REFERENCE_RESOURCES.find((candidate) => candidate.resource === resource);
  if (!entry || typeof row !== "object" || row === null) return null;

  const record = row as Record<string, unknown>;
  const fields = Array.isArray(entry.idField) ? entry.idField : [entry.idField];

  const parts: string[] = [];
  for (const field of fields) {
    const part = readPart(record, field);
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join("::");
}
