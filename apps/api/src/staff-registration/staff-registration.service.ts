import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { PaginationQuery } from "@kinder/contracts";
import { PasswordService } from "../auth/password.service";
import { AuditRepository } from "../audit/audit.repository";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, toSkipTake, type PageParams } from "../common/pagination";
import { EsisRepository } from "../integrations/esis/esis.repository";
import { normalizeRegisterNumber, roleForJobCode } from "../integrations/esis/esis.roster";
import { UsersRepository } from "../users/users.repository";
import { UsersService } from "../users/users.service";
import { StaffRegistrationRepository } from "./staff-registration.repository";
import type { StaffSelfRegistrationDto } from "./staff-registration.dto";

/**
 * The one message every refusal in `register()` returns.
 *
 * ★★★ **Every branch below — a wrong code, a code that matches no
 * kindergarten, a register number not on that kindergarten's roster, a
 * malformed register number, a roster row too stale to trust, a jobCode this
 * product refuses to turn into a role, a person who already has an account —
 * throws this exact `UnauthorizedException` and nothing else.**
 *
 * If any two of those read differently, the response would answer "does this
 * register number belong to a member of staff at this kindergarten?" for
 * anybody who holds a code and a list of register numbers — and such lists
 * exist on paper in more than one office, per the plan this module implements
 * (design §5). The branches must never diverge, including for a future
 * "helpful" error message that names which check failed.
 */
export const REFUSAL = "Код эсвэл регистрийн дугаар буруу байна.";

