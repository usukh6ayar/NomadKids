import { Injectable, NotFoundException } from "@nestjs/common";
import type { Actor } from "./actor";
import { AuthzRepository } from "./authz.repository";
import { resolveRoom, roomsFor, type Room, type RoomKey } from "./chat-access";

/**
 * Authorization for chat rooms — the third of the three access services,
 * beside `ChildAccessService` and `TenantAccessService`.
 *
 * ★ It exists rather than being folded into one of them because a room is
 * neither a child nor a kindergarten. `TenantAccessService.assertMember` would
 * let every parent in a kindergarten into every group's room, and
 * `ChildAccessService` answers about one child where a room is about a group.
 * Folding either would be the "two authorization paths behind one call site"
 * that CLAUDE.md §1.1 exists to prevent.
 *
 * ★★ **404, never 403** (§1.7). A room the actor is not in must be
 * indistinguishable from one that does not exist — otherwise `group:<uuid>`
 * becomes an oracle for "is this a real group in some kindergarten".
 */
@Injectable()
export class ChatAccessService {
  constructor(private readonly repo: AuthzRepository) {}

  /** Every room this actor belongs to, named. */
  async listRooms(actor: Actor): Promise<Room[]> {
    const facts = await this.repo.loadChatAccessFacts(actor);
    const names = await this.repo.loadKindergartenNames(actor);
    return roomsFor(actor, facts, names);
  }

  /**
   * The room, or 404.
   *
   * Every read and every write goes through this — a `RoomKey` arriving from a
   * client is a string the client chose, and `group:` plus any uuid is trivial
   * to construct. Resolving it against the actor's own rooms is what makes the
   * key inert on its own.
   */
  async assertMember(actor: Actor, key: RoomKey): Promise<Room> {
    const facts = await this.repo.loadChatAccessFacts(actor);
    const names = await this.repo.loadKindergartenNames(actor);
    const room = resolveRoom(actor, facts, key, names);
    if (!room) throw new NotFoundException();
    return room;
  }
}
