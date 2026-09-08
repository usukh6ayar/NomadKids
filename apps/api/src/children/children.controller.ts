import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { MAX_SPREADSHEET_BYTES } from "../media/upload-validation";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import type { Actor } from "../authz/actor";
import { ChildrenService } from "./children.service";
import {
  addGuardianSchema,
  inviteGuardianSchema,
  createChildSchema,
  endEnrollmentSchema,
  enrollSchema,
  listChildrenQuerySchema,
  updateChildSchema,
  updateGuardianshipSchema,
  type AddGuardianDto,
  type InviteGuardianDto,
  type CreateChildDto,
  type EndEnrollmentDto,
  type EnrollDto,
  type ListChildrenQuery,
  type UpdateChildDto,
  type UpdateGuardianshipDto,
} from "./children.dto";

@Controller()
export class ChildrenController {
  constructor(private readonly service: ChildrenService) {}

  /**
   * A parent's own children.
   *
   * Declared before `/children/:id` so the literal path is not captured by the
   * parameterised route.
   */
  @Get("children/mine")
  async listOwn(@CurrentActor() actor: Actor) {
    return this.service.listOwnChildren(actor);
  }

  /** No `@Roles` — every role has children they may see, and the service decides which. */
  @Get("children")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listChildrenQuerySchema)) query: ListChildrenQuery,
  ) {
    return this.service.list(actor, query);
  }

  /*
   * ★ Declared before `children/:id`, and that ordering is load-bearing.
   *
   * Nest matches routes in declaration order, so a `:id` parameter registered
   * first would swallow `/children/summary` and hand "summary" to the child
   * lookup — which answers 404, the same status an unauthorized child gets.
   * The bug would read as a permissions problem rather than a routing one.
   */
  @Get("children/summary")
  async summary(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listChildrenQuerySchema)) query: ListChildrenQuery,
  ) {
    return this.service.rosterSummary(actor, query);
  }

  @Get("children/:id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Post("kindergartens/:id/children")
  @Roles("ADMIN", "TEACHER")
  async create(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createChildSchema)) body: CreateChildDto,
  ) {
    return this.service.create(actor, params.id, body);
  }

  /**
   * The roster as a spreadsheet — RFP §12.3.
   *
   * Takes the same query as the list, so "export what I am looking at" works:
   * the filters an administrator has already set on screen apply to the file.
   */
  @Get("kindergartens/:id/children/export")
  @Roles("ADMIN", "TEACHER")
  async exportRoster(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listChildrenQuerySchema)) query: ListChildrenQuery,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.exportRoster(actor, params.id, query);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /**
   * The roster a kindergarten's finance staff may invoice — нэмэлт.md §7.
   *
   * ★ `GET children` above has no `@Roles` because `list()`'s
   * `visibleChildrenWhere` decides who is in it — and that filter
   * deliberately has no accountant chain (`ChildrenService.financeRoster`'s
   * own comment explains why: it is `canAccessChild`'s filter, not
   * `canViewChildFinance`'s). This route is the money axis's own list, so an
   * accountant's invoice-generation screen has a roster to pick a child from.
   */
  @Get("kindergartens/:id/children/finance-roster")
  @Roles("ADMIN", "ACCOUNTANT")
  async financeRoster(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Query(new ZodValidationPipe(listChildrenQuerySchema)) query: ListChildrenQuery,
  ) {
    return this.service.financeRoster(actor, params.id, query);
  }

  /**
   * Imports a roster from a spreadsheet — RFP §3.4.
   *
   * ★ `?dryRun=true` validates and reports without writing, which is the whole
   * point: an administrator sees exactly which rows will land and which will
   * not before anything is created.
   *
   * ★★ The multer limit is a *second* ceiling, in front of the one
   * `validateSpreadsheetUpload` enforces. This one stops the bytes ever
   * reaching the process; that one is what the parser trusts. Neither is
   * redundant — a body-size guard cannot know a `.xlsx` from an executable,
   * and a content check that runs after 900 MB is already in memory is too
   * late.
   */
  @Post("kindergartens/:id/children/import")
  @Roles("ADMIN", "TEACHER")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_SPREADSHEET_BYTES, files: 1 } }),
  )
  async importChildren(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Query("dryRun") dryRun?: string,
  ) {
    if (!file) throw new BadRequestException("Файл сонгоно уу");

    // Defaults to a dry run. An import that writes by default is one misplaced
    // click away from five hundred children nobody meant to create.
    return this.service.importFromWorkbook(actor, params.id, file.buffer, dryRun !== "false");
  }

  @Patch("children/:id")
  @Roles("ADMIN", "TEACHER")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateChildSchema)) body: UpdateChildDto,
  ) {
    return this.service.update(actor, params.id, body);
  }

  @Delete("children/:id")
  @Roles("ADMIN")
  async archive(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.archive(actor, params.id);
  }

  // ── Guardianships ─────────────────────────────────────────────────────────

  @Get("children/:id/guardians")
  async listGuardians(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listGuardians(actor, params.id);
  }

  @Post("children/:id/guardians")
  @Roles("ADMIN")
  async addGuardian(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(addGuardianSchema)) body: AddGuardianDto,
  ) {
    return this.service.addGuardian(actor, params.id, body);
  }

  /**
   * Invites a guardian who has no account yet.
   *
   * Teacher-level, unlike `POST children/:id/guardians` — see the service for
   * why the two differ. The response carries the invitation token so the caller
   * can show it as a QR code; it is never logged.
   */
  @Post("children/:id/guardian-invitations")
  @Roles("TEACHER", "ADMIN")
  async inviteGuardian(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(inviteGuardianSchema)) body: InviteGuardianDto,
  ) {
    return this.service.inviteGuardian(actor, params.id, body);
  }

  /**
   * An admin manages the whole relationship; a guardian may correct only their
   * own relationship label. The service enforces that distinction from the
   * resource itself, so this cannot be expressed by a route-level role list.
   */
  @Patch("guardianships/:id")
  async updateGuardianship(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateGuardianshipSchema)) body: UpdateGuardianshipDto,
  ) {
    return this.service.updateGuardianship(actor, params.id, body);
  }

  // ── Enrollment ────────────────────────────────────────────────────────────

  @Get("children/:id/enrollments")
  async listEnrollments(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.listEnrollments(actor, params.id);
  }

  /**
   * The "Цэцэрлэг, бүлгийн архив" read — current placement, homeroom teachers,
   * past placements. No `@Roles`: a guardian and staff both reach it, and the
   * service's `assertCanAccess` is the real gate.
   */
  @Get("children/:id/enrollment-archive")
  async enrollmentArchive(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.getEnrollmentArchive(actor, params.id);
  }

  @Post("children/:id/enrollments")
  @Roles("ADMIN")
  async enroll(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(enrollSchema)) body: EnrollDto,
  ) {
    return this.service.enroll(actor, params.id, body);
  }

  @Patch("enrollments/:id")
  @Roles("ADMIN")
  async endEnrollment(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(endEnrollmentSchema)) body: EndEnrollmentDto,
  ) {
    return this.service.endEnrollment(actor, params.id, body);
  }
}