/**
 * How old a stored roster row may be before a match against it is refused.
 *
 * ★ **A fail-closed guess, not a measured figure.** Thirty days is long
 * enough that a director who refreshes the roster around the time they hand
 * out a code is never tripped by it, and short enough that a roster nobody
 * has touched in a term stops minting accounts for people who may since have
 * left. The correct fix is spec №3's daily sync, which would make this number
 * nearly irrelevant; until that lands, this is what stands between an
 * unmaintained table and an account nobody should have gotten.
 */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class StaffRegistrationService {
  constructor(
    private readonly tenants: TenantAccessService,
    private readonly repo: StaffRegistrationRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditRepository,
    private readonly esisRepo: EsisRepository,
    private readonly users: UsersService,
    private readonly usersRepo: UsersRepository,
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

  /**
   * The public route: a teacher claims a kindergarten's code and their own
   * register number, and — on a match against the stored ESIS roster — gets
   * an invitation to set their own password.
   *
   * ★ **Never calls ESIS.** This is a public route; the caller has no account
   * yet. Public traffic in the ministry's logs is exactly what storing the
   * roster (`EsisStaffRoster`, filled only by `EsisAdminService.refreshStaffRoster`,
   * which is ADMIN-only) exists to prevent — design §1.1, plan §0. Every check
   * below reads this database and nothing else.
   *
   * ★★ The checks are ordered cheapest and least secret first: whether the
   * register number even has the right shape, before anything that touches
   * the database; the code, which decides which single kindergarten's roster
   * to consult, before the roster read itself. Nothing after the code match
   * costs more than one query.
   *
   * ★★★ Every refusal — including the six named in `REFUSAL`'s doc comment —
   * throws that exact exception and stops. There is no branch below that
   * returns a different status or a different message for any reason.
   */
  async register(dto: StaffSelfRegistrationDto) {
    const registerNumber = normalizeRegisterNumber(dto.registerNumber);
    if (!registerNumber) throw new UnauthorizedException(REFUSAL);

    const kindergartenId = await this.matchCode(dto.code);
    if (!kindergartenId) throw new UnauthorizedException(REFUSAL);

    const entry = await this.esisRepo.findRosterEntryByRegisterNumber(
      kindergartenId,
      registerNumber,
    );
    if (!entry) throw new UnauthorizedException(REFUSAL);

    /*
     * ★ Fail closed on a roster nobody has refreshed recently. An old roster
     * still lists the people who have left, which is exactly who must no
     * longer be able to mint an account — see `STALE_AFTER_MS`'s doc comment.
     */
    if (Date.now() - entry.syncedAt.getTime() > STALE_AFTER_MS) {
      throw new UnauthorizedException(REFUSAL);
    }

    const role = roleForJobCode(entry.jobCode);
    if (!role) throw new UnauthorizedException(REFUSAL);

    /*
     * One person in the ministry's database is one account — `User.esisPersonId`
     * is globally unique, and this is the readable refusal for the same rule
     * rather than a raw constraint violation surfacing as a 500.
     */
    if (await this.usersRepo.findByEsisPersonId(entry.esisPersonId)) {
      throw new UnauthorizedException(REFUSAL);
    }

    /*
     * ★ The username is generated, never derived from the register number —
     * the same reason `createPlaceholderGuardianAccount` generates a
     * guardian's handle: a readable one built from something typed on this
     * form would be a guess away from somebody else's account, and the
     * register number is exactly the secret this whole route treats as
     * sensitive. Retried like that method's handle, for the same reason: a
     * random collision must not surface as a 409 on a public, rate-limited
     * route that is supposed to answer only `REFUSAL` or success.
     */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username = `staff-${randomBytes(6).toString("base64url").toLowerCase()}`;
      if (await this.usersRepo.findByUsername(username)) continue;

      const { invitationToken } = await this.users.createSelfRegisteredAccount(
        kindergartenId,
        {
          username,
          email: null,
          phone: null,
          lastName: entry.lastName,
          firstName: entry.firstName,
          role,
        },
        entry.esisPersonId,
      );

      return { invitationToken };
    }

    throw new ConflictException("Бүртгэл үүсгэж чадсангүй. Дахин оролдоно уу.");
  }

  /**
   * The director's review list — Task 6, and the client's own instruction:
   * "захирал заавал батлах хэрэг байхгүй зүгээр хянахад л болно хэн хэн
   * бүртгүүлсэн байгаа эсэх мэдээлэл." There is no approval step to build;
   * this is a paginated read (CLAUDE.md §3.4), and the link a director needs
   * next — revoking one — already exists as `DELETE /v1/memberships/:id`
   * (`UsersController.revokeMembership`), which this does not duplicate.
   *
   * ★ **`registeredAt` is `Membership.createdAt`, not `User.createdAt`.**
   * They are the same instant for the common case — `createSelfRegisteredAccount`
   * creates both rows in the one call — but can diverge: a person who
   * self-registered at one kindergarten and was later *invited* into a second
   * (`addMembership`, which does not touch `esisPersonId`) would still show
   * up here for the second kindergarten, because the marker is the user's
   * `esisPersonId`, not anything membership-scoped. For that row, `User.
   * createdAt` would be the older, first kindergarten's registration date —
   * the wrong answer to "when did this person register *here*". Whichever
   * kindergarten's admin views this list wants the date of the membership in
   * front of them, which `Membership.createdAt` always is.
   */
  async listSelfRegistered(actor: Actor, kindergartenId: string, query: PaginationQuery) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const kindergarten = await this.repo.findKindergarten(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { skip, take } = toSkipTake(page);
    const [rows, total] = await this.repo.listSelfRegistered(kindergartenId, { skip, take });

    const items = rows.map((row) => ({
      membershipId: row.id,
      lastName: row.user.lastName,
      firstName: row.user.firstName,
      role: row.role,
      registeredAt: row.createdAt,
      source: "SELF_REGISTERED" as const,
    }));

    return paginate(items, total, page);
  }

  /**
   * Which kindergarten issued this code, found by trying it against every
   * stored hash.
   *
   * ★ A loop over tenants rather than an indexed lookup — there is no index
   * on a hash, because a hash exists precisely so that this kind of reverse
   * lookup cannot be done cheaply. Acceptable here because it is bounded by
   * the number of kindergartens the whole deployment has issued a code to (a
   * handful today), it runs on no route but this one, and the alternative —
   * asking the caller which kindergarten they mean, e.g. by slug — would let
   * anybody probe whether a given kindergarten has issued a code at all,
   * which is exactly the kind of oracle `REFUSAL` exists to close everywhere
   * else. If this deployment ever has enough tenants for the loop to cost
   * something real, the fix is a code that carries a short tenant prefix
   * (`"a1b2-xxxxxxxx"`), not a plaintext column — the prefix names the
   * kindergarten the same way it would for a support ticket.
   */
  private async matchCode(code: string): Promise<string | null> {
    const candidates = await this.repo.findKindergartensWithRegistrationCode();
    for (const candidate of candidates) {
      if (await this.passwords.verify(candidate.staffRegistrationCodeHash!, code)) {
        return candidate.id;
      }
    }
    return null;
  }
}
