import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { idParamSchema, paginationQuerySchema, type PaginationQuery } from "@kinder/contracts";
import { CurrentActor } from "../../auth/decorators/actor.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { SuperAdmin } from "../../auth/decorators/super-admin.decorator";
import type { Actor } from "../../authz/actor";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { EsisAdminService } from "./esis-admin.service";
import { EsisSyncService } from "./esis-sync.service";
import { EsisWriteRequestService } from "./esis-write.service";
import {
  esisPreviewSchema,
  esisReadSchema,
  esisSyncTierSchema,
  esisWriteParamSchema,
  esisWriteSchema,
  prepareEsisGroupWriteSchema,
  updateEsisMappingSchema,
  type EsisPreviewDto,
  type EsisReadDto,
  type EsisSyncTierDto,
  type EsisWriteDto,
  type EsisWriteParams,
  type PrepareEsisGroupWriteDto,
  type UpdateEsisMappingDto,
} from "./esis.dto";

/** `?resource=groups&studentGroupId=10001` — path values arrive flat. */
const esisReadQuerySchema = esisReadSchema.shape.params
  .unwrap()
  .extend({ resource: esisReadSchema.shape.resource })
  .transform(({ resource, ...params }) => ({ resource, params }) satisfies EsisReadDto);

@Controller("kindergartens/:id/esis")
@Roles("ADMIN")
export class KindergartenEsisController {
  constructor(
    private readonly service: EsisAdminService,
    private readonly sync: EsisSyncService,
    private readonly writes: EsisWriteRequestService,
  ) {}

  /**
   * The catalog, scoped to the caller's role.
   *
   * ★ Separate from the operator's `overview()`, which is on
   * `PlatformEsisController` — token state, base URL, granted scope, blockers,
   * run history — and the working screens need none of it. See
   * `catalogForActor`.
   */
  @Get("catalog")
  @Roles("ADMIN", "TEACHER", "COOK", "ACCOUNTANT")
  catalog(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.catalogForActor(actor, params.id);
  }

  /** Minimized ESIS student output for the staff child-registration form. */
  @Get("student-registration-template")
  @Roles("ADMIN", "TEACHER")
  studentRegistrationTemplate(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.studentRegistrationTemplate(actor, params.id);
  }

  /** Teacher/staff ESIS fields matched to the authenticated user's identity. */
  @Get("my-profile")
  @Roles("ADMIN", "TEACHER", "COOK", "ACCOUNTANT")
  myProfile(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.myProfile(actor, params.id);
  }

