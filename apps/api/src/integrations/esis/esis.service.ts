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
  esisFoodProductMaterialSchema,
  esisFoodProductSchema,
  esisFoodProductTypeSchema,
  esisGroupSchema,
  esisListParser,
  esisMovementSchema,
  esisOrganizationSchema,
  esisStaffSchema,
  esisStudentSchema,
  type EsisAttendanceUpload,
} from "./esis.schemas";
import type { EsisRequest, EsisResponse } from "./esis.types";

/**
 * The application-facing entry point to ESIS.
 *
 * Domain methods are limited to services selected from the official ESIS v2
 * catalog. They remove the ESIS envelope and discard fields NomadKids does not
 * need. Synchronisation is still intentionally separate: it needs an issued
 * token, approved API ids, external-id storage and a retryable queue.
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

  organization() {
    return this.getList(ESIS_ENDPOINTS.organization, esisOrganizationSchema);
  }

  academicYearStatuses() {
    return this.getList(ESIS_ENDPOINTS.academicYearStatuses, esisAcademicYearSchema);
  }

  groups() {
    return this.getList(ESIS_ENDPOINTS.groups, esisGroupSchema);
  }

  students() {
    return this.getList(ESIS_ENDPOINTS.students, esisStudentSchema);
  }

  groupStudents(studentGroupId: string | number) {
    return this.getList(ESIS_ENDPOINTS.groupStudents, esisStudentSchema, { studentGroupId });
  }

  studentMovements(beginDate: string) {
    return this.getList(ESIS_ENDPOINTS.studentMovements, esisMovementSchema, { beginDate });
  }

  teachers() {
    return this.getList(ESIS_ENDPOINTS.teachers, esisStaffSchema);
  }

  staff() {
    return this.getList(ESIS_ENDPOINTS.staff, esisStaffSchema);
  }

  groupAttendance(studentGroupId: string | number, dayDate: string) {
    return this.getList(ESIS_ENDPOINTS.groupAttendance, esisAttendanceSchema, {
      studentGroupId,
      dayDate,
    });
  }

  async saveAttendance(input: EsisAttendanceUpload) {
    const parsed = esisAttendanceUploadSchema.parse(input);
    const institutionId = Number(this.config.institutionId);
    if (!Number.isSafeInteger(institutionId) || institutionId <= 0) {
      throw new Error("ESIS_INSTITUTION_ID must be a positive safe integer for attendance upload");
    }
    return this.client.request({
      path: ESIS_ENDPOINTS.saveAttendanceV3.path,
      method: ESIS_ENDPOINTS.saveAttendanceV3.method,
      body: { institutionId, ...parsed },
    });
  }

  foodProductTypes() {
    return this.getList(ESIS_ENDPOINTS.foodProductTypes, esisFoodProductTypeSchema, {}, false);
  }

  foodMaterialGroups() {
    return this.getList(ESIS_ENDPOINTS.foodMaterialGroups, esisFoodMaterialGroupSchema, {}, false);
  }

  foodMaterials() {
    return this.getList(ESIS_ENDPOINTS.foodMaterials, esisFoodMaterialSchema, {}, false);
  }

  foodProducts() {
    return this.getList(ESIS_ENDPOINTS.foodProducts, esisFoodProductSchema, {}, false);
  }

  foodProductMaterials() {
    return this.getList(
      ESIS_ENDPOINTS.foodProductMaterials,
      esisFoodProductMaterialSchema,
      {},
      false,
    );
  }

  foodKit(productId: string | number) {
    return this.getList(ESIS_ENDPOINTS.foodKit, esisFoodProductSchema, { productId }, false);
  }

  foodKitProducts(productId: string | number) {
    return this.getList(
      ESIS_ENDPOINTS.foodKitProducts,
      esisFoodProductSchema,
      { productId },
      false,
    );
  }

  private async getList<T>(
    endpoint: { method: "GET"; path: string },
    schema: import("zod").ZodType<T>,
    pathValues: Record<string, string | number> = {},
    includeInstitution = true,
  ): Promise<EsisResponse<T[]>> {
    return this.client.request<T[]>({
      path: esisPath(endpoint.path, pathValues),
      method: endpoint.method,
      query: includeInstitution ? { institutionId: this.config.institutionId } : undefined,
      parse: esisListParser(schema),
    });
  }
}
