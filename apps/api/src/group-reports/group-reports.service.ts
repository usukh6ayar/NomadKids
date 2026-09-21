import { Injectable, NotFoundException } from "@nestjs/common";
import { AuthzRepository } from "../authz/authz.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { GroupReportsRepository } from "./group-reports.repository";

/**
 * "Тайлан" — one group, one stretch of time, every figure a teacher reports on.
 *
 * ★ The range is the caller's, so a month, a term and a year are the same
 * request. The client asked for all three ("1 сараар, улиралаар, бүтэн жилээр")
 * and they differ only in where `from` and `to` land.
 */
@Injectable()
export class GroupReportsService {
  constructor(
    private readonly repo: GroupReportsRepository,
    private readonly tenants: TenantAccessService,
    private readonly authz: AuthzRepository,
  ) {}

  async summary(actor: Actor, groupId: string, from: Date, to: Date) {
    const group = await this.repo.findGroup(groupId, this.tenants.memberKindergartenIds(actor));
    if (!group) throw new NotFoundException();

    /*
      ★ A teacher reads their own groups; an admin reads any in their
      kindergarten. The same pair of checks `observation-stats` makes, and 404
      either way (§1.7) — a group that is not yours is indistinguishable from
      one that does not exist.
    */
    if (!this.tenants.isAdmin(actor, group.kindergartenId)) {
      const assigned = await this.authz.loadActiveTeachingGroupIds(actor);
      if (!assigned.includes(groupId)) throw new NotFoundException();
    }

    const terms = await this.repo.termsInRange(group.kindergartenId, from, to);

    const [children, attendance, assessments, observations, types, domains, surveys] =
      await Promise.all([
        this.repo.rosterSize(groupId),
        this.repo.attendance(groupId, from, to),
        this.repo.assessments(
          groupId,
          terms.map((term) => term.id),
        ),
        this.repo.observations(groupId, from, to),
        this.repo.listTypes(group.kindergartenId),
        this.repo.listDomains(group.kindergartenId),
        this.repo.surveys(group.kindergartenId, groupId, from, to),
      ]);

    /*
      ★ "Present" counts PRESENT and HALF_DAY.

      A child who came for the morning was at kindergarten that day. The
      register keeps the two apart because the teacher marked them apart; a
      percentage that called half a day an absence would read as a truancy
      figure and be wrong by however many half days there were.
    */
    const attended = attendance.byStatus
      .filter((row) => row.status === "PRESENT" || row.status === "HALF_DAY")
      .reduce((sum, row) => sum + row._count._all, 0);
    const recorded = attendance.byStatus.reduce((sum, row) => sum + row._count._all, 0);

    const byDay = new Map<string, { attended: number; recorded: number }>();
    for (const row of attendance.byDate) {
      const day = row.date.toISOString().slice(0, 10);
      const acc = byDay.get(day) ?? { attended: 0, recorded: 0 };
      acc.recorded += row._count._all;
      if (row.status === "PRESENT" || row.status === "HALF_DAY") acc.attended += row._count._all;
      byDay.set(day, acc);
    }

    const domainCounts = new Map(
      assessments.byDomain.map((row) => [row.domainId, row._count._all]),
    );
    const typeCounts = new Map(observations.byType.map((row) => [row.typeId, row._count._all]));
    const kindCounts = new Map(surveys.byKind.map((row) => [row.kind, row._count._all]));

    return {
      range: { from: iso(from), to: iso(to) },
      group: { id: group.id, name: group.name },
      children,
      terms,

      attendance: {
        recorded,
        attended,
        percent: recorded === 0 ? null : Math.round((attended / recorded) * 100),
        /*
          Every status, including the ones with none. A register with no
          "Өвчтэй" row this month is a finding; a status missing from the list
          looks like a status the product does not have.
        */
        byStatus: ["PRESENT", "HALF_DAY", "SICK", "EXCUSED", "ABSENT", "OTHER"].map((status) => ({
          status,
          count: attendance.byStatus.find((row) => row.status === status)?._count._all ?? 0,
        })),
        byDay: [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, row]) => ({
            date,
            percent: row.recorded === 0 ? null : Math.round((row.attended / row.recorded) * 100),
          })),
      },

      assessment: {
        assessed: assessments.assessedChildIds.length,
        byDomain: domains.map((domain) => ({
          id: domain.id,
          name: domain.name,
          count: domainCounts.get(domain.id) ?? 0,
        })),
      },

      observations: {
        total: observations.total,
        children: observations.childCount,
        byType: types.map((type) => ({
          id: type.id,
          name: type.name,
          code: type.code,
          count: typeCounts.get(type.id) ?? 0,
        })),
      },

      surveys: {
        total: surveys.surveyCount,
        responded: surveys.responded,
        percent: children === 0 ? null : Math.round((surveys.responded / children) * 100),
        byKind: ["FORM", "POLL"].map((kind) => ({
          kind,
          count: kindCounts.get(kind as "FORM" | "POLL") ?? 0,
        })),
      },
    };
  }
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