  /**
   * One read-only fetch, for the "ESIS-ээс татах" button on a working screen.
   *
   * A `GET` because it changes no NomadKids record — the only row it writes is
   * the `AuditLog` entry that says who looked.
   */
  @Get("resource")
  @Roles("ADMIN", "TEACHER", "COOK", "ACCOUNTANT")
  read(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(esisReadQuerySchema)) query: EsisReadDto,
  ) {
    return this.service.read(actor, params.id, query);
  }

  /**
   * Refills this kindergarten's stored staff roster from live ESIS.
   *
   * ★ ADMIN-only and a `POST`, not a `GET` — it spends the deployment's token
   * against the ministry's rate limits, which a read-only route must not
   * shrug off as free. `@HttpCode(200)` rather than Nest's default 201: this
   * replaces the whole table (Task 3's repository note) rather than creating
   * a resource, so "200 with a summary" reads truer than "201 Created".
   */
  @Post("staff-roster/refresh")
  @HttpCode(200)
  @Roles("ADMIN")
  refreshStaffRoster(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.refreshStaffRoster(actor, params.id);
  }

  /**
   * One write to ESIS.
   *
   * ★ `@Roles` mirrors `read` above rather than narrowing to ADMIN: the three
   * write services sit on a child's record and the teacher is who fills them
   * in. The service still decides — `assertReadable` answers 404 for a service
   * outside the caller's own list, which is the check that actually gates this.
   */
  @Post("write")
  @Roles("ADMIN", "TEACHER")
  write(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(esisWriteSchema)) body: EsisWriteDto,
  ) {
    return this.service.write(actor, params.id, body);
  }

  /**
   * The manual pull — plan Task 5.
   *
   * ★ ADMIN-only and a `POST`, for the same reason as `staff-roster/refresh`
   * above: it spends the deployment's one rate-limited token, whichever tier
   * is asked for. It calls the **same** `EsisSyncService` methods the
   * scheduler (Task 8) will, with `actor.userId` set — one code path, one run
   * record, a history where a manual run and a scheduled one differ only in
   * who started them.
   */
  @Post("sync")
  @HttpCode(200)
  @Roles("ADMIN")
  runSync(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(esisSyncTierSchema)) body: EsisSyncTierDto,
  ) {
    return this.sync.sync(actor, params.id, body.tier);
  }

  /*
   * ── Бүлгийн бичих гурав, spec №3б ──────────────────────────────────────
   *
   * ★ **ADMIN only**, unlike `write` above. That route's `@Roles` includes
   * TEACHER because the three child-record saves behind it are a teacher's own
   * fields, filled in and sent back. A group write changes the ministry's
   * register of this kindergarten's classes, which the client's 2026-09-14 rule
   * puts on the director.
   *
   * ★★ A separate path from `write`, not a fourth resource on it. Sharing the
   * route would mean sharing its `@Roles` and its immediacy — no stored
   * payload, no approval, nothing to show anyone before it went.
   */
  @Post("group-writes")
  @Roles("ADMIN")
  prepareGroupWrite(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(prepareEsisGroupWriteSchema)) body: PrepareEsisGroupWriteDto,
  ) {
    return this.writes.prepare(actor, params.id, body);
  }

  /** The approval that sends it — enqueued after the commit, never inside it. */
  @Post("group-writes/:writeId/approve")
  @HttpCode(200)
  @Roles("ADMIN")
  approveGroupWrite(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(esisWriteParamSchema)) params: EsisWriteParams,
  ) {
    return this.writes.approve(actor, params.id, params.writeId);
  }

  /** Thought better of, before anything was sent. */
  @Post("group-writes/:writeId/cancel")
  @HttpCode(200)
  @Roles("ADMIN")
  cancelGroupWrite(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(esisWriteParamSchema)) params: EsisWriteParams,
  ) {
    return this.writes.cancel(actor, params.id, params.writeId);
  }

  /** Every write this kindergarten has sent or is about to — paginated (§3.4). */
  @Get("group-writes")
  @Roles("ADMIN")
  listGroupWrites(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.writes.list(actor, params.id, query);
  }

  /** The run history behind the sync panel — newest first, paginated (CLAUDE.md §3.4). */
  @Get("sync-runs")
  @Roles("ADMIN")
  syncRuns(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.sync.listRuns(actor, params.id, query);
  }
}

/**
 * The platform operator's ESIS routes.
 *
 * ★ `overview` and `preview` moved here from the kindergarten controller on
 * 2026-09-14, at the client's request ("superadmin дээр байх нь зөв"). Every
 * fact they carry belongs to the deployment rather than to a tenant: one ESIS
 * developer account and one `ESIS_TOKEN` serve every kindergarten, the granted
 * scope is that account's, and the institution mapping below was already
 * superadmin-only — so the old screen showed a director blockers only somebody
 * else could clear. The tenant's working routes — `catalog`, `resource`,
 * `write`, `my-profile` — stayed exactly where they were.
 */
@Controller("platform/kindergartens/:id/esis")
@SuperAdmin()
export class PlatformEsisController {
  constructor(private readonly service: EsisAdminService) {}

  @Get()
  overview(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.overview(actor, params.id);
  }

  @Post("preview")
  preview(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(esisPreviewSchema)) body: EsisPreviewDto,
  ) {
    return this.service.preview(actor, params.id, body);
  }

  @Put("mapping")
  updateMapping(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateEsisMappingSchema)) body: UpdateEsisMappingDto,
  ) {
    return this.service.updateMapping(actor, params.id, body);
  }
}
