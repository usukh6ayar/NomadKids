import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RateLimit, RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import {
  startPhoneVerificationSchema,
  type StartPhoneVerificationDto,
} from "../phone-verification/phone-verification.dto";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { UsersService } from "./users.service";
import {
  addMembershipSchema,
  changeMembershipRoleSchema,
  createUserSchema,
  listPositionsQuerySchema,
  listUsersQuerySchema,
  updateProfileSchema,
  updateMembershipProfileSchema,
  updateUserSchema,
  type AddMembershipDto,
  type ChangeMembershipRoleDto,
  type CreateUserDto,
  type ListPositionsQuery,
  type ListUsersQuery,
  type UpdateMembershipProfileDto,
  type UpdateProfileDto,
  type UpdateUserDto,
} from "./users.dto";

@Controller()
export class UsersController {
  constructor(private readonly service: UsersService) {}

  // ── Own profile — any authenticated user ──────────────────────────────────
  //
  // Declared before the admin routes so `/me/profile` is not captured by a
  // parameterised path.

  @Get("me/profile")
  async getOwnProfile(@CurrentActor() actor: Actor) {
    return this.service.getOwnProfile(actor);
  }

  @Patch("me/profile")
  async updateOwnProfile(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileDto,
  ) {
    return this.service.updateOwnProfile(actor, body);
  }

  /** Starts proving a new phone number before `PATCH me/profile` saves it. */
  @Post("me/phone-verification")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: 60 * 60 * 1000, byUser: true })
  async startOwnPhoneVerification(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(startPhoneVerificationSchema)) body: StartPhoneVerificationDto,
    @Req() req: Request,
  ) {
    return this.service.startOwnPhoneVerification(actor, body.phone, req.ip ?? null);
  }

  // ── User administration ───────────────────────────────────────────────────

  @Get("users")
  @Roles("ADMIN")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ) {
    return this.service.list(actor, query);
  }

  /** «Excel татах». Declared before `users/:id`, which would take "export" as an id. */
  /** «Албан тушаал» filter choices — declared before `users/:id`, like export. */
  @Get("users/positions")
  @Roles("ADMIN")
  async listPositions(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listPositionsQuerySchema)) query: ListPositionsQuery,
  ) {
    return this.service.listPositions(actor, query);
  }

  @Get("users/export")
  @Roles("ADMIN")
  async exportStaff(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportStaff(actor, query);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get("users/:id")
  @Roles("ADMIN")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Post("kindergartens/:id/users")
  @Roles("ADMIN")
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserDto,
  ) {
    return this.service.create(actor, params.id, body);
  }

  @Patch("users/:id")
  @Roles("ADMIN")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  /**
   * A one-time password-reset link for a member of staff, handed over by the
   * administrator. See `UsersService.issuePasswordReset` — it issues a link and
   * never sets a password.
   */
  @Post("users/:id/password-reset")
  @Roles("ADMIN")
  async issuePasswordReset(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.issuePasswordReset(actor, params.id);
  }

  @Post("users/:id/memberships")
  @Roles("ADMIN")
  async addMembership(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(addMembershipSchema)) body: AddMembershipDto,
  ) {
    return this.service.addMembership(actor, params.id, body);
  }

  /**
   * Moves a member of staff to another role — "албан тушаал солих".
   *
   * ★ `PATCH` on the membership rather than a delete-then-post pair from the
   * client: between those two calls the person holds no role at all, and a
   * failure on the second leaves them with none. See `changeMembershipRole`.
   */
  @Patch("memberships/:id")
  @Roles("ADMIN")
  async changeMembershipRole(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(changeMembershipRoleSchema)) body: ChangeMembershipRoleDto,
  ) {
    return this.service.changeMembershipRole(actor, params.id, body);
  }

  /** A membership's «Албан тушаал», «Ангилал» and start date. */
  @Patch("memberships/:id/profile")
  @Roles("ADMIN")
  async updateMembershipProfile(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateMembershipProfileSchema)) body: UpdateMembershipProfileDto,
  ) {
    return this.service.updateMembershipProfile(actor, params.id, body);
  }

  /** Deactivates, never deletes — the record of the role has to survive. */
  @Delete("memberships/:id")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeMembership(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ): Promise<void> {
    await this.service.revokeMembership(actor, params.id);
  }
}
