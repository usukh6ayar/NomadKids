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
import { ChildAccessService } from "../../authz/child-access.service";
import { hasRoleIn, type Actor } from "../../authz/actor";
import { Role } from "../../domain/enums";
import { EsisError } from "./esis.client";
import {
  ESIS_REQUEST_REGISTER,
  ESIS_RESOURCE_CATALOG,
  esisServicesForActor,
  type EsisEndpointKey,
} from "./esis.catalog";
import type { EsisPreviewDto, EsisReadDto, EsisWriteDto, UpdateEsisMappingDto } from "./esis.dto";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_FIELDS, esisFieldsFor, ingestedFieldNames } from "./esis.fields";
import { EsisRepository } from "./esis.repository";
import { esisVisibleRows } from "./esis.schemas";
import { EsisService, esisReaderParams, type EsisReadableKey } from "./esis.service";

type PreviewResource = EsisPreviewDto["resources"][number];

/** How many rows a screen shows. Both are display limits, not fetch limits. */
const PREVIEW_ROWS = 5;

/**
 * The ceiling on rows a read hands back — **500 since 2026-09-14**, was 25.
 *
 * ★ Twenty-five was a *preview* number, and correct while the table was one:
 * the panel existed to answer "what comes back when we connect?", and twenty-
 * five rows answer that as well as eight hundred. It stopped being correct the
 * moment the table got a search box. A reader who types a name and is told
 * "олдсонгүй" has been given a wrong answer, not a truncated one — the child is
 * in the response, twenty-sixth, and the screen searched a slice without
 * saying so. A cap the reader cannot see must not sit under a filter.
 *
 * ★★ Raised rather than removed, because CLAUDE.md §3.4 forbids an endpoint
 * returning an unbounded set and the reasoning survives the change of source:
 * this list is bounded by whatever ESIS chooses to send, which is not a
 * promise. Five hundred covers every kindergarten roster — this deployment's
 * largest is eighty-three — and the "эхний N" note still appears above
 * anything longer, so the truncation stays visible when it happens.
 *
 * ★★★ It costs no extra ESIS call. The upstream services have no paging of
 * their own; `students/list` returns the whole roster in one response and
 * always did. This number only decided how much of an answer already in
 * memory was forwarded.
 */
const READ_ROWS = 500;

/**
 * How many rows the raw `response` envelope carries.
 *
 * ★ **Not `READ_ROWS` — 2026-09-14.** The two were the same number until the
 * cap moved, and `response.RESULT` was simply `rows`, so raising the cap to
 * five hundred shipped the whole roster **twice** in one payload and rendered
 * the second copy into a `<pre>` on the teacher's import screen. Measured on
 * this deployment's eighty-three children: 76 KB of rows, the same 76 KB
 * again under `RESULT`, and 90 KB of pretty-printed JSON above the table.
 *
 * ★★ Five rows is not a truncation of that block, it is what the block is
 * for. `response` exists to show the shape ESIS answers in — the envelope,
 * its `SUCCESS_CODE`, its `RESPONSE_MESSAGE` and enough records to see how a
 * record is nested. `rows` is the parsed view and carries all of them; the
 * table reads that. A reader who wants the eighty-third child looks at the
 * table, which can now search and page to it.
 *
 * ★★★ The surfaces that render it say how many of how many they are showing,
 * so the short list can never be read as "ESIS returned five".
 */
const ENVELOPE_ROWS = 5;

