import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { SongPoemType } from "../generated/prisma/enums";

/** Nine books of fifty — far above a real year, and never unbounded (§3.4). */
const LIBRARY_MAX = 500;

const ITEM_SELECT = {
  id: true,
  month: true,
  type: true,
  title: true,
  description: true,
  linkUrl: true,
  coverKey: true,
  coverName: true,
  fileKey: true,
  fileName: true,
  fileMimeType: true,
  updatedAt: true,
} as const;

export interface SongPoemData {
  month: string;
  type: SongPoemType;
  title: string;
  description: string;
  linkUrl: string | null;
}

export interface CoverData {
  coverKey: string;
  coverMimeType: string;
  coverName: string;
}

export interface AttachmentData {
  fileKey: string;
  fileMimeType: string;
  fileName: string;
  fileSize: number;
}

@Injectable()
export class SongsPoemsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listItems(groupId: string) {
    return this.prisma.songPoem.findMany({
      where: { groupId, deletedAt: null },
      orderBy: [{ month: "asc" }, { createdAt: "asc" }],
      take: LIBRARY_MAX,
      select: ITEM_SELECT,
    });
  }

  listMonths(groupId: string) {
    return this.prisma.songPoemMonth.findMany({
      where: { groupId },
      select: { month: true, label: true, subtitle: true },
    });
  }

  saveMonth(
    kindergartenId: string,
    groupId: string,
    month: string,
    label: string,
    subtitle: string,
  ) {
    return this.prisma.songPoemMonth.upsert({
      where: { groupId_month: { groupId, month } },
      create: { kindergartenId, groupId, month, label, subtitle },
      update: { label, subtitle },
      select: { id: true },
    });
  }

  countInMonth(groupId: string, month: string) {
    return this.prisma.songPoem.count({ where: { groupId, month, deletedAt: null } });
  }

  create(
    kindergartenId: string,
    groupId: string,
    createdById: string,
    data: SongPoemData & Partial<CoverData> & Partial<AttachmentData>,
  ) {
    return this.prisma.songPoem.create({
      data: { kindergartenId, groupId, createdById, ...data },
      select: ITEM_SELECT,
    });
  }

  /** A live item, but only of this group. */
  findInGroup(id: string, groupId: string) {
    return this.prisma.songPoem.findFirst({
      where: { id, groupId, deletedAt: null },
      select: { ...ITEM_SELECT, kindergartenId: true },
    });
  }

  update(id: string, data: SongPoemData & Partial<CoverData> & Partial<AttachmentData>) {
    return this.prisma.songPoem.update({ where: { id }, data, select: ITEM_SELECT });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.songPoem.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** What a cover or file request needs: whose group it is, and the object. */
  findObject(id: string) {
    return this.prisma.songPoem.findFirst({
      where: { id, deletedAt: null },
      select: {
        groupId: true,
        coverKey: true,
        coverName: true,
        fileKey: true,
        fileName: true,
      },
    });
  }

  /** The child's group now — the active, open enrollment (CLAUDE.md §1.2). */
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
      select: { group: { select: { id: true, name: true } } },
    });
    return enrollment?.group ?? null;
  }
}

export type SongPoemRow = Awaited<ReturnType<SongsPoemsRepository["listItems"]>>[number];
