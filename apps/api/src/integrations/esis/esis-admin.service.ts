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
import { ESIS_RESOURCE_CATALOG, esisServicesForActor, type EsisEndpointKey } from "./esis.catalog";
import type { EsisPreviewDto, EsisReadDto, UpdateEsisMappingDto } from "./esis.dto";
import { ESIS_FIELDS, ingestedFieldNames } from "./esis.fields";
import { EsisRepository } from "./esis.repository";
import { EsisService, esisReaderParams } from "./esis.service";

type PreviewResource = EsisPreviewDto["resources"][number];

/** How many rows a screen shows. Both are display limits, not fetch limits. */
const PREVIEW_ROWS = 5;
const READ_ROWS = 25;
const DEMO_ESIS_INSTITUTION_ID = "40305";

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
    const canPreview = deployment.demoMode || (deployment.configured && mappingMatchesDeployment);
    const hasSuccessfulPreview = recentRuns.some(
      (run) => run.status === "SUCCEEDED" && syncRunMode(run.summary) === "LIVE",
    );
    const blockers: string[] = [];

    if (!mapped) blockers.push("Live горимд ESIS байгууллагын кодыг холбож баталгаажуулна.");
    if (!deployment.configured)
      blockers.push("Live горимын ESIS Bearer token тохируулаагүй байна.");

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
          status: deployment.configured && mapped ? ("READY" as const) : ("WAITING" as const),
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
      endpoints: ESIS_RESOURCE_CATALOG.map((endpoint) => {
        const demoEnabled = endpoint.domain !== "FOOD";
        const lastRun = recentRuns.find((run) =>
          Array.isArray(run.resources) ? run.resources.includes(endpoint.key) : false,
        );
        return {
          ...endpoint,
          accessStatus:
            endpoint.domain === "FOOD"
              ? ("NOT_ENABLED" as const)
              : deployment.demoMode
                ? demoEnabled
                  ? ("MOCK" as const)
                  : ("NOT_ENABLED" as const)
                : deployment.configured
                  ? ("UNKNOWN" as const)
                  : ("NOT_ENABLED" as const),
          responseMode: deployment.demoMode ? ("DEMO" as const) : ("LIVE" as const),
          httpStatus:
            (deployment.demoMode && demoEnabled) || lastRun?.status === "SUCCEEDED" ? 200 : null,
          syncStatus:
            deployment.demoMode && demoEnabled
              ? ("DEMO_SUCCESS" as const)
              : lastRun?.status === "SUCCEEDED"
                ? ("SUCCESS" as const)
                : lastRun?.status === "FAILED" || lastRun?.status === "PARTIAL"
                  ? ("FAILED" as const)
                  : ("PENDING" as const),
          syncErrorCode: lastRun?.errorCode ?? null,
          lastSyncAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
        };
      }),
      recentRuns: recentRuns.map((run) => ({
        ...run,
        initiatedBy: `${run.initiatedBy.lastName} ${run.initiatedBy.firstName}`.trim(),
        mode: syncRunMode(run.summary),
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
    if (this.esis.isAvailable && (this.esis.isDemoMode || kindergarten.esisInstitutionId)) {
      await this.audit.append({
        action: "VIEW",
        kindergartenId,
        actorUserId: actor.userId,
        objectType: "EsisResource",
        objectId: "students",
        metadata: { purpose: "student-registration-template" },
      });
      const response = await this.esis
        .students(kindergarten.esisInstitutionId ?? DEMO_ESIS_INSTITUTION_ID)
        .catch((error: unknown) => {
          throw esisUserError(error, "суралцагчийн мэдээлэл");
        });
      return {
        mode: response.source === "MOCK" ? ("DEMO" as const) : ("LIVE" as const),
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

    if (!this.esis.isAvailable || (!this.esis.isDemoMode && !kindergarten.esisInstitutionId)) {
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
        ? this.esis.teachers(kindergarten.esisInstitutionId ?? DEMO_ESIS_INSTITUTION_ID)
        : this.esis.staff(kindergarten.esisInstitutionId ?? DEMO_ESIS_INSTITUTION_ID)
    ).catch((error: unknown) => {
      throw esisUserError(error, "ажилтны мэдээлэл");
    });
    if (response.source === "MOCK") {
      return {
        mode: "DEMO" as const,
        resource,
        apiId: catalog.apiId,
        slug: catalog.slug,
        endpoint: catalog.path,
        syncedAt: new Date().toISOString(),
        institutionId: kindergarten.esisInstitutionId,
        fields: ESIS_FIELDS[resource],
        row: rowValues(resource, response.data, 1)[0] ?? catalog.sampleRow,
      };
    }

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
   * The catalog, scoped to what this actor's role actually uses.
   *
   * ★ A second entry point rather than a widened `overview()` — added
   * 2026-09-09, when the client began placing services on the teacher's
   * screens.
   *
   * `overview()` is the operator's view: the token's state, the deployment's
   * base URL, which kindergarten has been mapped, the blockers left and the
   * recent run history. None of that is a teacher's business, and all of it
   * would have come along had the role list on that route simply grown. This
   * returns the services their own screens draw and whether a live read is
   * possible — the whole of what `EsisDataPanel` reads.
   *
   * ★★ `assertMember`, not `assertStaff`. The role list is what narrows this:
   * a cook or a parent passes the tenant check and then gets an empty service
   * list, which is a 404 — the same answer a stranger gets, per CLAUDE.md §1.7.
   */
  async catalogForActor(actor: Actor, kindergartenId: string) {
    this.tenants.assertMember(actor, kindergartenId);

    const keys = new Set(esisServicesForActor(actor, kindergartenId));
    if (keys.size === 0) throw new NotFoundException();

    const deployment = this.esis.status();

    return {
      mode: deployment.configured ? ("LIVE" as const) : ("DEMO" as const),
      canRead: deployment.demoMode || deployment.configured,
      endpoints: ESIS_RESOURCE_CATALOG.filter((endpoint) => keys.has(endpoint.key)).map(
        (endpoint) => ({ ...endpoint, accessStatus: "UNKNOWN" as const }),
      ),
    };
  }

  /**
   * The guard every ESIS read shares.
   *
   * ★ Tenant first, always. `assertAdmin` runs before the kindergarten is even
   * loaded, so an admin of another kindergarten never learns whether this one
   * has an ESIS mapping. The two configuration failures below are only
   * reachable by someone who already administers this tenant.
   */
  private async assertReadable(actor: Actor, kindergartenId: string, resource?: EsisEndpointKey) {
    /*
     * ★ Tenant first, then the service — 2026-09-09.
     *
     * This asserted `assertAdmin` outright until the teacher's screens got
     * their five services. It now asks whether *this* actor may read *this*
     * service, which for an admin is every one of them and so is the same
     * check it was. A service outside the caller's list answers 404 rather
     * than 403: a teacher asking for the food catalog should not learn that it
     * exists, which is CLAUDE.md §1.7 applied to a service name.
     */
    this.tenants.assertMember(actor, kindergartenId);
    if (resource) {
      const allowed = esisServicesForActor(actor, kindergartenId);
      if (!allowed.includes(resource)) throw new NotFoundException();
    } else {
      this.tenants.assertAdmin(actor, kindergartenId);
    }

    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const deployment = this.esis.status();
    if (!deployment.demoMode && !deployment.configured) {
      throw new ServiceUnavailableException("ESIS холболт server дээр тохируулагдаагүй байна.");
    }
    if (!deployment.demoMode && !kindergarten.esisInstitutionId) {
      throw new ConflictException("Цэцэрлэгийн ESIS байгууллагын код баталгаажаагүй байна.");
    }
    return {
      kindergarten,
      institutionId: kindergarten.esisInstitutionId ?? DEMO_ESIS_INSTITUTION_ID,
    };
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
    const { institutionId } = await this.assertReadable(actor, kindergartenId, dto.resource);

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
      const response = await this.esis.read(dto.resource, params, institutionId);
      return {
        resource: dto.resource,
        source: response.source,
        status: "SUCCEEDED" as const,
        errorCode: null,
        count: response.data.length,
        durationMs: response.durationMs,
        fields,
        rows: rowValues(dto.resource, response.data, READ_ROWS),
        response: {
          SUCCESS_CODE: 200,
          RESPONSE_MESSAGE: response.source === "MOCK" ? "DEMO_SUCCESS" : "SUCCESS",
          RESULT: rowValues(dto.resource, response.data, READ_ROWS),
        },
      };
    } catch (error) {
      return {
        resource: dto.resource,
        source: this.esis.isDemoMode ? ("MOCK" as const) : ("LIVE" as const),
        status: "FAILED" as const,
        errorCode: safeErrorCode(error),
        count: 0,
        durationMs: null,
        fields,
        rows: [],
        response: {
          SUCCESS_CODE: 502,
          RESPONSE_MESSAGE: safeErrorCode(error),
          RESULT: [],
        },
      };
    }
  }

  async preview(actor: Actor, kindergartenId: string, dto: EsisPreviewDto) {
    const { institutionId } = await this.assertReadable(actor, kindergartenId);
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
        const response = await this.fetchResource(resource, institutionId);
        return {
          resource,
          count: response.data.length,
          durationMs: response.durationMs,
          preview: rowValues(resource, response.data, PREVIEW_ROWS),
          source: response.source,
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
            source: this.esis.isDemoMode ? ("MOCK" as const) : ("LIVE" as const),
          };
    });
    const successCount = results.filter((result) => result.status === "SUCCEEDED").length;
    const status =
      successCount === results.length ? "SUCCEEDED" : successCount === 0 ? "FAILED" : "PARTIAL";
    const summary = {
      mode: this.esis.isDemoMode ? ("MOCK" as const) : ("LIVE" as const),
      resources: Object.fromEntries(
        results.map((result) => [
          result.resource,
          { status: result.status, count: result.count, errorCode: result.errorCode },
        ]),
      ),
    };

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
      metadata: { dryRun: true, resources: dto.resources, status, mode: summary.mode },
    });

    return { runId: run.id, dryRun: true as const, mode: summary.mode, status, results };
  }

  private fetchResource(resource: PreviewResource, institutionId: string) {
    const calls: Record<
      PreviewResource,
      () => Promise<{ data: unknown[]; durationMs: number; source: "MOCK" | "LIVE" }>
    > = {
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

function syncRunMode(summary: unknown): "MOCK" | "LIVE" {
  if (
    typeof summary === "object" &&
    summary !== null &&
    "mode" in summary &&
    summary.mode === "MOCK"
  ) {
    return "MOCK";
  }
  return "LIVE";
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