@Injectable()
export class EsisAdminService {
  constructor(
    private readonly esis: EsisService,
    private readonly repo: EsisRepository,
    private readonly tenants: TenantAccessService,
    private readonly platform: PlatformAccessService,
    /*
     * ★ The one module that decides who may reach a child (CLAUDE.md §1.1).
     * Injected 2026-09-15 so a per-child ESIS read is gated by the same rule
     * as every other child route, rather than by a second copy of it.
     */
    private readonly children: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The platform operator's view of one tenant's ESIS integration.
   *
   * ★ **Superadmin, not the kindergarten's director** — changed 2026-09-14 at
   * the client's request ("захирал дээр ESIS системийн зүйл байх нь зөв уу?
   * superadmin дээр байх нь зөв"). Everything this returns is a property of the
   * *deployment*: `ESIS_TOKEN` and `ESIS_BASE_URL` are environment settings and
   * one ESIS developer account serves every kindergarten, so the token's state,
   * the granted scope and the remaining blockers are facts a director can read
   * and cannot act on. The institution mapping beneath them was already
   * `@SuperAdmin()` (`updateMapping`), so the screen showed a director a
   * blocker only somebody else could clear.
   *
   * ★★ What stays with the kindergarten is the *working* surface:
   * `catalogForActor`, `read`, `write`, `myProfile` and
   * `studentRegistrationTemplate`. A director still pulls a roster and a
   * teacher still sends the day's attendance — none of that needs the token's
   * state, and none of it moved.
   *
   * ★★★ `assertSuperAdmin` answers **404**, not 403, so a director learns
   * nothing about the route (CLAUDE.md §1.7). The kindergarten is loaded after
   * the check, as everywhere else.
   */
  async overview(actor: Actor, kindergartenId: string) {
    this.platform.assertSuperAdmin(actor);
    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const recentRuns = await this.repo.listRecentRuns(kindergartenId);
    const deployment = this.esis.status();
    const mapped = Boolean(kindergarten.esisInstitutionId);
    const mappingMatchesDeployment = mapped;
    const canPreview = deployment.configured && mappingMatchesDeployment;
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
        const lastRun = recentRuns.find((run) =>
          Array.isArray(run.resources) ? run.resources.includes(endpoint.key) : false,
        );
        return {
          ...endpoint,
          accessStatus:
            endpoint.domain === "FOOD"
              ? ("NOT_ENABLED" as const)
              : deployment.configured
                ? ("UNKNOWN" as const)
                : ("NOT_ENABLED" as const),
          responseMode: "LIVE" as const,
          httpStatus: lastRun?.status === "SUCCEEDED" ? 200 : null,
          syncStatus:
            lastRun?.status === "SUCCEEDED"
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
      /*
       * The portal's request register, joined against what the code calls.
       *
       * ★ Static, and says so through `reviewedAt`. There is no ESIS service
       * that reports a token's own granted scope, so "is this approved?" can
       * only be answered from the register an operator reads off the portal.
       * Showing the date it was read is the difference between a snapshot and
       * a claim about right now.
       */
      requests: ESIS_REQUEST_REGISTER,
    };
  }

  async studentRegistrationTemplate(actor: Actor, kindergartenId: string) {
    this.tenants.assertStaff(actor, kindergartenId);
    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const student = ESIS_RESOURCE_CATALOG.find((endpoint) => endpoint.key === "students")!;

    /*
     * ★ Unmapped is a refusal now, not a fallback — 2026-09-14.
     *
     * This used to fall through to an invented record when the tenant had no
     * `esisInstitutionId`, so the registration form filled itself with a
     * fictional child and looked as though ESIS had answered. A form that
     * quietly invents its own contents is worse than one that says it has
     * nothing: the staff member cannot tell which of the values in front of
     * them came from the ministry.
     */
    if (!this.esis.isConfigured || !kindergarten.esisInstitutionId) {
      throw new ServiceUnavailableException(
        "ESIS холболт тохируулагдаагүй байна. Платформын оператор байгууллагын кодыг холбосны дараа ажиллана.",
      );
    }

    {
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
      const visible = this.visibleRows(actor, kindergartenId, response.data);
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
          rowValues("students", visible, 1)[0] ??
          Object.fromEntries(ingestedFieldNames("students").map((name) => [name, null])),
      };
    }
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

    /*
     * ★ An unconfigured deployment says so — 2026-09-14.
     *
     * It used to answer with an invented person, labelled `DEMO`. A member of
     * staff opening "миний ESIS мэдээлэл" and finding somebody else's name
     * under their own heading is the clearest case there was for removing the
     * samples: the label was in the payload, and a label is not a defence
     * against a screen that looks like it worked.
     */
    if (!this.esis.isConfigured || !kindergarten.esisInstitutionId) {
      throw new ServiceUnavailableException(
        "ESIS холболт тохируулагдаагүй байна. Платформын оператор байгууллагын кодыг холбосны дараа ажиллана.",
      );
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

    const visible = this.visibleRows(actor, kindergartenId, matches);
    return {
      mode: "LIVE" as const,
      resource,
      apiId: catalog.apiId,
      slug: catalog.slug,
      endpoint: catalog.path,
      syncedAt: new Date().toISOString(),
      institutionId: kindergarten.esisInstitutionId,
      fields: ESIS_FIELDS[resource],
      row: rowValues(resource, visible, 1)[0]!,
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
      canRead: deployment.configured,
      /*
       * ★ The catalog entry as it stands, with no sync state bolted on.
       *
       * `overview()` decorates each service with `accessStatus`, `syncStatus`,
       * `lastSyncAt` and the rest, all derived from the deployment and its run
       * history. None of that belongs in a teacher's payload, and adding an
       * `accessStatus: "UNKNOWN"` here — which an earlier version did — put a
       * field in the response whose only honest value was "we did not look".
       */
      /*
       * ★ `grant` and `portalName` are dropped here, not left to Zod.
       *
       * They are the deployment's ESIS account state — which scopes the
       * ministry granted it — and this payload's whole rule is that it carries
       * the catalog and none of the deployment. The browser's schema omits
       * them, so a stray field would be stripped on arrival and never show;
       * but "the client throws it away" is not the same as "the server does
       * not send it", and the second is the one a role boundary needs.
       */
      endpoints: ESIS_RESOURCE_CATALOG.filter((endpoint) => keys.has(endpoint.key)).map(
        ({ grant: _grant, portalName: _portalName, ...endpoint }) => endpoint,
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
  /**
   * One write to ESIS, for the "ЭСИС рүү илгээх" button on a child's record.
   *
   * ★ The same authorisation as a read, and deliberately so. `assertReadable`
   * asks whether *this* actor may reach *this* service in *this* kindergarten,
   * and the three write services are in the teacher's list beside the reads
   * they belong to. A separate write check would be a second place deciding
   * who may reach a service — the thing CLAUDE.md §1.1 exists to prevent.
   *
   * ★★ `institutionId` comes from the tenant's confirmed mapping, never from
   * the request. See `esisWriteSchema`'s note.
   *
   * ★★★ The audit row is `UPDATE`, not `VIEW`, and it records the resource and
   * the ESIS person the write was about — but not the payload. A household's
   * income band and a family's living conditions are what these services
   * carry, and copying them into an append-only table would keep, forever,
   * exactly the material `ESIS_REQUEST.md` restricts us to passing through.
   */
  async write(actor: Actor, kindergartenId: string, dto: EsisWriteDto) {
    const { institutionId } = await this.assertReadable(actor, kindergartenId, dto.resource);

    const body = { ...dto.payload, institutionId: Number(institutionId) };
    const personId = typeof dto.payload.personId === "number" ? dto.payload.personId : null;

    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisResource",
      objectId: dto.resource,
      metadata: { resource: dto.resource, personId },
    });

    try {
      const response = await this.esisWrite(dto.resource, body);
      return {
        resource: dto.resource,
        source: response.source,
        status: "SUCCEEDED" as const,
        errorCode: null,
        durationMs: response.durationMs,
        response: {
          SUCCESS_CODE: 200,
          RESPONSE_MESSAGE: "SUCCESS",
        },
      };
    } catch (error) {
      return {
        resource: dto.resource,
        source: "LIVE" as const,
        status: "FAILED" as const,
        errorCode: safeErrorCode(error),
        durationMs: null,
        response: { SUCCESS_CODE: 0, RESPONSE_MESSAGE: "FAILED" },
      };
    }
  }

  /**
   * Routes a write key to its own typed method.
   *
   * ★ A `switch` rather than a lookup table, because each upload schema has a
   * different shape and the parse belongs with the send. `EsisService` does
   * the parsing — the schemas are `.strict()`, so a key this product invented
   * fails here rather than at the ministry.
   */
  private esisWrite(resource: EsisWriteDto["resource"], body: Record<string, unknown>) {
    switch (resource) {
      case "studentContactsSave":
        return this.esis.saveStudentContacts(
          body as Parameters<EsisService["saveStudentContacts"]>[0],
        );
      case "studentStatisticsSave":
        return this.esis.saveStudentStatistics(
          body as Parameters<EsisService["saveStudentStatistics"]>[0],
        );
      case "studentConditionSave":
        return this.esis.saveStudentCondition(
          body as Parameters<EsisService["saveStudentCondition"]>[0],
        );

      /* ── Added 2026-09-15 with the health block ────────────────────────── */
      case "studentAllergySave":
        return this.esis.saveStudentAllergy(
          body as Parameters<EsisService["saveStudentAllergy"]>[0],
        );
      case "studentProhibitedFoodSave":
        return this.esis.saveStudentProhibitedFood(
          body as Parameters<EsisService["saveStudentProhibitedFood"]>[0],
        );
      case "studentDisabilitySave":
        return this.esis.saveStudentDisability(
          body as Parameters<EsisService["saveStudentDisability"]>[0],
        );
      case "studentAssessmentsSave":
        return this.esis.saveStudentAssessment(
          body as Parameters<EsisService["saveStudentAssessment"]>[0],
        );
      case "studentMeasurementSave":
        return this.esis.saveStudentMeasurement(
          body as Parameters<EsisService["saveStudentMeasurement"]>[0],
        );
      case "studentSurgerySave":
        return this.esis.saveStudentSurgery(
          body as Parameters<EsisService["saveStudentSurgery"]>[0],
        );
      case "studentIncidentSave":
        return this.esis.saveStudentIncident(
          body as Parameters<EsisService["saveStudentIncident"]>[0],
        );
      case "groupMeasurementsSave":
        return this.esis.saveGroupMeasurements(
          body as Parameters<EsisService["saveGroupMeasurements"]>[0],
        );
      case "studentScreeningSave":
        return this.esis.saveStudentScreening(
          body as Parameters<EsisService["saveStudentScreening"]>[0],
        );
    }
  }

  /**
   * The rows this caller may see.
   *
   * ★ One gate, applied by every method that returns ESIS rows to a client.
   *
   * Register numbers reach this service because `esisDiscoveredSchema`
   * deliberately keeps them (`ESIS_IDENTIFIER_FIELDS`). An administrator of
   * this kindergarten is reconciling children against the ministry's roster
   * and needs one; a teacher reading the same service does not, and a guardian
   * must never.
   *
   * ★★ `hasRoleIn(…, kindergartenId)` rather than the actor's role alone: an
   * ADMIN of *another* kindergarten is not an admin here. This runs after the
   * route's own tenant check, never instead of it.
   *
   * ★★★ `myProfile` routes through this same rule, which means an ADMIN
   * opening their *own* "миний ESIS мэдээлэл" screen sees their own register
   * number — a narrower reading of the policy would say "no register number
   * on `my-profile`, full stop." This is deliberate: it is one role-based
   * rule applied uniformly rather than a route-by-route carve-out.
   *
   * ★★★★ **The "already visible via `resource=staff`" argument covers every
   * field `myProfile` returns, not only the identifiers — checked, not
   * assumed.** `esisServicesForActor` gives an ADMIN `ALL_KEYS`
   * (`esis.catalog.ts`), so both branches `myProfile` can choose —
   * `resource=teachers` and `resource=staff` — are ones that admin can already
   * call directly. Both routes draw their displayed columns from the same
   * source: `myProfile`'s `row` is `rowValues(resource, visible, 1)` with no
   * `fields` argument, which falls back to the static `ingestedFieldNames
   * (resource)`; `read()`'s `rows` for the same resource key uses
   * `esisFieldsFor(resource, visible)`, which returns exactly that declared
   * list plus anything *undeclared* the row carries — and `staff`/`teachers`
   * parse through `esisStaffSchema`/`esisTeacherSchema`, plain `z.object()`
   * schemas that drop unnamed keys at parse time, so no row reaching either
   * method can carry an undeclared field to discover. Same field set, same
   * values, for the same person's row. The one difference is row *count*:
   * `myProfile` renders one row, `read()` up to `READ_ROWS` — so `myProfile`
   * is a strict subset of what `resource=staff`/`resource=teachers` already
   * shows that admin, never a superset. A non-admin caller — every teacher and
   * cook this screen actually serves — still sees no register number either
   * way.
   *
   * The one thing `myProfile` shows that a `read()` row does not is metadata
   * about the *call*, not the ESIS record — `apiId`, `slug`, `institutionId`,
   * `syncedAt`. None of it is drawn from `rowValues`, none of it is gated by
   * this method, and none of it is new to an admin who already performed the
   * institution mapping themselves.
   */
  private visibleRows<T>(actor: Actor, kindergartenId: string, rows: T[]): T[] {
    return esisVisibleRows(rows, {
      identifiers: hasRoleIn(actor, Role.ADMIN, kindergartenId),
    });
  }

  private async assertReadable(actor: Actor, kindergartenId: string, resource?: EsisEndpointKey) {
    /*
     * ★ Tenant first, then the service — 2026-09-09.
     *
     * This asserted `assertAdmin` outright until the teacher's screens got
     * their role-scoped services. It now asks whether *this* actor may read *this*
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

    return this.assertOperable(kindergartenId);
  }

  /**
   * May this actor read *this child's* ESIS record?
   *
   * ★ **The subject was never checked until 2026-09-15.** `assertReadable`
   * asks whether the caller belongs to the tenant and whether their role
   * reaches the service. Neither question is about the child, and every
   * per-child ESIS service is addressed by a `personId` the caller supplies —
   * which `students` hands out for the whole roster. So a teacher of one group
   * could read another group's харшил, хөгжлийн бэрхшээл or хэмжилт by
   * substituting an id. That is CLAUDE.md §4.1's first case, and §1.1's rule
   * that authorization lives in one module: `canAccessChild` is that module,
   * and this is what lets it run on an ESIS id.
   *
   * ★★ **An admin is exempt, and the exemption is not a shortcut.**
   * `isAdminOver` passes for every child of a kindergarten they administer, so
   * the check can only ever answer yes for them. Running it anyway would add a
   * query and, worse, make an admin's read fail for a child whose ESIS id
   * nobody has proven yet — refusing access the rule itself would grant.
   *
   * ★★★ **Unproven means refused**, for everyone else. `esisPersonId` is
   * written only where the product has established the match against the live
   * roster; a child without one cannot be attributed, and "we do not know
   * whose record this is" is not a reason to show it. 404, never 403 (§1.7) —
   * the caller learns nothing about whether the id exists.
   */
  private async assertCanReadEsisChild(
    actor: Actor,
    kindergartenId: string,
    resource: EsisReadableKey,
    params: Record<string, string>,
  ) {
    const personId = params.personId;
    if (!personId) return;
    if (!esisReaderParams(resource).includes("personId")) return;

    const admin = actor.memberships.some(
      (membership) => membership.kindergartenId === kindergartenId && membership.role === "ADMIN",
    );
    if (admin) return;

    const child = await this.repo.findChildIdByEsisPersonId(kindergartenId, personId);
    if (!child) throw new NotFoundException();
    await this.children.assertCanAccess(actor, child.id);
  }

  /**
   * Whether a call can be attempted for this tenant, and under which id.
   *
   * ★ Authorisation is **not** here, and must run before it. Split out of
   * `assertReadable` on 2026-09-14 so the platform operator's dry run can
   * reach it after `assertSuperAdmin` — a superadmin holds no `Membership`
   * (CLAUDE.md §1.1), so every membership-derived check answers 404 for them
   * and `assertReadable` cannot be the seam. Each caller states its own
   * authorisation on the line above; this one answers only "is the deployment
   * configured and this kindergarten mapped?".
   */
  private async assertOperable(kindergartenId: string) {
    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const deployment = this.esis.status();
    if (!deployment.configured) {
      throw new ServiceUnavailableException("ESIS холболт server дээр тохируулагдаагүй байна.");
    }
    if (!kindergarten.esisInstitutionId) {
      throw new ConflictException("Цэцэрлэгийн ESIS байгууллагын код баталгаажаагүй байна.");
    }
    return { kindergarten, institutionId: kindergarten.esisInstitutionId };
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

    /*
     * ★ The subject check, after the tenant and the service and before the
     * audit row. It must not run before `assertReadable` — a caller outside
     * the tenant should learn nothing, not even that the id resolved — and it
     * must not run after the call, which would already have fetched the
     * record. See `assertCanReadEsisChild`.
     */
    await this.assertCanReadEsisChild(actor, kindergartenId, dto.resource, params);

    /*
     * ★ The audit row records the lookup, not the person looked up.
     *
     * `params` carried every path value straight into `AuditLog.metadata`,
     * which for `studentByRegister` means writing a child's register number
     * into an append-only table — the one identifier `ESIS_REQUEST.md` §1.1 (b)
     * promises the ministry this product does not keep. It is sent to ESIS and
     * kept nowhere, and "nowhere" has to include the row that says somebody
     * asked.
     *
     * The rest stay: a group id, a date and an academic month are what make the
     * entry answerable later, and none of them is a person.
     *
     * ★★ **`primaryNidNumber` joined it on 2026-09-14**, with `workerInfo`.
     * This filter named one key, and the new service takes a *worker's*
     * register number rather than a child's — so the same identifier this
     * paragraph promises not to keep would have started landing in the
     * append-only table under a different name. A register number is a
     * register number whoever it belongs to.
     *
     * ★★★ The list is what needs widening when a reader takes a new personal
     * identifier. It is written as a set rather than a chain of `!==` so that
     * adding one is a single obvious edit.
     */
    const auditedParams = Object.fromEntries(
      Object.entries(params).filter(([name]) => !REDACTED_READ_PARAMS.has(name)),
    );

    await this.audit.append({
      action: "VIEW",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisResource",
      objectId: dto.resource,
      metadata: { resource: dto.resource, params: auditedParams },
    });

    const fields = ESIS_FIELDS[dto.resource];
    try {
      const response = await this.esis.read(dto.resource, params, institutionId);
      const rowLimit = dto.resource === "foodProducts" ? response.data.length : READ_ROWS;
      /*
       * ★ `esisFieldsFor`, not `fields`, is what this screen shows — 2026-09-15.
       *
       * Every declared column still comes back whether or not this response
       * carried it: that half is unconditional, and it is why `fields` above
       * stays around for the `catch` block below, where there is no response
       * to read a discovered key off of. Columns derived from data would make
       * "ESIS stopped sending this field" and "this child has no value" the
       * same picture on screen, and only one of those is worth investigating.
       *
       * What is no longer true of this call is that the discovered half was
       * six services' business. A hand-written schema used to drop whatever it
       * did not name, so nothing beyond those six could ever surprise this
       * screen with an extra key. Readers now keep what they are not told to
       * expect, so any resource can carry one — and an operator comparing this
       * table against the ministry's real payload needs to see it, not have it
       * silently dropped because this call site still trusted the old six.
       */
      /*
       * ★ The gate runs on `response.data`, before either `esisFieldsFor` or
       * `rowValues` reads it — 2026-09-15. Both derive their output from the
       * rows they are given, so a register number stripped afterwards would
       * already have been drawn into a column or a display value. See
       * `visibleRows`.
       */
      const visible = this.visibleRows(actor, kindergartenId, response.data);
      const liveFields = esisFieldsFor(dto.resource, visible);
      const rows = rowValues(dto.resource, visible, rowLimit, liveFields);
      return {
        resource: dto.resource,
        endpoint: calledEndpoint(dto.resource),
        source: response.source,
        status: "SUCCEEDED" as const,
        errorCode: null,
        count: response.data.length,
        durationMs: response.durationMs,
        fields: liveFields,
        rows,
        response: {
          SUCCESS_CODE: 200,
          RESPONSE_MESSAGE: "SUCCESS",
          RESULT: rows.slice(0, ENVELOPE_ROWS),
        },
      };
    } catch (error) {
      return {
        resource: dto.resource,
        endpoint: calledEndpoint(dto.resource),
        source: "LIVE" as const,
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

  /**
   * The dry run behind "Синк шалгалт".
   *
   * ★ **Superadmin, with `overview()`** — moved 2026-09-14. It is the same
   * screen and the same question: it spends the deployment's token against the
   * ministry's rate limits to prove the connection works, which is the
   * operator's job and not a director's. The working "ESIS-ээс татах" buttons
   * are `read()`, and they did not move.
   */
  async preview(actor: Actor, kindergartenId: string, dto: EsisPreviewDto) {
    this.platform.assertSuperAdmin(actor);
    const { institutionId } = await this.assertOperable(kindergartenId);
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
        /*
         * ★ Gated like every other reader — 2026-09-15. `assertSuperAdmin`
         * above proves this caller operates the platform, not that they
         * administer *this* kindergarten, and `visibleRows` asks exactly that
         * question. A superadmin dry run exists to prove the connection
         * works, which a row count and a set of field names already answer;
         * it does not need a register number to do it.
         */
        const visible = this.visibleRows(actor, kindergartenId, response.data);
        return {
          resource,
          count: response.data.length,
          durationMs: response.durationMs,
          preview: rowValues(resource, visible, PREVIEW_ROWS),
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
            source: "LIVE" as const,
          };
    });
    const successCount = results.filter((result) => result.status === "SUCCEEDED").length;
    const status =
      successCount === results.length ? "SUCCEEDED" : successCount === 0 ? "FAILED" : "PARTIAL";
    const summary = {
      mode: "LIVE" as const,
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
      () => Promise<{ data: unknown[]; durationMs: number; source: "LIVE" }>
    > = {
      organization: () => this.esis.organization(institutionId),
      buildings: () => this.esis.buildings(institutionId),
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
      // Added 2026-09-10 with the new institution-level reads that need no
      // operator input — which is exactly what `ESIS_PREVIEW_RESOURCES` means.
      // `studentContacts` left on 2026-09-14: it needs a `personId`, so it was
      // never one of them. See the catalog's note.
      groupsNextYear: () => this.esis.groupsNextYear(institutionId),
      programs: () => this.esis.programs(institutionId),
      rooms: () => this.esis.rooms(institutionId),
      academicOrg: () => this.esis.academicOrg(institutionId),
      subjectAreas: () => this.esis.subjectAreas(institutionId),
    };
    return calls[resource]();
  }
}

/**
 * Path values that must never reach `AuditLog.metadata`.
 *
 * Both are register numbers an operator types — one a child's
 * (`studentByRegister`, `studentInfo`), one a worker's (`workerInfo`). They are
 * sent to ESIS and kept nowhere, and "nowhere" includes the row recording that
 * somebody asked. `ESIS_REQUEST.md` §1.1 (b).
 */
const REDACTED_READ_PARAMS = new Set(["personRegNumber", "primaryNidNumber"]);

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
 * credentials — provider passwords and the username beside them — are
 * already gone, stripped by the zod schema one layer up; this function could
 * not surface one even if a schema were widened by mistake.
 *
 * ★★★ **Register numbers are a different case — 2026-09-15.** They are no
 * longer refused at the parser (`ESIS_IDENTIFIER_FIELDS`), and this function
 * has no notion of *who is asking*, so it draws a `civilId`/`personRegNumber`
 * column for any caller reachable here. The gate is `EsisAdminService.
 * visibleRows`, and every caller of `rowValues` in this file passes rows that
 * have already been through it — `read`, `myProfile` and
 * `studentRegistrationTemplate` each call `visibleRows` first, so a value this
 * function draws into a column was one the caller was allowed to see. If a
 * new call site adds `rowValues` without gating its rows first, this is the
 * hole that reopens.
 */
/**
 * The service a read called, for the screen to name when nothing came back.
 *
 * ★ Method and path only — deliberately not `apiId` or `slug`. Those two
 * identify the service in the ministry's *register*, which is the operator's
 * vocabulary; the path is what a person reads as an address and what they
 * quote when they raise the failure. The operator screen already shows all
 * four together and is welcome to.
 */
function calledEndpoint(resource: EsisEndpointKey): { method: string; path: string } {
  const endpoint = ESIS_ENDPOINTS[resource];
  return { method: endpoint.method, path: endpoint.path };
}

function rowValues(
  resource: EsisEndpointKey,
  rows: unknown[],
  limit: number,
  /** The discovered list, when the service has no declared one. */
  fields?: { name: string; io: string; ingested: boolean }[],
) {
  const names = fields
    ? fields.filter((field) => field.io === "OUTPUT" && field.ingested).map((field) => field.name)
    : ingestedFieldNames(resource);
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

/*
 * ★ Always `"LIVE"` — 2026-09-14.
 *
 * This used to read `mode` off a stored sync-run summary and answer `"MOCK"`
 * for runs made in demo mode. Demo mode is gone, so no new run can be one;
 * historical rows that say `MOCK` keep their summary in the database and are
 * now reported as what every run is from here on. Reading the old value back
 * would put a `MOCK` badge on a screen with no way to produce another.
 */
function syncRunMode(_summary: unknown): "LIVE" {
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
