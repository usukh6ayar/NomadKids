/**
 * ESIS v2 services used by NomadKids.
 *
 * Source: https://developerv2.esis.edu.mn/api/structure, reviewed 2026-09-08.
 * Keep the API id beside the path: access is granted per service in the ESIS
 * developer portal, so an operator needs both when requesting or auditing a
 * token's scope.
 */
export interface EsisEndpoint {
  apiId: number;
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
