import { Injectable } from "@nestjs/common";
import { EsisClient } from "./esis.client";
import { EsisConfig } from "./esis.config";
import { ESIS_ENDPOINTS, esisPath } from "./esis.endpoints";
import {
  esisAcademicYearSchema,
  esisAttendanceSchema,
  esisAttendanceUploadSchema,
  esisFoodMaterialGroupSchema,
  esisFoodMaterialSchema,
  esisFoodKitProductSchema,
  esisFoodKitSchema,
  esisFoodProductMaterialSchema,
  esisFoodProductSchema,
  esisFoodProductTypeSchema,
  esisGroupSchema,
  esisListParser,
  esisMovementSchema,
  esisOrganizationSchema,
  esisStaffSchema,
  esisStudentSchema,
  esisTeacherSchema,
  type EsisAttendanceUpload,
} from "./esis.schemas";
import type { EsisRequest, EsisResponse } from "./esis.types";

/**
 * Every readable service, with the schema that parses it and the path values
 * it needs.
 *
 * ★ One table, so a generic "read this resource" caller and the named domain
 * methods below cannot disagree about which schema belongs to which path. The
 * operator screen fetches by key; the future sync job will call the named
 * method. Both end up here.
 *
 * `institution` is false for the food catalog: those services are national
 * reference data and reject an `institutionId` filter.
 */
export const ESIS_READERS = {
  organization: { endpoint: ESIS_ENDPOINTS.organization, schema: esisOrganizationSchema },
  academicYearStatuses: {
    endpoint: ESIS_ENDPOINTS.academicYearStatuses,
    schema: esisAcademicYearSchema,
  },
  groups: { endpoint: ESIS_ENDPOINTS.groups, schema: esisGroupSchema },
  students: { endpoint: ESIS_ENDPOINTS.students, schema: esisStudentSchema },
  groupStudents: {
    endpoint: ESIS_ENDPOINTS.groupStudents,
    schema: esisStudentSchema,
    params: ["studentGroupId"],
  },
  studentMovements: {
    endpoint: ESIS_ENDPOINTS.studentMovements,
    schema: esisMovementSchema,
    params: ["beginDate"],
  },
  teachers: { endpoint: ESIS_ENDPOINTS.teachers, schema: esisTeacherSchema },
  staff: { endpoint: ESIS_ENDPOINTS.staff, schema: esisStaffSchema },
  groupAttendance: {
    endpoint: ESIS_ENDPOINTS.groupAttendance,
    schema: esisAttendanceSchema,
    params: ["studentGroupId", "dayDate"],
  },
  foodProductTypes: {
    endpoint: ESIS_ENDPOINTS.foodProductTypes,
    schema: esisFoodProductTypeSchema,
    institution: false,
  },
  foodMaterialGroups: {
    endpoint: ESIS_ENDPOINTS.foodMaterialGroups,
    schema: esisFoodMaterialGroupSchema,
    institution: false,
  },
  foodMaterials: {
    endpoint: ESIS_ENDPOINTS.foodMaterials,
    schema: esisFoodMaterialSchema,
    institution: false,
  },
  foodProducts: {
    endpoint: ESIS_ENDPOINTS.foodProducts,
    schema: esisFoodProductSchema,
    institution: false,
  },
  foodProductMaterials: {
    endpoint: ESIS_ENDPOINTS.foodProductMaterials,
    schema: esisFoodProductMaterialSchema,
    institution: false,
  },
  foodKit: {
    endpoint: ESIS_ENDPOINTS.foodKit,
    schema: esisFoodKitSchema,
    institution: false,
    params: ["productId"],
  },
  foodKitProducts: {
    endpoint: ESIS_ENDPOINTS.foodKitProducts,
    schema: esisFoodKitProductSchema,
    institution: false,
    params: ["productId"],
  },
} as const satisfies Record<
  string,
  {
    endpoint: { method: "GET"; path: string };
    schema: import("zod").ZodType;
    institution?: boolean;
    params?: readonly string[];
  }
>;

/** A GET service the operator screen may read. Excludes the attendance POST. */
export type EsisReadableKey = keyof typeof ESIS_READERS;

export const ESIS_READABLE_KEYS = Object.keys(ESIS_READERS) as EsisReadableKey[];

/**
 * The parsed row type of one readable service.
 *
 * ★ Keeps `read()` generic so `organization()` still returns organisations.
 * Routing every domain method through one table is what made the operator
 * screen possible; it should not cost the type the callers had before.
 */
export type EsisRow<K extends EsisReadableKey> = import("zod").infer<
  (typeof ESIS_READERS)[K]["schema"]
>;

/** Which path values a readable service needs before it can be called. */
export function esisReaderParams(key: EsisReadableKey): readonly string[] {
  return (ESIS_READERS[key] as { params?: readonly string[] }).params ?? [];
}

/**
 * The application-facing entry point to ESIS.
 *
 * Domain methods are limited to services selected from the official ESIS v2
 * catalog. They remove the ESIS envelope and discard fields NomadKids does not
 * need. The attendance workflow resolves external IDs from the live tenant
 * roster; bulk imports remain a separate, operator-approved synchronization
 * concern.
 */
