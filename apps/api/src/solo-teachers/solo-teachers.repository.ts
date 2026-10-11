import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface SoloWorkspaceInput {
  kindergarten: {
    name: string;
    phone: string;
    email: string;
    propertyType: string | null;
    location: string | null;
    soloWorkplaceName: string | null;
  };
  schoolYear: { name: string; startsOn: Date; endsOn: Date };
  groupName: string;
  user: {
    username: string;
    email: string;
    phone: string;
    lastName: string;
    firstName: string;
    passwordHash: string;
  };
  invitation: { tokenHash: string; expiresAt: Date; requestedIp: string | null };
}

@Injectable()
export class SoloTeachersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A solo teacher's whole workspace — atomically, as `PlatformRepository.
   * createWithAdmin` creates a kindergarten with its director.
   *
   * All or nothing: a workspace with no group has nothing to work in, a user
   * with no membership reaches nothing, and one with no invitation can never
   * set a password. The hashes are computed by the service, outside the
   * transaction; the token's plaintext never reaches this layer.
   *
   * ★ ADMIN **and** TEACHER: the teacher is the only staff here and does what a
   * director would for their own group, so every route works unchanged. The
   * solo rules — parents only, one group — are guards in the services that
   * add people and groups.
   */
  async createWorkspace(input: SoloWorkspaceInput) {
    return this.prisma.$transaction(async (tx) => {
      const kindergarten = await tx.kindergarten.create({
        data: { ...input.kindergarten, kind: "SOLO_TEACHER", isActive: true },
        select: { id: true },
      });
      const schoolYear = await tx.schoolYear.create({
        data: { kindergartenId: kindergarten.id, ...input.schoolYear, isCurrent: true },
        select: { id: true },
      });
      const group = await tx.group.create({
        data: {
          kindergartenId: kindergarten.id,
          schoolYearId: schoolYear.id,
          name: input.groupName,
          // The teacher sets the real age band on the group's page.
          ageBand: "MIDDLE",
        },
        select: { id: true },
      });

      const user = await tx.user.create({
        data: { ...input.user, selfRegisteredAt: new Date() },
        select: { id: true },
      });
      await tx.membership.create({
        data: { userId: user.id, kindergartenId: kindergarten.id, role: "ADMIN" },
      });
      const teacher = await tx.membership.create({
        data: { userId: user.id, kindergartenId: kindergarten.id, role: "TEACHER" },
        select: { id: true },
      });
      await tx.groupTeacher.create({
        data: {
          kindergartenId: kindergarten.id,
          groupId: group.id,
          membershipId: teacher.id,
          startedOn: input.schoolYear.startsOn,
        },
      });
      await tx.authToken.create({
        data: {
          userId: user.id,
          purpose: "INVITATION",
          tokenHash: input.invitation.tokenHash,
          expiresAt: input.invitation.expiresAt,
          requestedIp: input.invitation.requestedIp,
        },
      });

      return { kindergartenId: kindergarten.id, userId: user.id, groupId: group.id };
    });
  }

  /** Whether an account already holds this email or phone — a readable 409, not a 500. */
  async contactTaken(email: string, phone: string): Promise<"email" | "phone" | null> {
    const [byEmail, byPhone] = await Promise.all([
      this.prisma.user.findUnique({ where: { email }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { phone }, select: { id: true } }),
    ]);
    return byEmail ? "email" : byPhone ? "phone" : null;
  }

  async usernameTaken(username: string): Promise<boolean> {
    return (
      (await this.prisma.user.findUnique({ where: { username }, select: { id: true } })) !== null
    );
  }
}
