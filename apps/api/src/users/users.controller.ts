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
} from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { UsersService } from "./users.service";
import {
  addMembershipSchema,
  changeMembershipRoleSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateProfileSchema,
  updateUserSchema,
  type AddMembershipDto,
  type ChangeMembershipRoleDto,
  type CreateUserDto,
  type ListUsersQuery,
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

  // ── User administration ───────────────────────────────────────────────────

  @Get("users")
  @Roles("ADMIN")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ) {
    return this.service.list(actor, query);
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
