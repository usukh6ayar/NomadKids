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
  user: {
    username: string;
    email: string;
    phone: string;
    lastName: string;
    firstName: string;
    passwordHash: string;
  };
}

@Injectable()
export class SoloTeachersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A solo teacher's whole workspace — atomically, as `PlatformRepository.
   * createWithAdmin` creates a kindergarten with its director.
   *
   * All or nothing: a user with no membership reaches nothing. The password
   * hash is computed by the service, outside the transaction (since
   * 2026-10-14 it is the teacher's own — no invitation token any more).
   *
   * ★ No school year and no group (the user, 2026-10-14): the teacher sets up
   * their own — `TenantsService.createSchoolYear` / `createGroup`, which
   * assigns them to the group they open.
   *
   * ★ TEACHER only (the user, 2026-10-14). They used to be ADMIN as well, and
   * the web showed them the director («Удирдлага»). A solo teacher works as
   * any group teacher does — their one group, its children, inviting the
   * families — and nothing a director decides. Migration
   * `20261014090000_solo_teacher_role_only` revoked the earlier ADMIN rows.
   */
  async createWorkspace(input: SoloWorkspaceInput) {
    return this.prisma.$transaction(async (tx) => {
      const kindergarten = await tx.kindergarten.create({
        data: { ...input.kindergarten, kind: "SOLO_TEACHER", isActive: true },
        select: { id: true },
      });
      const user = await tx.user.create({
        data: { ...input.user, selfRegisteredAt: new Date() },
        select: { id: true },
      });
      await tx.membership.create({
        data: { userId: user.id, kindergartenId: kindergarten.id, role: "TEACHER" },
      });
      return { kindergartenId: kindergarten.id, userId: user.id };
    });
  }

  /** Whether an account already holds this email or phone — a readable 409, not a 500. */
  async contactTaken(email: string | null, phone: string): Promise<"email" | "phone" | null> {
    const [byEmail, byPhone] = await Promise.all([
      // Any casing — see `UsersRepository.findByEmail`.
      email === null
        ? null
        : this.prisma.user.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
            select: { id: true },
          }),
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
