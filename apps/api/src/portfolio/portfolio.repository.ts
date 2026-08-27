import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * "Миний тухай", age profiles 2–5, and birthday notes.
 *
 * Every write is an upsert: the portfolio is a form a teacher or parent fills
 * in over years, and there is no meaningful "create" step the user performs.
 * Rows appear on first save.
 */
@Injectable()
export class PortfolioRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── About Me ──────────────────────────────────────────────────────────────

  async findAboutMe(childId: string) {
    return this.prisma.childProfile.findFirst({ where: { childId, deletedAt: null } });
  }

  /**
   * Upserts "Миний тухай".
   *
   * `deletedAt: null` in the update revives a soft-deleted row rather than
   * leaving an invisible one behind that the unique constraint would then
   * collide with.
   */
  async upsertAboutMe(childId: string, kindergartenId: string, data: Record<string, unknown>) {
    return this.prisma.childProfile.upsert({
      where: { childId },
      create: { childId, kindergartenId, ...data },
      update: { ...data, deletedAt: null },
    });
  }

  // ── Age profiles ──────────────────────────────────────────────────────────

  async listAgeProfiles(childId: string) {
    return this.prisma.childAgeProfile.findMany({
      where: { childId, deletedAt: null },
      orderBy: { age: "asc" },
      include: { schoolYear: { select: { id: true, name: true } } },
    });
  }

  async findAgeProfile(childId: string, age: number) {
    return this.prisma.childAgeProfile.findFirst({
      where: { childId, age, deletedAt: null },
      include: { schoolYear: { select: { id: true, name: true } } },
    });
  }

  async upsertAgeProfile(
    childId: string,
    kindergartenId: string,
    age: number,
    data: Record<string, unknown>,
    schoolYearId?: string | null,
  ) {
    return this.prisma.childAgeProfile.upsert({
      where: { childId_age: { childId, age } },
      create: { childId, kindergartenId, age, schoolYearId: schoolYearId ?? null, ...data },
      update: {
        ...data,
        ...(schoolYearId ? { schoolYearId } : {}),
        deletedAt: null,
      },
      include: { schoolYear: { select: { id: true, name: true } } },
    });
  }

  // ── Birthday notes ────────────────────────────────────────────────────────

  async listBirthdayNotes(childId: string) {
    return this.prisma.birthdayNote.findMany({
      where: { childId, deletedAt: null },
      orderBy: { age: "asc" },
    });
  }

  /**
   * The birthday section — RFP §4.2.
   *
   * One round trip for the notes and the birth date they are about. Two queries
   * would be the more obvious code and the wrong shape: the zodiac sign and the
   * year animal are both functions of `dateOfBirth`, so a response without it
   * cannot be assembled at all.
   */
  async loadBirthdaySection(childId: string) {
    const [child, notes] = await Promise.all([
      this.prisma.child.findFirst({
        where: { id: childId, deletedAt: null },
        select: { dateOfBirth: true },
      }),
      this.listBirthdayNotes(childId),
    ]);

    return { child, notes };
  }

  async upsertBirthdayNote(
    childId: string,
    kindergartenId: string,
    age: number,
    note: string | null,
  ) {
    return this.prisma.birthdayNote.upsert({
      where: { childId_age: { childId, age } },
      create: { childId, kindergartenId, age, note },
      update: { note, deletedAt: null },
    });
  }

  // ── Overview ──────────────────────────────────────────────────────────────

  /**
   * Everything the portfolio overview shows, in one round trip.
   *
   * The overview answers exactly one question — "what is in this child's
   * portfolio?" — so it returns presence and counts rather than the content of
   * every section. The content is fetched when a section is opened.
   */
  async loadOverview(childId: string) {
    const [child, aboutMe, ageProfiles, birthdayNotes, photoCount] = await Promise.all([
      this.prisma.child.findFirst({
        where: { id: childId, deletedAt: null },
        select: {
          id: true,
          lastName: true,
          firstName: true,
          dateOfBirth: true,
          sex: true,
          photoMediaFileId: true,
          enrollments: {
            where: { status: "ACTIVE", deletedAt: null },
            select: {
              group: { select: { id: true, name: true, ageBand: true } },
              schoolYear: { select: { id: true, name: true } },
            },
            take: 1,
          },
        },
      }),
      this.prisma.childProfile.findFirst({
        where: { childId, deletedAt: null },
        select: { id: true, updatedAt: true, introduction: true },
      }),
      this.prisma.childAgeProfile.findMany({
        where: { childId, deletedAt: null },
        select: { id: true, age: true, updatedAt: true },
        orderBy: { age: "asc" },
      }),
      this.prisma.birthdayNote.findMany({
        where: { childId, deletedAt: null },
        select: { id: true, age: true, note: true },
        orderBy: { age: "asc" },
      }),
      this.prisma.mediaFile.count({
        where: { childId, deletedAt: null, status: "READY" },
      }),
    ]);

    return { child, aboutMe, ageProfiles, birthdayNotes, photoCount };
  }

  /** The child's current school year, so a new age profile can be dated. */
  async currentSchoolYearId(childId: string): Promise<string | null> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { childId, status: "ACTIVE", deletedAt: null },
      select: { schoolYearId: true },
      orderBy: { startedOn: "desc" },
    });
    return enrollment?.schoolYearId ?? null;
  }
}
