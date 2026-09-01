import { ForbiddenException, HttpStatus } from "@nestjs/common";
import type { Actor } from "./actor";
import { isGuardianOf, type ChildAccessFacts } from "./child-access";

/**
 * The portal access fee's gate — `нэмэлт.md` has nothing to say about this; it
 * is the client's instruction of 2026-09-01, that QPay exists to charge
 * parents for the right to use the site and for nothing else.
 *
 * ★ **This is the one place in `authz/` that does not answer with 404.**
 *
 * Everywhere else, an unauthorized child and a non-existent child must be
 * indistinguishable (`docs/SECURITY.md` §5.4) — a 403 would confirm the record
 * exists. That reasoning does not reach here. The person asking is this
 * child's own guardian; they already know the child exists, they can see them
 * at pickup, and nothing is disclosed by saying so. What a 404 *would* do is
 * hide the one fact that lets them fix it: a fee is owed.
 *
 * So this throws **402 Payment Required**, and it is deliberately a different
 * exception type from everything around it, so that nobody can widen it by
 * accident into the paths where 404 is load-bearing.
 *
 * ★★ Staff are never gated. A teacher, an admin or an accountant is doing the
 * kindergarten's work, not consuming a family's subscription — locking a
 * teacher out of their own register because a parent has not paid would break
 * the kindergarten to punish a family.
 */
export class PaymentRequiredException extends ForbiddenException {
  constructor(message: string) {
    super(message);
    this.initMessage();
    Object.defineProperty(this, "status", { value: HttpStatus.PAYMENT_REQUIRED });
  }

  override getStatus(): number {
    return HttpStatus.PAYMENT_REQUIRED;
  }
}

/** What the gate needs to know, loaded only when a fee is actually configured. */
export interface PortalAccessFact {
  /** False when `ACCESS_FEE_AMOUNT` is "0" — the gate does not exist. */
  readonly required: boolean;
  /** True when this child has a paid, unexpired subscription. */
  readonly active: boolean;
}

/**
 * Whether this actor must pay before reading this child.
 *
 * Pure, and separate from `canAccessChild` on purpose: "may this person see
 * this child at all" and "has this family paid" are different questions with
 * different answers and different HTTP statuses. Folding the second into the
 * first would turn an unpaid fee into a 404 and lose the distinction the
 * comment above exists to protect.
 */
export function isPortalAccessBlocked(
  actor: Actor,
  facts: ChildAccessFacts,
  access: PortalAccessFact,
): boolean {
  if (!access.required) return false;
  if (access.active) return false;
  // Staff pass regardless — see ★★ above.
  return isGuardianOf(actor, facts);
}
