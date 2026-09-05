import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { StaffRecordKind } from "../domain/enums";

/**
 * A member of staff's experience, certificates and grades — Order А/261,
 * criterion 51. The only Prisma import site for this domain (§2.2).
 */
@Injectable()
export class StaffRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly person = { select: { id: true, lastName: true, firstName: true } };

  /**
   * One person's file at one kindergarten.
   *
   * ★ Both ids are in the filter, not just the user's.
   *
   * A teacher may work at two kindergartens, and each keeps its own file. A
   * query on `userId` alone would hand one employer the other's records — the
   * cross-tenant leak §3.1's rule exists to make impossible, and this table
   * carries `kindergartenId` for precisely that reason.
   */
  async listForUser(kindergartenId: string, userId: string, kind?: StaffRecordKind) {
    return this.prisma.staffRecord.findMany({
      where: { kindergartenId, userId, deletedAt: null, ...(kind ? { kind } : {}) },
      // Current posts first, then most recent — a reader wants what is true
      // now before what was true in 2014.
      orderBy: [{ endedOn: { sort: "asc", nulls: "first" } }, { startedOn: "desc" }],
      include: { createdBy: this.person },
    });
  }

  async create(data: Record<string, unknown>) {
    return this.prisma.staffRecord.create({
      data: data as never,
      include: { createdBy: this.person },
    });
  }

  async find(id: string) {
    return this.prisma.staffRecord.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, userId: true, kindergartenId: true },
    });
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.staffRecord.update({
      where: { id },
      data,
      include: { createdBy: this.person },
    });
  }

  async softDelete(id: string) {
    return this.prisma.staffRecord.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Whether this person is on this kindergarten's **staff**.
   *
   * ★ Checked before a record is filed against them, because `userId` arrives
   * in the URL. Without it an administrator could attach a certificate to any
   * user id in the system — including a teacher at another kindergarten — and
   * the row would then be readable by that person under
   * `canReadStaffRecords`'s "your own file" branch.
   *
   * ★★ `PARENT` is excluded, and the first version of this method did not
   * exclude it — it asked only whether a membership existed, and a guardian
   * has one. That made "ажлын туршлага" fileable against a child's mother.
   * The four staff roles are named explicitly rather than "not PARENT" so
   * that a role added later has to be considered rather than inherited.
   *
   * ★★★ `isActive` is **not** required: a kindergarten still holds the file of
   * someone whose assignment was revoked last term, and criterion 51's return
   * covers the year rather than today.
   */
  async isStaffMember(kindergartenId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        kindergartenId,
        userId,
        deletedAt: null,
        role: { in: ["ADMIN", "TEACHER", "COOK", "ACCOUNTANT"] },
      },
      select: { id: true },
    });
    return membership !== null;
  }
}
