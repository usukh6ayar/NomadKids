import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuditRepository } from "../../audit/audit.repository";
import { PlatformAccessService } from "../../authz/platform-access.service";
import { TenantAccessService } from "../../authz/tenant-access.service";
import type { Actor } from "../../authz/actor";
import { EsisError } from "./esis.client";
import { ESIS_RESOURCE_CATALOG, type EsisEndpointKey } from "./esis.catalog";
import type { EsisPreviewDto, UpdateEsisMappingDto } from "./esis.dto";
import { EsisRepository } from "./esis.repository";
import { EsisService } from "./esis.service";

type PreviewResource = EsisPreviewDto["resources"][number];

@Injectable()
export class EsisAdminService {
  constructor(
    private readonly esis: EsisService,
    private readonly repo: EsisRepository,
    private readonly tenants: TenantAccessService,
    private readonly platform: PlatformAccessService,
    private readonly audit: AuditRepository,
  ) {}

  async overview(actor: Actor, kindergartenId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const recentRuns = await this.repo.listRecentRuns(kindergartenId);
    const deployment = this.esis.status();
    const mapped = Boolean(kindergarten.esisInstitutionId);
    const mappingMatchesDeployment = Boolean(
      mapped && deployment.configured && kindergarten.esisInstitutionId === deployment.institutionId,
    );
    const canPreview = deployment.configured && mappingMatchesDeployment;
    const hasSuccessfulPreview = recentRuns.some((run) => run.status === "SUCCEEDED");
    const blockers: string[] = [];

    if (!mapped) blockers.push("Platform админ ESIS байгууллагын кодыг холбож баталгаажуулна.");
    if (!deployment.configured) blockers.push("Server дээр ESIS token болон endpoint тохируулаагүй байна.");
    if (mapped && deployment.configured && !mappingMatchesDeployment) {
      blockers.push("Цэцэрлэгийн ESIS код deployment credential-тэй тохирохгүй байна.");
    }

    return {
      deployment,
      connection: {
        mapped,
        institutionId: kindergarten.esisInstitutionId,
        environment: kindergarten.esisEnvironment,
        mappedAt: kindergarten.esisMappedAt,
        mappingMatchesDeployment,
      },
      stages: [
        { code: "C1", label: "API каталог", status: "READY" as const },
        { code: "C2", label: "Код ба schema", status: "READY" as const },
        {
          code: "C3",
          label: "Token ба API эрх",
          status: canPreview ? ("READY" as const) : ("WAITING" as const),
        },
        {
          code: "C4",
          label: "Test орчны шалгалт",
          status: hasSuccessfulPreview ? ("READY" as const) : ("WAITING" as const),
        },
        { code: "C5", label: "Production sync", status: "WAITING" as const },
      ],
      endpoints: ESIS_RESOURCE_CATALOG.map((endpoint) => ({
        ...endpoint,
        accessStatus: "UNKNOWN" as const,
      })),
      recentRuns: recentRuns.map((run) => ({
        ...run,
        initiatedBy: `${run.initiatedBy.lastName} ${run.initiatedBy.firstName}`.trim(),
      })),
      canPreview,
      blockers,
    };
  }

