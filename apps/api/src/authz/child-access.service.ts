import { Injectable, NotFoundException } from "@nestjs/common";
import { AuthzRepository } from "./authz.repository";
import type { Actor } from "./actor";
import {
  canAccessChild,
  canAdministerChild,
  canContributeMediaForChild,
  canRecordForChild,
  type ChildAccessFacts,
} from "./child-access";

/**
 * The service every endpoint touching child data calls.
 *
 * ★ These throw `NotFoundException`, never `ForbiddenException`. An
 * unauthorized child and a non-existent child must be indistinguishable — a 403
 * confirms the record exists, which answers "is there a child with id X in this
 * system". Same status, same body, and the response time must not differ
 * either. docs/SECURITY.md §5.4.
 *
 * Usage in a controller is one line:
 *
 *   await this.childAccess.assertCanAccess(actor, childId);
 */
@Injectable()
export class ChildAccessService {
  constructor(private readonly repo: AuthzRepository) {}

  /** Throws 404 unless the actor may READ this child. */
  async assertCanAccess(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canAccessChild(actor, facts)) throw new NotFoundException();
    return facts;
  }

  /**
   * Throws 404 unless the actor may WRITE about this child.
   *
   * Note it is 404 and not 403 even for the child's own guardian, who can
   * demonstrably see the record. Returning 403 here would leak nothing new
   * about *that* child, but it would make the endpoint's behaviour depend on
   * whether the resource exists — and then a 403/404 difference elsewhere
   * becomes an oracle. One rule, applied everywhere, is easier to keep right.
   */
  async assertCanRecord(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canRecordForChild(actor, facts)) throw new NotFoundException();
    return facts;
  }

  /**
   * Throws 404 unless the actor may add a photograph to this child's album —
   * staff, or one of this child's own guardians. RFP §2.3.
   */
  async assertCanContributeMedia(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canContributeMediaForChild(actor, facts)) throw new NotFoundException();
    return facts;
  }

  /** Throws 404 unless the actor may administer this child (admins only). */
  async assertCanAdminister(actor: Actor, childId: string): Promise<ChildAccessFacts> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    if (!facts || !canAdministerChild(actor, facts)) throw new NotFoundException();
    return facts;
  }

  /** Non-throwing variant, for list filtering and conditional UI hints. */
  async canAccess(actor: Actor, childId: string): Promise<boolean> {
    const facts = await this.repo.loadChildAccessFacts(actor, childId);
    return facts !== null && canAccessChild(actor, facts);
  }
}
