import type { Actor } from "./actor";
import { Role } from "../domain/enums";

/**
 * Who may read and write in a chat room — as pure functions over facts.
 *
 * ★ Split from the service for the reason `child-access.ts` gives: the rules
 * are testable exhaustively without a database, and a rule that needs a
 * Postgres container to exercise is a rule nobody exercises.
 *
 * ★★ There is no membership table. Every answer below is derived from the same
 * rows authorization already reads — `Membership`, `GroupTeacher`,
 * `Enrollment`, `Guardianship`. CLAUDE.md §1.3 argues this about roles in a
 * token and it is the same argument: a fourth copy of "who belongs where" is
 * the copy that still says yes after a teacher is unassigned.
 */

/** `group:<uuid>` or `staff:<kindergartenId>`. Never null — see the schema. */
export type RoomKey = string;

export const GROUP_ROOM = (groupId: string): RoomKey => `group:${groupId}`;
export const STAFF_ROOM = (kindergartenId: string): RoomKey => `staff:${kindergartenId}`;

export type RoomKind = "GROUP" | "STAFF";

export interface Room {
  readonly key: RoomKey;
  readonly kind: RoomKind;
  readonly kindergartenId: string;
  /** Null for the staff room. */
  readonly groupId: string | null;
  readonly name: string;
}

/**
 * The facts a room decision is made from.
 *
 * All four sets are scoped to the actor. Nothing here is about a room the
 * actor cannot see, which is what keeps `roomsFor` from having to filter twice.
 */
export interface ChatAccessFacts {
  /** Groups the actor actively teaches: `endedOn IS NULL`, not soft-deleted. */
  readonly teachingGroups: readonly { id: string; name: string; kindergartenId: string }[];
  /**
   * Groups where the actor guards a currently enrolled child.
   *
   * ★ *Currently* enrolled, unlike `childKindergartenIds` in
   * `child-access.ts`, which reads enrollment history so a teacher keeps access
   * to observations they wrote. A chat room is a live conversation between the
   * families who are in a group **now** — a parent whose child left last year
   * should not still be reading it, and history is the wrong instrument for
   * that question.
   */
  readonly guardianGroups: readonly { id: string; name: string; kindergartenId: string }[];
}

/**
 * Every room this actor belongs to.
 *
 * ★ A staff room per kindergarten where the actor is a teacher or an admin,
 * plus one per group they teach or guard a child in. Deduplicated by key: a
 * teacher who is also a parent in the group they teach gets that room once.
 *
 * Returns `[]` for someone with no memberships, which is the right answer and
 * the reason the caller never has to special-case a superadmin — a platform
 * operator holds no kindergarten membership (§1.1) and so belongs to no room.
 */
export function roomsFor(actor: Actor, facts: ChatAccessFacts, names: KindergartenNames): Room[] {
  const rooms = new Map<RoomKey, Room>();

  for (const membership of actor.memberships) {
    if (membership.role !== Role.TEACHER && membership.role !== Role.ADMIN) continue;
    const key = STAFF_ROOM(membership.kindergartenId);
    rooms.set(key, {
      key,
      kind: "STAFF",
      kindergartenId: membership.kindergartenId,
      groupId: null,
      /*
        "Бүх багш" — the client's own name for it, and accurate: an admin is in
        it too and no guardian ever is.

        Qualified by the kindergarten only when one is named, which is the case
        that needs it: a person with memberships in two kindergartens would
        otherwise see two identical rows in the list and have to guess.
      */
      name: names[membership.kindergartenId]
        ? `Бүх багш · ${names[membership.kindergartenId]}`
        : "Бүх багш",
    });
  }

  for (const group of [...facts.teachingGroups, ...facts.guardianGroups]) {
    const key = GROUP_ROOM(group.id);
    if (rooms.has(key)) continue;
    rooms.set(key, {
      key,
      kind: "GROUP",
      kindergartenId: group.kindergartenId,
      groupId: group.id,
      name: group.name,
    });
  }

  return [...rooms.values()];
}

/** Kindergarten id → name. Only used to decide whether a staff room exists. */
export type KindergartenNames = Record<string, string | undefined>;

/**
 * Is this actor in this room?
 *
 * The single predicate every read and every write goes through. A caller that
 * has a `RoomKey` from the client must pass it here before touching a message —
 * a key is guessable (`group:` plus any uuid), so it authorizes nothing on its
 * own.
 */
export function canAccessRoom(actor: Actor, facts: ChatAccessFacts, key: RoomKey): boolean {
  return roomsFor(actor, facts, {}).some((room) => room.key === key);
}

/** The room a key names, or `null` when the actor is not in it. */
export function resolveRoom(
  actor: Actor,
  facts: ChatAccessFacts,
  key: RoomKey,
  names: KindergartenNames = {},
): Room | null {
  return roomsFor(actor, facts, names).find((room) => room.key === key) ?? null;
}