  async updateMapping(actor: Actor, kindergartenId: string, dto: UpdateEsisMappingDto) {
    this.platform.assertSuperAdmin(actor);
    const existing = await this.repo.findKindergarten(kindergartenId);
    if (!existing) throw new NotFoundException();

    try {
      const updated = await this.repo.updateMapping(
        kindergartenId,
        dto.mapped
          ? {
              esisInstitutionId: dto.institutionId,
              esisEnvironment: dto.environment,
              esisMappedAt: new Date(),
            }
          : { esisInstitutionId: null, esisEnvironment: null, esisMappedAt: null },
      );

      await this.audit.append({
        action: "UPDATE",
        kindergartenId,
        actorUserId: actor.userId,
        objectType: "EsisMapping",
        objectId: kindergartenId,
        metadata: {
          mapped: dto.mapped,
          environment: dto.mapped ? dto.environment : null,
          fields: ["esisInstitutionId", "esisEnvironment"],
        },
      });
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Энэ ESIS байгууллагын код өөр цэцэрлэгтэй холбогдсон байна.");
      }
      throw error;
    }
  }

  async preview(actor: Actor, kindergartenId: string, dto: EsisPreviewDto) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const deployment = this.esis.status();
    if (!deployment.configured) {
      throw new ServiceUnavailableException("ESIS холболт server дээр тохируулагдаагүй байна.");
    }
    if (
      !kindergarten.esisInstitutionId ||
      kindergarten.esisInstitutionId !== deployment.institutionId
    ) {
      throw new ConflictException("Цэцэрлэгийн ESIS байгууллагын код баталгаажаагүй байна.");
    }
    await this.repo.expireStaleRuns(kindergartenId, new Date(Date.now() - 15 * 60_000));
    if (await this.repo.findRunning(kindergartenId)) {
      throw new ConflictException("Энэ цэцэрлэгийн ESIS шалгалт аль хэдийн ажиллаж байна.");
    }

    let run;
    try {
      run = await this.repo.createRun(kindergartenId, actor.userId, dto.resources);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Энэ цэцэрлэгийн ESIS шалгалт аль хэдийн ажиллаж байна.");
      }
      throw error;
    }

    const settled = await Promise.allSettled(
      dto.resources.map(async (resource) => {
        const response = await this.fetchResource(resource);
        return {
          resource,
          count: response.data.length,
          durationMs: response.durationMs,
          preview: previewRows(resource, response.data),
        };
      }),
    );

    const results = settled.map((item, index) => {
      const resource = dto.resources[index]!;
      return item.status === "fulfilled"
        ? { ...item.value, status: "SUCCEEDED" as const, errorCode: null }
        : {
            resource,
            count: 0,
            durationMs: null,
            preview: [],
            status: "FAILED" as const,
            errorCode: safeErrorCode(item.reason),
          };
    });
    const successCount = results.filter((result) => result.status === "SUCCEEDED").length;
    const status =
      successCount === results.length ? "SUCCEEDED" : successCount === 0 ? "FAILED" : "PARTIAL";
    const summary = Object.fromEntries(
      results.map((result) => [
        result.resource,
        { status: result.status, count: result.count, errorCode: result.errorCode },
      ]),
    );

    await this.repo.finishRun(run.id, {
      status,
      summary,
      errorCode: status === "SUCCEEDED" ? null : "ONE_OR_MORE_RESOURCES_FAILED",
    });
    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisSyncRun",
      objectId: run.id,
      metadata: { dryRun: true, resources: dto.resources, status },
    });

    return { runId: run.id, dryRun: true as const, status, results };
  }

  private fetchResource(resource: PreviewResource) {
    const calls: Record<PreviewResource, () => Promise<{ data: unknown[]; durationMs: number }>> = {
      organization: () => this.esis.organization(),
      academicYearStatuses: () => this.esis.academicYearStatuses(),
      groups: () => this.esis.groups(),
      students: () => this.esis.students(),
      teachers: () => this.esis.teachers(),
      staff: () => this.esis.staff(),
      foodProductTypes: () => this.esis.foodProductTypes(),
      foodMaterialGroups: () => this.esis.foodMaterialGroups(),
      foodMaterials: () => this.esis.foodMaterials(),
      foodProducts: () => this.esis.foodProducts(),
      foodProductMaterials: () => this.esis.foodProductMaterials(),
    };
    return calls[resource]();
  }
}

function previewRows(resource: EsisEndpointKey, rows: unknown[]) {
  return rows.slice(0, 5).map((row) => {
    const value = row as Record<string, unknown>;
    const fullName = [value.lastName, value.firstName].filter(Boolean).join(" ");
    const label =
      value.institutionName ||
      value.academicYear ||
      value.studentGroupName ||
      fullName ||
      value.productTypeName ||
      value.groupName ||
      value.materialName ||
      value.productName ||
      resource;
    return { label: String(label || resource) };
  });
}

function safeErrorCode(error: unknown): string {
  if (error instanceof EsisError) {
    if (error.kind === "http" && error.detail.status === 401) return "UNAUTHORIZED";
    if (error.kind === "http" && error.detail.status === 403) return "SCOPE_DENIED";
    return error.kind.toUpperCase();
  }
  return "UNKNOWN";
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
