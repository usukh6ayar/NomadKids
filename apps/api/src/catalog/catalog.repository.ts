import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The administrator-editable configuration tables.
 *
 * ★ Two filters, and the difference between them is the whole security story.
 *
 * `kindergartenId = NULL` marks a **system default** shared by every
 * kindergarten. Reads must include those rows — a teacher's screen renders
 * "Хэл яриа" from one. Writes must exclude them: a director editing a system
 * row would silently change every other kindergarten's configuration, which is
 * a cross-tenant write dressed up as a settings change.
 *
 * So `readWhere` is `own OR system` and `writableWhere` is `own` — the
 * asymmetry is deliberate, and `test/catalog.test.ts` asserts that patching a
 * system row is a 404 rather than a successful write. docs/SECURITY.md §6.2.
 */
@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Own rows plus the shared system defaults, active and inactive alike. */
  private readWhere(kindergartenId: string) {
    return {
      deletedAt: null,
      OR: [{ kindergartenId }, { kindergartenId: null }],
    };
  }

  /**
   * Rows this administrator may change.
   *
   * `kindergartenId: { in: [...] }` and never `null` — a system row cannot
   * match, so it 404s at the load rather than being caught by a later check
   * somebody could forget to write.
   */
  private writableWhere(id: string, kindergartenIds: string[]) {
    return { id, deletedAt: null, kindergartenId: { in: kindergartenIds } };
  }

  /**
   * How many rows this kindergarten owns — system rows excluded, since it did
   * not create them and cannot remove them.
   *
   * Backs the create-time cap in `CatalogService`, which is what keeps these
   * unpaged lists bounded. See the note there.
   */
  async countOwnRows(
    kind: "domains" | "levels" | "types",
    kindergartenId: string,
  ): Promise<number> {
    const where = { kindergartenId, deletedAt: null };
    if (kind === "domains") return this.prisma.developmentDomain.count({ where });
    if (kind === "levels") return this.prisma.assessmentLevel.count({ where });
    return this.prisma.observationType.count({ where });
  }

  // ── Development domains ────────────────────────────────────────────────────

  async listDomains(kindergartenId: string) {
    return this.prisma.developmentDomain.findMany({
      where: this.readWhere(kindergartenId),
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
  }

  async findWritableDomain(id: string, kindergartenIds: string[]) {
    return this.prisma.developmentDomain.findFirst({
      where: this.writableWhere(id, kindergartenIds),
    });
  }

  async createDomain(data: {
    kindergartenId: string;
    name: string;
    code: string;
    order: number;
    color: string;
    description?: string | null;
  }) {
    return this.prisma.developmentDomain.create({ data });
  }

  async updateDomain(
    id: string,
    data: {
      name?: string;
      order?: number;
      color?: string;
      description?: string | null;
      isActive?: boolean;
    },
  ) {
    return this.prisma.developmentDomain.update({ where: { id }, data });
  }

  /** How many assessments already point at this domain. */
  async countAssessmentsForDomain(domainId: string): Promise<number> {
    return this.prisma.assessment.count({ where: { domainId, deletedAt: null } });
  }

  // ── Assessment levels ──────────────────────────────────────────────────────

  async listLevels(kindergartenId: string) {
    return this.prisma.assessmentLevel.findMany({
      where: this.readWhere(kindergartenId),
      orderBy: [{ value: "asc" }],
    });
  }

  async findWritableLevel(id: string, kindergartenIds: string[]) {
    return this.prisma.assessmentLevel.findFirst({
      where: this.writableWhere(id, kindergartenIds),
    });
  }

  async createLevel(data: {
    kindergartenId: string;
    value: number;
    label: string;
    color: string;
    description?: string | null;
    order: number;
  }) {
    return this.prisma.assessmentLevel.create({ data });
  }

  async updateLevel(
    id: string,
    data: {
      label?: string;
      color?: string;
      description?: string | null;
      order?: number;
      isActive?: boolean;
    },
  ) {
    return this.prisma.assessmentLevel.update({ where: { id }, data });
  }

  async countAssessmentsForLevel(levelId: string): Promise<number> {
    return this.prisma.assessment.count({ where: { levelId, deletedAt: null } });
  }

  // ── Observation types ──────────────────────────────────────────────────────

  async listObservationTypes(kindergartenId: string) {
    return this.prisma.observationType.findMany({
      where: this.readWhere(kindergartenId),
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
  }

  async findWritableObservationType(id: string, kindergartenIds: string[]) {
    return this.prisma.observationType.findFirst({
      where: this.writableWhere(id, kindergartenIds),
    });
  }

  async createObservationType(data: {
    kindergartenId: string;
    name: string;
    code: string;
    order: number;
  }) {
    return this.prisma.observationType.create({ data });
  }

  async updateObservationType(
    id: string,
    data: { name?: string; order?: number; isActive?: boolean },
  ) {
    return this.prisma.observationType.update({ where: { id }, data });
  }

  async countObservationsForType(typeId: string): Promise<number> {
    return this.prisma.observation.count({ where: { typeId, deletedAt: null } });
  }
}
