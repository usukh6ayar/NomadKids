import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { CatalogRepository } from "./catalog.repository";
import type {
  CreateDomainDto,
  CreateLevelDto,
  CreateObservationTypeDto,
  UpdateDomainDto,
  UpdateLevelDto,
  UpdateObservationTypeDto,
} from "./catalog.dto";

/**
 * Administrator-editable configuration — RFP §2.1, §5.2, §6.1, §6.2.
 *
 * ★ Three rules run through every method here.
 *
 * **1. A system row is readable, never writable.** `kindergartenId = NULL` is a
 * default shared by every kindergarten. A director may build on one; editing it
 * would change another tenant's configuration. The repository enforces this by
 * loading writes through a scope that cannot match a null, so the failure is a
 * 404 at the load rather than a check further down that a new method could
 * forget. docs/SECURITY.md §6.2.
 *
 * **2. "Delete" means deactivate.** Published assessments point at these rows,
 * and a term report from last year still has to render the level it was
 * written with. `isActive: false` removes a row from the pickers while leaving
 * history intact; `deletedAt` is reserved for rows nothing has ever
 * referenced, and is not offered here at all.
 *
 * **3. Identity is immutable.** `DevelopmentDomain.code` and
 * `AssessmentLevel.value` cannot be patched — see the notes in `catalog.dto.ts`.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /** Kindergartens this actor administers — the scope every write loads through. */
  private adminScope(actor: Actor): string[] {
    return this.tenants.adminKindergartenIds(actor);
  }

  /**
   * ★ How these lists stay bounded without a pager.
   *
   * CLAUDE.md §3.4 forbids an endpoint that returns an unbounded set, and the
   * three list routes here return whole arrays. Paging them would be the wrong
   * fix: the group assessment grid needs *every* active domain to render a
   * column selector, which is why `assessment-config` returns them whole too.
   *
   * So the bound is enforced where rows are created instead. A kindergarten
   * cannot accumulate an unbounded configuration in the first place, and the
   * cap is a number rather than an assumption. Nine domains is the RFP's own
   * example list (§6.1); forty is far past any real use and still small enough
   * that the list can never be a payload problem.
   */
  private static readonly MAX_ROWS_PER_KINDERGARTEN = 40;

  private async assertRoomFor(
    kind: "domains" | "levels" | "types",
    kindergartenId: string,
  ): Promise<void> {
    const existing = await this.repo.countOwnRows(kind, kindergartenId);
    if (existing >= CatalogService.MAX_ROWS_PER_KINDERGARTEN) {
      throw new ConflictException(
        `Дээд тал нь ${CatalogService.MAX_ROWS_PER_KINDERGARTEN} мөр үүсгэнэ. ` +
          "Хэрэглэхгүй болсныг нь идэвхгүй болгоно уу.",
      );
    }
  }

  /**
   * Marks each row with whether this administrator may change it.
   *
   * The UI needs it to disable the edit control on a system row, and sending it
   * is honest about a rule the API enforces anyway — a screen that offers a
   * button which always 404s is worse than one that explains why.
   */
  private withEditability<T extends { kindergartenId: string | null }>(rows: T[]) {
    return rows.map((row) => ({ ...row, isSystem: row.kindergartenId === null }));
  }

  // ── Development domains ────────────────────────────────────────────────────

  async listDomains(actor: Actor, kindergartenId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);
    return this.withEditability(await this.repo.listDomains(kindergartenId));
  }

  async createDomain(actor: Actor, kindergartenId: string, dto: CreateDomainDto) {
    this.tenants.assertAdmin(actor, kindergartenId);
    await this.assertRoomFor("domains", kindergartenId);

    const created = await this.guardUnique(
      () => this.repo.createDomain({ ...dto, kindergartenId }),
      "Ийм кодтой чиглэл аль хэдийн байна",
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "DevelopmentDomain",
      objectId: created.id,
      metadata: { code: created.code },
    });
    return created;
  }

  async updateDomain(actor: Actor, id: string, dto: UpdateDomainDto) {
    const existing = await this.repo.findWritableDomain(id, this.adminScope(actor));
    if (!existing) throw new NotFoundException();

    const updated = await this.repo.updateDomain(id, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: existing.kindergartenId,
      actorUserId: actor.userId,
      objectType: "DevelopmentDomain",
      objectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  /**
   * Deactivates a domain.
   *
   * The assessment count goes back to the caller rather than blocking the
   * change: the rows stay valid and keep rendering, and an administrator
   * retiring a criterion mid-year is a legitimate thing to do. They are simply
   * told what is already attached to it.
   */
  async deactivateDomain(actor: Actor, id: string) {
    const existing = await this.repo.findWritableDomain(id, this.adminScope(actor));
    if (!existing) throw new NotFoundException();

    const [updated, assessmentCount] = await Promise.all([
      this.repo.updateDomain(id, { isActive: false }),
      this.repo.countAssessmentsForDomain(id),
    ]);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: existing.kindergartenId,
      actorUserId: actor.userId,
      objectType: "DevelopmentDomain",
      objectId: id,
      metadata: { deactivated: true, assessmentCount },
    });

    return { id: updated.id, isActive: updated.isActive, assessmentCount };
  }

  // ── Assessment levels ──────────────────────────────────────────────────────

  async listLevels(actor: Actor, kindergartenId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);
    return this.withEditability(await this.repo.listLevels(kindergartenId));
  }

  async createLevel(actor: Actor, kindergartenId: string, dto: CreateLevelDto) {
    this.tenants.assertAdmin(actor, kindergartenId);
    await this.assertRoomFor("levels", kindergartenId);

    const created = await this.guardUnique(
      () => this.repo.createLevel({ ...dto, kindergartenId }),
      "Ийм түвшин аль хэдийн байна",
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "AssessmentLevel",
      objectId: created.id,
      metadata: { value: created.value },
    });
    return created;
  }

  async updateLevel(actor: Actor, id: string, dto: UpdateLevelDto) {
    const existing = await this.repo.findWritableLevel(id, this.adminScope(actor));
    if (!existing) throw new NotFoundException();

    const updated = await this.repo.updateLevel(id, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: existing.kindergartenId,
      actorUserId: actor.userId,
      objectType: "AssessmentLevel",
      objectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async deactivateLevel(actor: Actor, id: string) {
    const existing = await this.repo.findWritableLevel(id, this.adminScope(actor));
    if (!existing) throw new NotFoundException();

    const [updated, assessmentCount] = await Promise.all([
      this.repo.updateLevel(id, { isActive: false }),
      this.repo.countAssessmentsForLevel(id),
    ]);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: existing.kindergartenId,
      actorUserId: actor.userId,
      objectType: "AssessmentLevel",
      objectId: id,
      metadata: { deactivated: true, assessmentCount },
    });

    return { id: updated.id, isActive: updated.isActive, assessmentCount };
  }

  // ── Observation types ──────────────────────────────────────────────────────

  async listObservationTypes(actor: Actor, kindergartenId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);
    return this.withEditability(await this.repo.listObservationTypes(kindergartenId));
  }

  async createObservationType(actor: Actor, kindergartenId: string, dto: CreateObservationTypeDto) {
    this.tenants.assertAdmin(actor, kindergartenId);
    await this.assertRoomFor("types", kindergartenId);

    const created = await this.guardUnique(
      () => this.repo.createObservationType({ ...dto, kindergartenId }),
      "Ийм кодтой төрөл аль хэдийн байна",
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "ObservationType",
      objectId: created.id,
      metadata: { code: created.code },
    });
    return created;
  }

  async updateObservationType(actor: Actor, id: string, dto: UpdateObservationTypeDto) {
    const existing = await this.repo.findWritableObservationType(id, this.adminScope(actor));
    if (!existing) throw new NotFoundException();

    const updated = await this.repo.updateObservationType(id, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: existing.kindergartenId,
      actorUserId: actor.userId,
      objectType: "ObservationType",
      objectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async deactivateObservationType(actor: Actor, id: string) {
    const existing = await this.repo.findWritableObservationType(id, this.adminScope(actor));
    if (!existing) throw new NotFoundException();

    const [updated, observationCount] = await Promise.all([
      this.repo.updateObservationType(id, { isActive: false }),
      this.repo.countObservationsForType(id),
    ]);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: existing.kindergartenId,
      actorUserId: actor.userId,
      objectType: "ObservationType",
      objectId: id,
      metadata: { deactivated: true, observationCount },
    });

    return { id: updated.id, isActive: updated.isActive, observationCount };
  }

  /**
   * Turns a unique-constraint violation into a 409 with a sentence a person can
   * act on.
   *
   * Left to itself Prisma's P2002 surfaces as a 500, which tells an
   * administrator who typed a duplicate code that the system is broken.
   */
  private async guardUnique<T>(run: () => Promise<T>, message: string): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(message);
      throw error;
    }
  }
}

/** Prisma's unique-constraint code. Narrowed without importing the client. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
