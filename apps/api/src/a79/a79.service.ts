import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  A79_DOMAINS,
  a79IsMet,
  a79Level,
  a79LevelForAge,
  ageInYears,
  localDate,
  type A79GroupSummary,
  type A79LevelKey,
  type A79Progress,
  type A79Status,
  type A79SummaryQuery,
  type ObservationA79Links,
} from "@kinder/contracts";
import { AuditRepository } from "../audit/audit.repository";
import type { Actor } from "../authz/actor";
import { canEditObservationAsStaff } from "../authz/child-access";
import { ChildAccessService } from "../authz/child-access.service";
import { GroupAccessService } from "../authz/group-access.service";
import { A79Repository } from "./a79.repository";

/** How much of a note stands in for it when the link has no «Тайлбар». */
const NOTE_OPENING = 140;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * А/79 in the progress record — the backend the web has asked for since
 * 2026-10-08 (`apps/web/lib/a79-progress.ts`). Until it existed every screen
 * answered «Үр дүн хараахан гараагүй байна».
 *
 * ★ Staff only. A family reads the notes the teacher shares; the criteria and
 * the score are the teacher's and the director's working record.
 */
@Injectable()
export class A79Service {
  constructor(
    private readonly repo: A79Repository,
    private readonly childAccess: ChildAccessService,
    private readonly groups: GroupAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * A note's links, for «Тэмдэглэл засах» (2026-10-22, the user: editing a
   * note lost its А/79 criteria — the form could not read them, and its save
   * would have replaced them with none). The same reach as replacing them.
   */
  async links(actor: Actor, observationId: string) {
    const row = await this.repo.findObservation(observationId);
    if (!row) throw new NotFoundException();

    const facts = await this.childAccess.assertCanReadObservations(actor, row.childId);
    if (!canEditObservationAsStaff(actor, facts, row)) throw new NotFoundException();

    return { links: await this.repo.liveLinks(row.id) };
  }

