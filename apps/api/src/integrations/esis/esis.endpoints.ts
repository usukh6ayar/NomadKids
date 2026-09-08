/**
 * ESIS v2 services used by NomadKids.
 *
 * Source: https://developerv2.esis.edu.mn/api/structure, reviewed 2026-09-08.
 * Keep the API id beside the path: access is granted per service in the ESIS
 * developer portal, so an operator needs both when requesting or auditing a
 * token's scope.
 */
export interface EsisEndpoint {
  /**
   * The portal's own id for the service, or `null` when it is not yet read.
   *
   * ★ Nullable because one service reached us from the client rather than from
   * the catalog page, which truncates before the суралцагч block. Access is
   * granted per id, so writing a plausible number here would send the ministry
   * a scope request for whichever service actually holds it. A null renders as
   * "тодруулах" and stays visibly unfinished until somebody reads it off the
   * portal.
   */
  apiId: number | null;
  slug: string;
  method: "GET" | "POST";
  path: string;
}

const endpoint = <T extends EsisEndpoint>(value: T): T => value;

export const ESIS_ENDPOINTS = {
  organization: endpoint({
    apiId: 59,
    slug: "API-000158",
    method: "GET",
    path: "/svc/api/hub/v2/organization/info",
  }),
  academicYearStatuses: endpoint({
    apiId: 61,
    slug: "API-000160",
    method: "GET",
    path: "/svc/api/hub/v2/academic/year/statuses",
  }),
  groups: endpoint({
    apiId: 100004874669811,
    slug: "api-40",
    method: "GET",
    path: "/svc/api/hub/v2/group/list",
  }),
  students: endpoint({
    apiId: 100004874669777,
    slug: "api-8",
    method: "GET",
    path: "/svc/api/hub/v2/students/list",
  }),
  /**
   * One child, found by the register number the operator types.
   *
   * ★ **This does not weaken `ESIS_REQUEST.md` §1.1 (b).** That paragraph
   * refuses to *receive and keep* register numbers: `personRegNumber` is a
   * refused output on every roster service and is stored nowhere. Here the
   * number travels the other way — the director already has the child's
   * registration document in front of them and types it in to find the ESIS
   * record. We send it, we never save it, and the record that comes back is
   * minimised by the same field list as `students`.
   *
   * ★★ `apiId` is unknown. The endpoint came from the client (2026-09-08) and
   * the public catalog page truncates before the суралцагч services, so the
   * portal id has to be read off the portal before this appears in a token
   * scope request. Guessing it would request the wrong service.
   */
  studentByRegister: endpoint({
    apiId: null,
    slug: "student/:personRegNumber",
    method: "GET",
    path: "/svc/api/hub/v2/student/:personRegNumber",
  }),
  groupStudents: endpoint({
    apiId: 100004874669783,
    slug: "api-13",
    method: "GET",
    path: "/svc/api/hub/v2/group/student/list/:studentGroupId",
  }),
  studentMovements: endpoint({
    apiId: 100004874669778,
    slug: "2",
    method: "GET",
    path: "/svc/api/hub/v2/student/movement/v2/:beginDate",
  }),
  teachers: endpoint({
    apiId: 100004874669812,
    slug: "api-41",
    method: "GET",
    path: "/svc/api/hub/v2/teacher/list",
  }),
  staff: endpoint({
    apiId: 55,
    slug: "API-000154",
    method: "GET",
    path: "/svc/api/hub/v2/school/staff",
  }),
  groupAttendance: endpoint({
    apiId: 100004874669792,
    slug: "api-22",
    method: "GET",
    path: "/svc/api/hub/v2/group/list/attendance/:studentGroupId/:dayDate",
  }),
  saveAttendanceV3: endpoint({
    apiId: 171,
    slug: "API-000269",
    method: "POST",
    path: "/svc/api/hub/v2/group/school/attendance/save/v3",
  }),
  foodProductTypes: endpoint({
    apiId: 111,
    slug: "API-000210",
    method: "GET",
    path: "/svc/api/hub/v2/cook/product/type",
  }),
  foodMaterialGroups: endpoint({
    apiId: 112,
    slug: "API-000211",
    method: "GET",
    path: "/svc/api/hub/v2/cook/materialGroup",
  }),
  foodMaterials: endpoint({
    apiId: 123,
    slug: "API-000222",
    method: "GET",
    path: "/svc/api/hub/v2/cook/material",
  }),
  foodProducts: endpoint({
    apiId: 124,
    slug: "API-000223",
    method: "GET",
    path: "/svc/api/hub/v2/cook/product",
  }),
  foodProductMaterials: endpoint({
    apiId: 125,
    slug: "API-000224",
    method: "GET",
    path: "/svc/api/hub/v2/cook/productMaterials",
  }),
  foodKit: endpoint({
    apiId: 126,
    slug: "API-000225",
    method: "GET",
    path: "/svc/api/hub/v2/cook/kit/:productId",
  }),
  foodKitProducts: endpoint({
    apiId: 127,
    slug: "API-000226",
    method: "GET",
    path: "/svc/api/hub/v2/cook/kit/product/:productId",
  }),
} as const;

export function esisPath(template: string, values: Record<string, string | number>): string {
  const path = Object.entries(values).reduce(
    (path, [name, value]) => path.replace(`:${name}`, encodeURIComponent(String(value))),
    template,
  );
  const missing = path.match(/:[A-Za-z][A-Za-z0-9_]*/)?.[0];
  if (missing) throw new Error(`Missing ESIS path parameter ${missing.slice(1)}`);
  return path;
}