@Injectable()
export class EsisService {
  constructor(
    private readonly client: EsisClient,
    private readonly config: EsisConfig,
  ) {}

  /**
   * Whether this deployment can talk to ESIS at all.
   *
   * ★ Callers must check this rather than catching `not_configured`. An
   * integration that is switched off is an ordinary state — most deployments
   * during rollout — and treating it as an exception makes ordinary operation
   * look like failure in the logs.
   */
  get isConfigured(): boolean {
    return this.config.isConfigured;
  }

  get isDemoMode(): boolean {
    return this.config.isDemoMode;
  }

  get isAvailable(): boolean {
    return this.config.isAvailable;
  }

  /** Safe to show an operator: no token, not even its length. */
  status(): ReturnType<EsisConfig["describe"]> {
    return this.config.describe();
  }

  /**
   * Low-level escape hatch for a catalog endpoint without a domain method.
   *
   * Pass `parse` to keep response validation at this boundary. New product
   * features should normally use one of the named methods below.
   */
  async request<T = unknown>(options: EsisRequest): Promise<EsisResponse<T>> {
    return this.client.request<T>(options);
  }

  /**
   * Reads one catalog service by key.
   *
   * ★ The operator screen's "ESIS-ээс татах" button needs a resource chosen at
   * runtime, which a set of hand-named methods cannot express. It stays safe
   * because `key` is one of `ESIS_READERS` — a caller cannot reach a path that is
   * not in the reviewed catalog, and `esisPath` still refuses an unresolved
   * parameter rather than calling ESIS with a literal `:studentGroupId`.
   */
  read<K extends EsisReadableKey>(
    key: K,
    params: Record<string, string | number> = {},
    institutionId?: string | number,
  ): Promise<EsisResponse<EsisRow<K>[]>> {
    /*
     * Through `unknown`: inside the generic body `ESIS_READERS[key]` widens to
     * the union of all seventeen readers, which TypeScript will not narrow to
     * `K`'s own entry. The table is keyed by the same `K` that types the return,
     * so the two cannot disagree — `esis.fields.test.ts` re-checks the pairing
     * at runtime for every key.
     */
    const reader = ESIS_READERS[key] as unknown as {
      endpoint: { method: "GET"; path: string };
      schema: import("zod").ZodType<EsisRow<K>>;
      institution?: boolean;
    };
    return this.getList(
      key,
      reader.endpoint,
      reader.schema,
      params,
      reader.institution !== false,
      institutionId,
    );
  }

  organization(institutionId: string | number) {
    return this.read("organization", {}, institutionId);
  }

  academicYearStatuses(institutionId: string | number) {
    return this.read("academicYearStatuses", {}, institutionId);
  }

  groups(institutionId: string | number) {
    return this.read("groups", {}, institutionId);
  }

  students(institutionId: string | number) {
    return this.read("students", {}, institutionId);
  }

  groupStudents(institutionId: string | number, studentGroupId: string | number) {
    return this.read("groupStudents", { studentGroupId }, institutionId);
  }

  studentMovements(institutionId: string | number, beginDate: string) {
    return this.read("studentMovements", { beginDate }, institutionId);
  }

  teachers(institutionId: string | number) {
    return this.read("teachers", {}, institutionId);
  }

  staff(institutionId: string | number) {
    return this.read("staff", {}, institutionId);
  }

  groupAttendance(
    institutionId: string | number,
    studentGroupId: string | number,
    dayDate: string,
  ) {
    return this.read("groupAttendance", { studentGroupId, dayDate }, institutionId);
  }

  async saveAttendance(input: EsisAttendanceUpload) {
    const parsed = esisAttendanceUploadSchema.parse(input);
    return this.client.request({
      path: ESIS_ENDPOINTS.saveAttendanceV3.path,
      method: ESIS_ENDPOINTS.saveAttendanceV3.method,
      body: parsed,
      demoFixture: "saveAttendanceV3",
    });
  }

  foodProductTypes() {
    return this.read("foodProductTypes");
  }

  foodMaterialGroups() {
    return this.read("foodMaterialGroups");
  }

  foodMaterials() {
    return this.read("foodMaterials");
  }

  foodProducts() {
    return this.read("foodProducts");
  }

  foodProductMaterials() {
    return this.read("foodProductMaterials");
  }

  foodKit(productId: string | number) {
    return this.read("foodKit", { productId });
  }

  foodKitProducts(productId: string | number) {
    return this.read("foodKitProducts", { productId });
  }

  private async getList<T>(
    key: EsisReadableKey,
    endpoint: { method: "GET"; path: string },
    schema: import("zod").ZodType<T>,
    pathValues: Record<string, string | number> = {},
    institutionScoped = true,
    institutionId?: string | number,
  ): Promise<EsisResponse<T[]>> {
    if (institutionScoped && institutionId === undefined) {
      throw new Error("ESIS institutionId is required for this resource");
    }
    return this.client.request<T[]>({
      path: esisPath(endpoint.path, pathValues),
      method: endpoint.method,
      query: institutionScoped ? { institutionId } : undefined,
      parse: esisListParser(schema),
      demoFixture: key,
    });
  }
}