  /**
   * Replaces the note's links. A teacher or an administrator who may edit the
   * note as staff — `canEditObservationAsStaff`, the rule `PATCH
   * /observations/:id` keeps — may link it; anyone else gets 404. The route's
   * `@Roles("TEACHER", "ADMIN")` keeps a PE/music teacher out even of their own
   * note: А/79 is the class teacher's assessment (the web's contract).
   */
  async replaceLinks(actor: Actor, observationId: string, dto: ObservationA79Links) {
    const row = await this.repo.findObservation(observationId);
    if (!row) throw new NotFoundException();

    const facts = await this.childAccess.assertCanReadObservations(actor, row.childId);
    if (!canEditObservationAsStaff(actor, facts, row)) throw new NotFoundException();

    const { live, replaced } = await this.repo.replaceLinks(row, dto.links);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: row.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Observation",
      objectId: row.id,
      childId: row.childId,
      metadata: { a79Links: live.length, replaced },
    });

    return { links: live };
  }

  /**
   * One child's criteria at one level: the latest status each was given, and
   * every note linked to it, newest first. The child's assigned teacher or an
   * administrator — `assertCanRecord`, the same reach as filing the note.
   */
  async progress(actor: Actor, childId: string, level: A79LevelKey): Promise<A79Progress> {
    await this.childAccess.assertCanRecord(actor, childId);

    const rows = await this.repo.evidenceForChild(childId, level);
    const byNumber = new Map<number, A79Progress["criteria"][number]>();
    for (const row of rows) {
      const evidence = {
        observationId: row.observation.id,
        observedOn: isoDay(row.observation.observedOn),
        status: row.status,
        typeName: row.observation.type?.name ?? null,
        note: row.note || opening(row.observation.situation) || opening(row.observation.childDid),
      };
      const criterion = byNumber.get(row.number);
      // Rows arrive newest first, so the first one fixes the status.
      if (criterion) criterion.evidence.push(evidence);
      else
        byNumber.set(row.number, { number: row.number, status: row.status, evidence: [evidence] });
    }

    return {
      level,
      criteria: [...byNumber.values()].sort((a, b) => a.number - b.number),
    };
  }

  /**
   * The group's result, one row per child — counts only, scored with the
   * child's page's rule (`a79IsMet`: latest evidence «Бие даан»), over the
   * notes observed within the span (the page reads every note; the span is
   * what the director's term filter asks for).
   *
   * ★ The span defaults to the group's own school year. A child's level is
   * their age today — as their own page opens — or on the span's last day if
   * the span is already over, so a past term reads the level it was taught at.
   *
   * ★★ The portal-fee gate (CLAUDE.md §1.7): a solo teacher's child whose
   * family has not paid is on the roster and out of this record, as their own
   * progress answers 402 — listed with `feeDue` and no figures (2026-10-17;
   * left out entirely, a group of unpaid children read «Бүлэгт хүүхэд алга»).
   */
  async groupSummary(
    actor: Actor,
    groupId: string,
    query: A79SummaryQuery,
  ): Promise<A79GroupSummary> {
    await this.groups.assertCanReadGroup(actor, groupId);

    const group = await this.repo.findGroupYear(groupId);
    if (!group) throw new NotFoundException();
    const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : group.schoolYear.startsOn;
    const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : group.schoolYear.endsOn;
    if (to < from) throw new BadRequestException("Эхлэх огноо нь дуусах огнооноос хойш байна");

    const roster = await this.repo.rosterBetween(groupId, from, to);
    const blocked = await this.childAccess.soloStaffBlockedChildIds(roster.map((c) => c.id));
    const today = new Date(`${localDate()}T00:00:00.000Z`);
    const ageOn = to < today ? to : today;
    const leveled = roster.map((child) => ({
      ...child,
      level: a79LevelForAge(child.dateOfBirth ? ageInYears(child.dateOfBirth, ageOn) : null),
    }));
    const children = leveled.filter((child) => !blocked.has(child.id));
    const links = await this.repo.linksForChildren(
      children.map((child) => child.id),
      [...new Set(children.map((child) => child.level))],
      from,
      to,
    );

    /* child → "level-number" → the latest link, by the day observed, then saved. */
    const latest = new Map<string, Map<string, { status: A79Status; on: number; at: number }>>();
    for (const link of links) {
      const key = `${link.level}-${link.number}`;
      const on = link.observation.observedOn.getTime();
      const at = link.createdAt.getTime();
      const forChild = latest.get(link.childId) ?? new Map();
      const seen = forChild.get(key);
      if (!seen || on > seen.on || (on === seen.on && at > seen.at)) {
        forChild.set(key, { status: link.status, on, at });
      }
      latest.set(link.childId, forChild);
    }

    return {
      children: leveled.map((child) => {
        const level = child.level;
        if (blocked.has(child.id)) {
          return {
            childId: child.id,
            firstName: child.firstName,
            lastName: child.lastName,
            level,
            feeDue: true,
            achieved: 0,
            total: 0,
            byDomain: [],
          };
        }
        const criteria = a79Level(level).criteria;
        const forChild = latest.get(child.id);
        const met = (number: number) => {
          const seen = forChild?.get(`${level}-${number}`);
          return seen ? a79IsMet(seen.status) : false;
        };
        const numbered = criteria.map((criterion, index) => ({ ...criterion, number: index + 1 }));

        return {
          childId: child.id,
          firstName: child.firstName,
          lastName: child.lastName,
          level,
          feeDue: false,
          achieved: numbered.filter((c) => met(c.number)).length,
          total: numbered.length,
          // Criteria any note in the span is linked to — 0 is not assessed.
          assessed: numbered.filter((c) => forChild?.has(`${level}-${c.number}`)).length,
          byDomain: A79_DOMAINS.map((domain) => {
            const inDomain = numbered.filter((c) => c.domain === domain);
            return {
              domain,
              achieved: inDomain.filter((c) => met(c.number)).length,
              total: inDomain.length,
            };
          }),
        };
      }),
    };
  }
}

/** The opening of a note's text — `null` for none or only whitespace, so the next field stands in. */
function opening(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.length > NOTE_OPENING ? `${trimmed.slice(0, NOTE_OPENING)}…` : trimmed;
}
