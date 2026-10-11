import { Injectable } from "@nestjs/common";
import { CLUBS_PER_GROUP_MAX, type AreaPlan, type RoutineItem } from "@kinder/contracts";
import { PrismaService } from "../prisma/prisma.service";
import type { ClubRequestStatus } from "../generated/prisma/enums";

/**
 * Every request a group's screen can show, bounded (CLAUDE.md §3.4): only
 * live ones (pending, approved) of children currently in the group, on clubs
 * that still exist — a closed or rejected request drops out of the list.
 */
const GROUP_REQUESTS_MAX = 500;
/** A child's own history across this group's clubs, rejected ones included. */
const CHILD_REQUESTS_MAX = 100;

const CLUB_SELECT = {
  id: true,
  name: true,
  teacherName: true,
  room: true,
  days: true,
  startTime: true,
  endTime: true,
  areas: true,
  goal: true,
} as const;

const REQUEST_SELECT = {
  id: true,
  clubId: true,
  childId: true,
  status: true,
  createdAt: true,
  child: { select: { lastName: true, firstName: true } },
} as const;

export interface ClubData {
  name: string;
  teacherName: string;
  room: string | null;
  days: number[];
  startTime: string;
  endTime: string;
  areas: string[];
  goal: string | null;
}

@Injectable()
export class RoutineRepository {
  constructor(private readonly prisma: PrismaService) {}

  findRoutine(groupId: string) {
    return this.prisma.groupRoutine.findUnique({
      where: { groupId },
      select: { id: true, items: true, plan: true, updatedAt: true },
    });
  }

  /** Created on the first save; the group's one settings row after that. */
  saveRoutine(
    kindergartenId: string,
    groupId: string,
    data: { items: RoutineItem[] } | { plan: AreaPlan[] },
  ) {
    const json = data as unknown as Record<string, object>;
    return this.prisma.groupRoutine.upsert({
      where: { groupId },
      create: { kindergartenId, groupId, ...json },
      update: json,
      select: { id: true },
    });
  }

  /**
   * The learning-area names this kindergarten can use — the system rows and
   * its own, active and live. Configuration is the table's (CLAUDE.md §2.3).
   */
  async areaNames(kindergartenId: string): Promise<Set<string>> {
    const rows = await this.prisma.developmentDomain.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ kindergartenId: null }, { kindergartenId }],
      },
      select: { name: true },
    });
    return new Set(rows.map((r) => r.name));
  }

  listClubs(groupId: string) {
    return this.prisma.club.findMany({
      where: { groupId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: CLUBS_PER_GROUP_MAX,
      select: CLUB_SELECT,
    });
  }

  countClubs(groupId: string) {
    return this.prisma.club.count({ where: { groupId, deletedAt: null } });
  }

  /** A live club, but only of this group. */
  findClub(clubId: string, groupId: string) {
    return this.prisma.club.findFirst({
      where: { id: clubId, groupId, deletedAt: null },
      select: { ...CLUB_SELECT, kindergartenId: true },
    });
  }

  createClub(kindergartenId: string, groupId: string, data: ClubData) {
    return this.prisma.club.create({
      data: { kindergartenId, groupId, ...data },
      select: CLUB_SELECT,
    });
  }

  updateClub(clubId: string, data: ClubData) {
    return this.prisma.club.update({ where: { id: clubId }, data, select: CLUB_SELECT });
  }

  async softDeleteClub(clubId: string): Promise<void> {
    await this.prisma.club.update({ where: { id: clubId }, data: { deletedAt: new Date() } });
  }

  listGroupRequests(groupId: string) {
    return this.prisma.clubRequest.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        club: { groupId, deletedAt: null },
        child: {
          deletedAt: null,
          enrollments: {
            some: { groupId, status: "ACTIVE", endedOn: null, deletedAt: null },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: GROUP_REQUESTS_MAX,
      select: REQUEST_SELECT,
    });
  }

  listChildRequests(childId: string, groupId: string) {
    return this.prisma.clubRequest.findMany({
      where: { childId, club: { groupId, deletedAt: null } },
      orderBy: { createdAt: "desc" },
      take: CHILD_REQUESTS_MAX,
      select: REQUEST_SELECT,
    });
  }

  /**
   * Creates a pending request, or answers `null` when the child already has a
   * live one for this club — the partial unique index decides, so two taps at
   * once cannot both get through.
   */
  async createRequest(data: {
    kindergartenId: string;
    clubId: string;
    childId: string;
    requestedByUserId: string;
  }) {
    try {
      return await this.prisma.clubRequest.create({ data, select: REQUEST_SELECT });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  /** A request on a live club of this group. */
  findRequestInGroup(requestId: string, groupId: string) {
    return this.prisma.clubRequest.findFirst({
      where: { id: requestId, club: { groupId, deletedAt: null } },
      select: { id: true, kindergartenId: true, childId: true, status: true },
    });
  }

  /**
   * PENDING → `status`, once. Conditional on the row still being pending, so
   * two teachers deciding at the same moment cannot both win; `false` means
   * someone already had.
   */
  async decide(
    requestId: string,
    status: Extract<ClubRequestStatus, "APPROVED" | "REJECTED">,
    userId: string,
  ): Promise<boolean> {
    const { count } = await this.prisma.clubRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status, decidedAt: new Date(), decidedByUserId: userId },
    });
    return count === 1;
  }

  /**
   * The child's group now: the active, open enrollment (CLAUDE.md §1.2), on a
   * live group. `null` when the child is in no group.
   */
  async currentGroup(childId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        childId,
        status: "ACTIVE",
        endedOn: null,
        deletedAt: null,
        group: { deletedAt: null },
      },
      orderBy: [{ startedOn: "desc" }, { createdAt: "desc" }],
      select: { kindergartenId: true, group: { select: { id: true, name: true } } },
    });
    return enrollment ? { kindergartenId: enrollment.kindergartenId, ...enrollment.group } : null;
  }
}

export type ClubRow = Awaited<ReturnType<RoutineRepository["listClubs"]>>[number];
export type ClubRequestRow = Awaited<ReturnType<RoutineRepository["listGroupRequests"]>>[number];

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
