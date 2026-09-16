import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PasswordService } from "../auth/password.service";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { StaffRegistrationRepository } from "./staff-registration.repository";

@Injectable()
export class StaffRegistrationService {
  constructor(
    private readonly tenants: TenantAccessService,
    private readonly repo: StaffRegistrationRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Issues (or rotates) the code a director hands their staff so they can
   * register themselves against the stored ESIS roster.
   *
   * ★ **A throttle, not authentication.** The real gate is the roster match in
   * `POST /v1/staff-registration` (Task 5) — a submitted register number has to
   * appear in `EsisStaffRoster` for this kindergarten, and that check runs
   * regardless of the code. The code's only job is to keep that public,
   * rate-limited endpoint from being a free-for-all against every kindergarten
   * in the deployment at once: without it, anybody who found or guessed a
   * register number could try it against any tenant's roster.
   *
   * ★★ **Hashed anyway.** It is a secret shared among roughly a dozen people,
   * which is a weaker thing than a password — but a plaintext column is one
   * database read away from letting anybody register as any member of staff at
   * any kindergarten, and hashing it costs nothing. Reused rather than
   * reimplemented: `PasswordService` is already the one hashing primitive in
   * this codebase (CLAUDE.md §2.2's argument applies just as well to a second
   * hash function as to a second Prisma import), so this calls `hash()` and
   * later `verify()` exactly as a login does.
   *
   * ★★★ **Shown once.** The return value is the only time the plaintext ever
   * exists outside the director's clipboard — the same reason a password-reset
   * link is single-use: the system can always issue a new one, and never reads
   * the old one back. The audit row below records that a code was issued, not
   * what it was.
   */
  async issueCode(actor: Actor, kindergartenId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const code = randomBytes(6).toString("base64url");
    const hash = await this.passwords.hash(code);
    const setAt = new Date();

    await this.repo.setRegistrationCodeHash(kindergartenId, hash, setAt);

    /*
     * ★ No code, and no hash, in the audit row. `metadata` says a rotation
     * happened and when; it must not become a second place the plaintext (or
     * something derived from it) could leak from.
     */
    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "KindergartenStaffRegistrationCode",
      objectId: kindergartenId,
      metadata: { setAt: setAt.toISOString() },
    });

    return { code, setAt };
  }
}
