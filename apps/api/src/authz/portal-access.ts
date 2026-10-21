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
 * ★★ Staff of a contracted kindergarten are never gated. A teacher, an admin
 * or an accountant is doing the kindergarten's work, not consuming a family's
 * subscription — locking a teacher out of their own register because a parent
 * has not paid would break the kindergarten to punish a family.
 *
 * ★★★ **Except in a solo teacher's own workspace** (the user, 2026-10-11).
 * There is no kindergarten paying a contract: the family's fee is the whole
 * of what pays for that teacher's use, so a child is inactive — every action
 * the teacher would take for them — until it is paid. The 402 argument is
 * unchanged: authorization has already run, the teacher already knows the
 * child, a stranger still gets 404. Registering the child, inviting the
 * family and seeing who has paid are not behind this gate.
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

/** The deployment's fee settings — `ACCESS_FEE_AMOUNT`, `ACCESS_FEE_FREE_UNTIL`. */
export interface PortalFeeSettings {
  readonly amount: string;
  /** `YYYY-MM-DD`, inclusive, or "" for none. */
  readonly freeUntil: string;
}

/**
 * Whether the portal fee is charged on `today` (Ulaanbaatar's `YYYY-MM-DD`).
 *
 * "0" never charges. A free period (the user, 2026-10-21) charges nobody
 * through its last day and ends by itself — a date compared per request, not
 * a flag read at boot, or the gate would stay open until the next deploy.
 */
export function isPortalFeeCharging(fee: PortalFeeSettings, today: string): boolean {
  if (fee.amount === "0") return false;
  return !(fee.freeUntil && today <= fee.freeUntil);
}

/** What the gate needs to know, loaded only when a fee is actually configured. */
export interface PortalAccessFact {
  /** False when `ACCESS_FEE_AMOUNT` is "0" — the gate does not exist. */
  readonly required: boolean;
  /** True when this child has a paid, unexpired subscription. */
  readonly active: boolean;
}

/**
 * Whom the unpaid fee stops from reaching this child: `"guardian"` (their own
 * family must pay), `"soloStaff"` (a solo teacher, whose family has not paid —
 * ★★★ above), or `null`.
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
  options: { gateSoloStaff?: boolean } = {},
): "guardian" | "soloStaff" | null {
  if (!access.required) return null;
  if (access.active) return null;
  if (isGuardianOf(actor, facts)) return "guardian";
  // Contracted staff pass regardless — ★★; a solo workspace's do not — ★★★.
  const gateSolo = options.gateSoloStaff ?? true;
  return gateSolo && facts.childKindergartenKind === "SOLO_TEACHER" ? "soloStaff" : null;
}
