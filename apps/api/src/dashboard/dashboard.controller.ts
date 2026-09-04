import { Controller, Get, Query } from "@nestjs/common";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { DashboardService } from "./dashboard.service";
import { AuditReadService } from "./audit-read.service";

const auditQuerySchema = paginationQuerySchema.extend({
  childId: uuidSchema.optional(),
  actorUserId: uuidSchema.optional(),
  action: z
    .enum([
      "LOGIN",
      "LOGIN_FAILED",
      "LOGOUT",
      "VIEW",
      "CREATE",
      "UPDATE",
      "DELETE",
      "RESTORE",
      "DOWNLOAD",
      "PERMISSION_CHANGE",
      "PASSWORD_RESET",
      "INVITE",
      "ACTIVATE",
    ])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
type AuditQuery = z.infer<typeof auditQuerySchema>;

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  /** Where to send this user after login — one rule, server-side. */
  @Get("primary")
  async primary(@CurrentActor() actor: Actor) {
    return { dashboard: this.service.primaryDashboard(actor) };
  }

  @Get("teacher")
  @Roles("TEACHER", "ADMIN")
  async teacher(@CurrentActor() actor: Actor) {
    return this.service.teacher(actor);
  }

  @Get("admin")
  @Roles("ADMIN")
  async admin(@CurrentActor() actor: Actor) {
    return this.service.admin(actor);
  }

  @Get("cook")
  @Roles("COOK", "ADMIN")
  async cook(@CurrentActor() actor: Actor) {
    return this.service.cook(actor);
  }

  /**
   * No `@Roles("PARENT")`.
   *
   * The feed is built from the actor's *guardianships*, so a teacher whose own
   * child attends gets their own child's feed and nothing else. A role gate
   * would exclude them from a screen that is legitimately theirs.
   */
  @Get("parent")
  async parent(@CurrentActor() actor: Actor) {
    return this.service.parent(actor);
  }
}

/**
 * The audit log — read only.
 *
 * There is deliberately no write endpoint. Entries are appended internally by
 * the services that perform the actions; an API that could write them would let
 * a caller forge history.
 */
@Controller("audit")
export class AuditController {
  constructor(private readonly service: AuditReadService) {}

  @Get()
  @Roles("ADMIN")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ) {
    return this.service.list(actor, query);
  }
}
