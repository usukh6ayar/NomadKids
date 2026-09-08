import {
  BadGatewayException,
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
import type { EsisPreviewDto, EsisReadDto, UpdateEsisMappingDto } from "./esis.dto";
import { ESIS_FIELDS, ingestedFieldNames } from "./esis.fields";
import { EsisRepository } from "./esis.repository";
import { EsisService, esisReaderParams } from "./esis.service";

type PreviewResource = EsisPreviewDto["resources"][number];

/** How many rows a screen shows. Both are display limits, not fetch limits. */
const PREVIEW_ROWS = 5;
const READ_ROWS = 25;

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
    const mappingMatchesDeployment = mapped;
    const canPreview = deployment.configured && mappingMatchesDeployment;
    const hasSuccessfulPreview = recentRuns.some((run) => run.status === "SUCCEEDED");
    const blockers: string[] = [];

    if (!mapped) blockers.push("Platform админ ESIS байгууллагын кодыг холбож баталгаажуулна.");
    if (!deployment.configured) blockers.push("Server дээр ESIS Bearer token тохируулаагүй байна.");

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
        {
          code: "C5",
          label: "Production acceptance",
          status: "WAITING" as const,
        },
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

  async studentRegistrationTemplate(actor: Actor, kindergartenId: string) {
    this.tenants.assertStaff(actor, kindergartenId);
    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const student = ESIS_RESOURCE_CATALOG.find((endpoint) => endpoint.key === "students")!;
    if (this.esis.isConfigured && kindergarten.esisInstitutionId) {
      await this.audit.append({
        action: "VIEW",
        kindergartenId,
        actorUserId: actor.userId,
        objectType: "EsisResource",
        objectId: "students",
        metadata: { purpose: "student-registration-template" },
      });
      const response = await this.esis
        .students(kindergarten.esisInstitutionId)
        .catch((error: unknown) => {
          throw esisUserError(error, "суралцагчийн мэдээлэл");
        });
      return {
        mode: "LIVE" as const,
        resource: "students" as const,
        apiId: student.apiId,
        slug: student.slug,
        method: student.method,
        endpoint: student.path,
        syncedAt: new Date().toISOString(),
        fields: student.fields,
        row:
          rowValues("students", response.data, 1)[0] ??
          Object.fromEntries(ingestedFieldNames("students").map((name) => [name, null])),
      };
    }

    return {
      mode: "DEMO" as const,
      resource: "students" as const,
      apiId: student.apiId,
      slug: student.slug,
      method: student.method,
      endpoint: student.path,
      syncedAt: "2026-09-08T01:15:00.000Z",
      fields: student.fields,
      row: student.sampleRow,
    };
  }

  async myProfile(actor: Actor, kindergartenId: string) {
    this.tenants.assertStaff(actor, kindergartenId);
    const [kindergarten, user] = await Promise.all([
      this.repo.findKindergarten(kindergartenId),
      this.repo.findUserIdentity(actor.userId),
    ]);
    if (!kindergarten || !user) throw new NotFoundException();

    const resource = actor.memberships.some(
      (membership) => membership.kindergartenId === kindergartenId && membership.role === "TEACHER",
    )
      ? ("teachers" as const)
      : ("staff" as const);
    const catalog = ESIS_RESOURCE_CATALOG.find((endpoint) => endpoint.key === resource)!;

    if (!this.esis.isConfigured || !kindergarten.esisInstitutionId) {
      return {
        mode: "DEMO" as const,
        resource,
        apiId: catalog.apiId,
        slug: catalog.slug,
        endpoint: catalog.path,
        syncedAt: new Date().toISOString(),
        institutionId: kindergarten.esisInstitutionId,
        fields: ESIS_FIELDS[resource],
        row: catalog.sampleRow,
      };
    }

    await this.audit.append({
      action: "VIEW",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisResource",
      objectId: resource,
      metadata: { purpose: "my-profile" },
    });
    const response = await (
      resource === "teachers"
        ? this.esis.teachers(kindergarten.esisInstitutionId)
        : this.esis.staff(kindergarten.esisInstitutionId)
    ).catch((error: unknown) => {
      throw esisUserError(error, "ажилтны мэдээлэл");
    });
    const localName = normalizeIdentity(`${user.lastName} ${user.firstName}`);
    const localEmail = user.email?.trim().toLowerCase() ?? "";
    const matches = response.data.filter((person) => {
      const names = [
        `${person.lastName} ${person.firstName}`,
        `${person.lastNameMgl ?? ""} ${person.firstNameMgl ?? ""}`,
      ].map(normalizeIdentity);
      const emails = [person.microsoftEmail, person.googleEmail, person.allEmail]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim().toLowerCase());
      return names.includes(localName) || Boolean(localEmail && emails.includes(localEmail));
    });

    if (matches.length !== 1) {
      throw new ConflictException(
        matches.length === 0
          ? "Таны нэр эсвэл и-мэйлтэй тохирох ESIS ажилтны бүртгэл олдсонгүй."
          : "Таны мэдээлэлтэй тохирох ESIS ажилтны бүртгэл давхардсан байна.",
      );
    }

    return {
      mode: "LIVE" as const,
      resource,
      apiId: catalog.apiId,
      slug: catalog.slug,
      endpoint: catalog.path,
      syncedAt: new Date().toISOString(),
      institutionId: kindergarten.esisInstitutionId,
      fields: ESIS_FIELDS[resource],
      row: rowValues(resource, matches, 1)[0]!,
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

  /**
   * The guard every ESIS read shares.
   *
   * ★ Tenant first, always. `assertAdmin` runs before the kindergarten is even
   * loaded, so an admin of another kindergarten never learns whether this one
   * has an ESIS mapping. The two configuration failures below are only
   * reachable by someone who already administers this tenant.
   */
  private async assertReadable(actor: Actor, kindergartenId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);
    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const deployment = this.esis.status();
    if (!deployment.configured) {
      throw new ServiceUnavailableException("ESIS холболт server дээр тохируулагдаагүй байна.");
    }
    if (!kindergarten.esisInstitutionId) {
      throw new ConflictException("Цэцэрлэгийн ESIS байгууллагын код баталгаажаагүй байна.");
    }
    return kindergarten;
  }

  /**
   * Reads one service and returns its rows field by field.
   *
   * ★ This is what the "ESIS-ээс татах" buttons call. It writes nothing —
   * not a local record, not an `EsisSyncRun`. `AuditLog` gets a `VIEW` row
   * because reading a ministry roster is an act worth attributing, and because
   * §14's audit requirement does not distinguish reads that happen to be
   * harmless from reads that turn out not to have been.
   *
   * ★★ An upstream failure comes back as a result, not an exception. The
   * button's whole job is to answer "is the connection working yet?", and an
   * operator learns more from `SCOPE_DENIED` rendered in place than from a red
   * toast that says something went wrong.
   */
  async read(actor: Actor, kindergartenId: string, dto: EsisReadDto) {
    const kindergarten = await this.assertReadable(actor, kindergartenId);

    const params = Object.fromEntries(
      Object.entries(dto.params ?? {}).filter(([, value]) => value !== undefined),
    ) as Record<string, string>;
    const missing = esisReaderParams(dto.resource).filter((name) => !params[name]);
    if (missing.length > 0) {
      throw new ConflictException(`Дараах утга дутуу байна: ${missing.join(", ")}`);
    }

    await this.audit.append({
      action: "VIEW",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisResource",
      objectId: dto.resource,
      metadata: { resource: dto.resource, params },
    });

    const fields = ESIS_FIELDS[dto.resource];
    try {
      const response = await this.esis.read(dto.resource, params, kindergarten.esisInstitutionId!);
      return {
        resource: dto.resource,
        status: "SUCCEEDED" as const,
        errorCode: null,
        count: response.data.length,
        durationMs: response.durationMs,
        fields,
        rows: rowValues(dto.resource, response.data, READ_ROWS),
      };
    } catch (error) {
      return {
        resource: dto.resource,
        status: "FAILED" as const,
        errorCode: safeErrorCode(error),
        count: 0,
        durationMs: null,
        fields,
        rows: [],
      };
    }
  }

  async preview(actor: Actor, kindergartenId: string, dto: EsisPreviewDto) {
    const kindergarten = await this.assertReadable(actor, kindergartenId);
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
        const response = await this.fetchResource(resource, kindergarten.esisInstitutionId!);
        return {
          resource,
          count: response.data.length,
          durationMs: response.durationMs,
          preview: rowValues(resource, response.data, PREVIEW_ROWS),
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

  private fetchResource(resource: PreviewResource, institutionId: string) {
    const calls: Record<PreviewResource, () => Promise<{ data: unknown[]; durationMs: number }>> = {
      organization: () => this.esis.organization(institutionId),
      academicYearStatuses: () => this.esis.academicYearStatuses(institutionId),
      groups: () => this.esis.groups(institutionId),
      students: () => this.esis.students(institutionId),
      teachers: () => this.esis.teachers(institutionId),
      staff: () => this.esis.staff(institutionId),
      foodProductTypes: () => this.esis.foodProductTypes(),
      foodMaterialGroups: () => this.esis.foodMaterialGroups(),
      foodMaterials: () => this.esis.foodMaterials(),
      foodProducts: () => this.esis.foodProducts(),
      foodProductMaterials: () => this.esis.foodProductMaterials(),
    };
    return calls[resource]();
  }
}

/**
 * Turns parsed rows into one string per catalog field.
 *
 * ★ Keyed by `ingestedFieldNames`, not by `Object.keys(row)`. The screen must
 * show the same columns whether or not ESIS filled them, or "the field is
 * missing" and "the field is empty" become the same picture — and the first of
 * those is a contract change worth noticing. A field ESIS omitted reads
 * `null`, and the column is still there.
 *
 * ★★ Nothing that is not an ingested field can appear here. The refused
 * fields — civil id, register number, provider passwords — are already gone,
 * stripped by the zod schema one layer up; this function could not surface one
 * even if a schema were widened by mistake.
 */
function rowValues(resource: EsisEndpointKey, rows: unknown[], limit: number) {
  const names = ingestedFieldNames(resource);
  return rows.slice(0, limit).map((row) => {
    const value = row as Record<string, unknown>;
    return Object.fromEntries(names.map((name) => [name, displayValue(value[name])]));
  });
}

function displayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function normalizeIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("mn-MN");
}

function safeErrorCode(error: unknown): string {
  if (error instanceof EsisError) {
    if (error.kind === "http" && error.detail.status === 401) return "UNAUTHORIZED";
    if (error.kind === "http" && error.detail.status === 403) return "SCOPE_DENIED";
    return error.kind.toUpperCase();
  }
  return "UNKNOWN";
}

function esisUserError(error: unknown, resource: string): BadGatewayException {
  if (error instanceof EsisError && error.kind === "http" && error.detail.status === 401) {
    return new BadGatewayException("ESIS Bearer token хүчингүй эсвэл хугацаа дууссан байна.");
  }
  if (error instanceof EsisError && error.kind === "http" && error.detail.status === 403) {
    return new BadGatewayException(`ESIS token-д ${resource} унших эрх алга байна.`);
  }
  return new BadGatewayException(`ESIS-ээс ${resource} татаж чадсангүй.`);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
