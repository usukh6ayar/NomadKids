import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ASSIGNABLE_ROLES } from "@kinder/contracts";
import { AuditRepository } from "../audit/audit.repository";
import { AuthRepository } from "../auth/auth.repository";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { PhoneVerificationService } from "../phone-verification/phone-verification.service";
import { SoloRulesService } from "../solo-teachers/solo-rules.service";
import { UsersRepository } from "./users.repository";
import type {
  AddMembershipDto,
  ChangeMembershipRoleDto,
  CreateUserDto,
  ListPositionsQuery,
  ListUsersQuery,
  UpdateMembershipProfileDto,
  UpdateProfileDto,
  UpdateUserDto,
} from "./users.dto";
import { buildStaffWorkbook } from "./staff-workbook";

function staffFilters(query: ListUsersQuery) {
  return {
    role: query.role,
    roles: query.roles,
    isActive: query.isActive,
    q: query.q,
    groupId: query.groupId,
    hasGroup: query.hasGroup,
    position: query.position,
    staffCategory: query.staffCategory,
  };
}

/**
 * A membership's live group assignments as `groups: {id, name, role}[]` —
 * the shape the directory's «Бүлэг» column and filter read.
 */
function withGroups<
  T extends {
    memberships: { assignments: { role: string; group: { id: string; name: string } }[] }[];
  },
>(user: T) {
  return {
    ...user,
    memberships: user.memberships.map(({ assignments, ...m }) => ({
      ...m,
      groups: assignments.map((a) => ({ id: a.group.id, name: a.group.name, role: a.role })),
    })),
  };
}

/** Invitation links last a week — long enough for a parent to notice the SMS. */
/**
 * Whether an e-mail sent back is the one on file, in any casing.
 *
 * ★ Inputs are lower-cased now and older rows were stored as typed, so
 * «Saraa@x.mn» on file and «saraa@x.mn» sent back is no change. It is never
 * written either: where a second account holds the lower-cased form —
 * production has two such pairs, 2026-10-13 — the write would break the
 * unique index on a save that changed nothing.
 */
function sameEmail(sent: string | null | undefined, onFile: string | null | undefined): boolean {
  return (sent ?? null)?.toLowerCase() === (onFile ?? null)?.toLowerCase();
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * An administrator-issued reset link lasts an hour.
 *
 * ★ Since 2026-10-04 this is the only reset *link* there is: self-service
 * recovery is by phone (`AuthService.confirmPasswordResetByPhone`) and nothing
 * is e-mailed any more.
 *
 * ★ Deliberately not the invitation's week. An invitation is delivered to
 * somebody who does not have an account yet and may take days to act; this is
 * handed over in person or read out down a telephone, and the whole reason it
 * exists is that the person is in front of you now.
 */
const ADMIN_PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * The refusal when an account reaches beyond this administrator —
 * `TenantAccessService.canManageAccount`. A 409, not a 404: the person is on
 * this administrator's own staff list, so their existence is no secret, and
 * the message says what to do instead.
 */
export const ACCOUNT_NOT_YOURS =
  "Энэ хүн өөр байгууллагад эсвэл эцэг эхээр бүртгэлтэй, эсвэл эрхлэгч тул нэвтрэх бүртгэлийг нь энд өөрчлөх боломжгүй. Энэ цэцэрлэгт ажиллах эрхийг нь хасаж болно.";

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly tenants: TenantAccessService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly auth: AuthRepository,
    private readonly audit: AuditRepository,
    private readonly phones: PhoneVerificationService,
    private readonly solo: SoloRulesService,
  ) {}

  async list(actor: Actor, query: ListUsersQuery) {
    // Restricting to the requested kindergarten happens after checking the
    // actor administers it — otherwise the parameter would widen the scope
    // rather than narrow it.
    const scope = query.kindergartenId
      ? (this.tenants.assertAdmin(actor, query.kindergartenId), [query.kindergartenId])
      : this.tenants.adminKindergartenIds(actor);

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.list(scope, staffFilters(query), page);
    return paginate(items.map(withGroups), total, page);
  }

  /**
   * «Excel татах» — the directory with the screen's filters, every row.
   *
   * ★ Audited as a DOWNLOAD: the file carries register numbers, and "who took
   * the staff list away with its РД" is a question somebody may need answered.
   */
  /** The posts in use in the admin's kindergartens — «Албан тушаал» filter choices. */
  async listPositions(actor: Actor, query: ListPositionsQuery) {
    const scope = query.kindergartenId
      ? (this.tenants.assertAdmin(actor, query.kindergartenId), [query.kindergartenId])
      : this.tenants.adminKindergartenIds(actor);
    return this.repo.listPositions(scope, query.roles);
  }

  async exportStaff(actor: Actor, query: ListUsersQuery) {
    const scope = query.kindergartenId
      ? (this.tenants.assertAdmin(actor, query.kindergartenId), [query.kindergartenId])
      : this.tenants.adminKindergartenIds(actor);
    const rows = await this.repo.listForExport(scope, staffFilters(query));
    const buffer = await buildStaffWorkbook(rows);

    await this.audit.append({
      action: "DOWNLOAD",
      kindergartenId: query.kindergartenId ?? scope[0] ?? null,
      actorUserId: actor.userId,
      objectType: "StaffDirectory",
      objectId: query.kindergartenId ?? null,
      metadata: { rows: rows.length },
    });

    return { buffer, filename: `staff-${new Date().toISOString().slice(0, 10)}.xlsx` };
  }

  /**
   * «Албан тушаал», «Ангилал», «Ажилд орсон огноо» — 2026-09-27. Admin of the
   * membership's kindergarten only; anyone else gets the 404 `findMembership`
   * gives a row outside their scope. The audit row carries before and after.
   */
  async updateMembershipProfile(
    actor: Actor,
    membershipId: string,
    dto: UpdateMembershipProfileDto,
  ) {
    const membership = await this.repo.findMembership(
      membershipId,
      this.tenants.adminKindergartenIds(actor),
    );
    if (!membership) throw new NotFoundException();

    const data = {
      ...(dto.position !== undefined ? { position: dto.position || null } : {}),
      ...(dto.staffCategory !== undefined ? { staffCategory: dto.staffCategory } : {}),
      ...(dto.startedOn !== undefined
        ? { startedOn: dto.startedOn ? new Date(`${dto.startedOn}T00:00:00.000Z`) : null }
        : {}),
    };
    const updated = await this.repo.updateMembershipProfile(membership.id, data);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: membership.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Membership",
      objectId: membership.id,
      metadata: {
        before: {
          position: membership.position,
          staffCategory: membership.staffCategory,
          startedOn: membership.startedOn?.toISOString().slice(0, 10) ?? null,
        },
        after: dto,
      },
    });
    return updated;
  }

  async get(actor: Actor, id: string) {
    const user = await this.repo.findInScope(id, this.tenants.adminKindergartenIds(actor));
    if (!user) throw new NotFoundException();
    return withGroups(user);
  }

  /**
   * Creates a user and their first membership, then issues an invitation token.
   *
   * ★ No password is set. The account is created with an unusable random hash
   * and the user chooses their own password through the invitation link. An
   * admin who types a password for someone else knows that password, and
   * "temporary" credentials are permanent in practice.
   */
  async create(actor: Actor, kindergartenId: string, dto: CreateUserDto) {
    this.tenants.assertAdmin(actor, kindergartenId);
    return this.createInvitedAccount(actor, kindergartenId, dto);
  }

  /**
   * Creates a guardian account for a teacher inviting a family.
   *
   * ★ No tenant check here — the caller has already made a stronger one.
   *
   * `ChildrenService.inviteGuardian` runs `assertCanRecord` against the child,
   * which proves the actor teaches that child in that kindergarten. Re-running
   * `assertAdmin` would refuse a teacher, and loosening `create` to accept them
   * would let a teacher mint accounts with any role, in any kindergarten they
   * belong to. Two callers, two authorization paths, one account-creation
   * routine — which is why the check is at the caller and this is not exported
   * beyond the module boundary as a general "create a user".
   *
   * The role is fixed to PARENT for the same reason.
   */
  async createGuardianAccount(
    actor: Actor,
    kindergartenId: string,
    dto: Omit<CreateUserDto, "role">,
  ) {
    return this.createInvitedAccount(actor, kindergartenId, { ...dto, role: "PARENT" });
  }

  /**
   * A guardian account with nothing in it but a token.
   *
   * ★ The teacher types none of this. The handle is generated, the name is a
   * placeholder, and the guardian replaces both when they accept the invitation
   * — see `inviteGuardianSchema` for why five fields typed by the wrong person
   * became zero.
   *
   * ★★ The username is random rather than derived from anything.
   *
   * A readable handle (`ganbold-eej`) would be a guess away from another
   * family's, and the guardian never types it: they arrive through a one-time
   * link and log in afterwards with the phone number they set themselves.
   * `randomBytes(6)` is 8 base64url characters — enough that the collision
   * retry below is a formality rather than a loop anybody waits on.
   */
  async createPlaceholderGuardianAccount(actor: Actor, kindergartenId: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username = `guardian-${randomBytes(6).toString("base64url").toLowerCase()}`;
      if (await this.repo.findByUsername(username)) continue;

      return this.createInvitedAccount(actor, kindergartenId, {
        username,
        email: null,
        phone: null,
        /*
          Placeholders, replaced at acceptance. `lastName` is non-null in the
          schema and the client asked for guardians not to have to give one at
          all, so it stays empty-but-present: "Овог хэрэггүй, зөвхөн нэр".
        */
        lastName: "",
        firstName: "Асран хамгаалагч",
        role: "PARENT",
      });
    }

    throw new ConflictException("Урилга үүсгэж чадсангүй. Дахин оролдоно уу");
  }

  /**
   * Creates a member of staff's account from the ESIS roster match in
   * `StaffRegistrationService.register` — a teacher registering themselves.
   *
   * ★ **No actor, and no tenant check here — by construction.** Nobody is
   * signed in yet; that is the entire premise of self-registration. This is
   * the same shape as `createGuardianAccount`: the caller has already run the
   * authorization that matters, so re-running one here would either refuse
   * every call (there is no actor for `assertAdmin` to check) or be redundant
   * with a stronger check the caller already made. There, it is
   * `ChildrenService.inviteGuardian` proving the teacher may act on this
   * child; here, it is `StaffRegistrationService` having matched the
   * submitted register number against `EsisStaffRoster` for this exact
   * kindergarten. `esisPersonId` is passed through to `createInvitedAccount`
   * so the created row carries the ministry identity that justified it, and
   * `AuditRepository` records `source: "self-registration"` rather than
   * inventing a second audit call.
   */
  async createSelfRegisteredAccount(
    kindergartenId: string,
    dto: CreateUserDto,
    esisPersonId: string,
  ) {
    return this.createInvitedAccount(null, kindergartenId, dto, {
      extraMetadata: { source: "self-registration" },
      esisPersonId,
    });
  }

  /**
   * A member of staff's account from a director's «Урих» on an ESIS roster row
   * (`StaffRegistrationService.inviteFromRoster`) — linked to the ministry
   * record from the start, like a self-registration, but **not** marked
   * self-registered: the director made it, and «Ажилтны бүртгэл» asks who
   * signed themselves up. The caller has run `assertAdmin`.
   */
  async createRosterInvitedAccount(
    actor: Actor,
    kindergartenId: string,
    dto: CreateUserDto,
    esisPersonId: string,
  ) {
    return this.createInvitedAccount(actor, kindergartenId, dto, {
      extraMetadata: { source: "esis-roster-invitation" },
      esisPersonId,
      selfRegistered: false,
    });
  }

  private async createInvitedAccount(
    actor: Actor | null,
    kindergartenId: string,
    dto: CreateUserDto,
    options: {
      extraMetadata?: Record<string, unknown>;
      esisPersonId?: string;
      /** Defaults to "an ESIS id was given" — self-registration's own case. */
      selfRegistered?: boolean;
    } = {},
  ) {
    // A solo teacher's workspace takes parents only (the user, 2026-10-11).
    await this.solo.assertRoleAllowed(kindergartenId, dto.role);

    // Checked explicitly so a collision is a readable 409 rather than a raw
    // unique-constraint error surfacing as a 500.
    if (await this.repo.findByUsername(dto.username)) {
      throw new ConflictException("Энэ нэвтрэх нэр аль хэдийн бүртгэлтэй байна");
    }
    if (dto.email && (await this.repo.findByEmail(dto.email))) {
      throw new ConflictException("Энэ и-мэйл аль хэдийн бүртгэлтэй байна");
    }
    if (dto.phone && (await this.repo.findByPhone(dto.phone))) {
      throw new ConflictException("Энэ утасны дугаар аль хэдийн бүртгэлтэй байна");
    }

    const user = await this.repo.create({
      username: dto.username,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      lastName: dto.lastName,
      firstName: dto.firstName,
      // Unusable by construction: nobody knows the input, so nobody can log in
      // until the invitation is accepted.
      passwordHash: await this.passwords.hash(randomBytes(32).toString("hex")),
      esisPersonId: options.esisPersonId ?? null,
      /*
       * ★ Set here and nowhere else — this is the only path a person can take
       * to make their own account. `esisPersonId` used to carry this meaning
       * as well, which was accurate only while self-registration was its sole
       * writer; a director can now link an invited account to its ESIS person,
       * so the two facts need two columns. See `schema.prisma`.
       */
      selfRegisteredAt:
        (options.selfRegistered ?? Boolean(options.esisPersonId)) ? new Date() : null,
    });

    await this.repo.createMembership(user.id, kindergartenId, dto.role);

    const { token, hash } = this.tokens.createOneTimeToken();
    await this.auth.createAuthToken({
      userId: user.id,
      purpose: "INVITATION",
      tokenHash: hash,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      requestedIp: null,
    });

    await this.audit.append({
      action: "INVITE",
      kindergartenId,
      actorUserId: actor?.userId ?? null,
      objectType: "User",
      objectId: user.id,
      metadata: { role: dto.role, ...options.extraMetadata },
    });

    // Returned so the caller can deliver it. Never logged in production.
    return { user, invitationToken: token };
  }

  async update(actor: Actor, id: string, dto: UpdateUserDto) {
    const scope = this.tenants.adminKindergartenIds(actor);
    const existing = await this.repo.findInScope(id, scope);
    if (!existing) throw new NotFoundException();

    // ★ The fields that act on the account rather than on this kindergarten's
    // record of the person — `TenantAccessService.canManageAccount`. Sending
    // the value the account already has is not a change.
    const touchesAccount =
      (dto.isActive !== undefined && dto.isActive !== existing.isActive) ||
      (dto.email !== undefined && !sameEmail(dto.email, existing.email)) ||
      (dto.phone !== undefined && dto.phone !== existing.phone);
    if (touchesAccount && !(await this.tenants.canManageAccount(actor, id))) {
      throw new ConflictException(ACCOUNT_NOT_YOURS);
    }

    if (dto.email && !sameEmail(dto.email, existing.email)) {
      const clash = await this.repo.findByEmail(dto.email, id);
      if (clash) throw new ConflictException("Энэ и-мэйл аль хэдийн бүртгэлтэй");
    }
    if (dto.phone && dto.phone !== existing.phone) {
      const clash = await this.repo.findByPhone(dto.phone);
      if (clash && clash.id !== id) throw new ConflictException("Энэ утас аль хэдийн бүртгэлтэй");
    }

    const { dateOfBirth, ...rest } = dto;
    if (sameEmail(rest.email, existing.email)) delete rest.email;
    const updated = await this.repo.update(id, {
      ...rest,
      ...(dateOfBirth !== undefined
        ? { dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : null }
        : {}),
    });
    await this.audit.append({
      action: "UPDATE",
      actorUserId: actor.userId,
      objectType: "User",
      objectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  /**
   * Issues a password-reset link for a member of staff — "нууц үг солих",
   * requested 2026-09-06.
   *
   * ★ It issues a link. It does **not** set a password.
   *
   * That is the same rule `createInvitedAccount` states and for the same
   * reason: an administrator who types a password for somebody else knows that
   * password, and a "temporary" one is permanent in practice. What a director
   * actually needs when a teacher is locked out is a way back in for that
   * teacher, and a one-time link is it — the teacher chooses the password and
   * nobody else ever holds it.
   *
   * ★★ It 404s for a user it cannot find — unlike the public reset by phone,
   * which must not become a user-enumeration API and answers identically for
   * every number until the number is proven; this one is
   * `@Roles("ADMIN")` and scoped to the kindergartens the actor administers,
   * so the caller already knows who is on their own staff list. Pretending
   * here would only hide a genuine mistake — a stale row, the wrong id — behind
   * a token that resets nobody.
   *
   * ★★★ Outstanding reset tokens for that user are invalidated first, exactly
   * as the self-service path does: a link issued to an address the person has
   * since lost control of stops working the moment a new one is made.
   */
  /**
   * A one-time password-reset link — a member of staff by their director, a
   * parent by their director or their child's teacher (№10). Who may is
   * `TenantAccessService.resetAuthority`: 404 for a stranger, 409 for an
   * account that is partly someone else's.
   */
  async issuePasswordReset(actor: Actor, id: string) {
    const authority = await this.tenants.resetAuthority(actor, id);
    if (authority === "unknown") throw new NotFoundException();
    if (authority === "elsewhere") throw new ConflictException(ACCOUNT_NOT_YOURS);

    const resetToken = await this.issueAccountLink(actor.userId, id, "PASSWORD_RESET");
    return { resetToken };
  }

  /**
   * A fresh invitation for a member of staff who has never signed in — seven
   * days, the earlier one spent (the frontend's backend list №25). «Урих» had
   * only the one-hour reset link to give.
   *
   * The same authority as a staff reset, and nobody who has signed in: their
   * way back is «Нууц үг сэргээх».
   */
  async issueInvitation(actor: Actor, id: string) {
    const scope = this.tenants.adminKindergartenIds(actor);
    const user = await this.repo.findInScope(id, scope);
    if (!user) throw new NotFoundException();
    if (!(await this.tenants.canManageAccount(actor, id))) {
      throw new ConflictException(ACCOUNT_NOT_YOURS);
    }
    if (user.lastLoginAt) {
      throw new ConflictException(
        "Энэ хүн системд нэвтэрсэн байна. «Нууц үг сэргээх»-ийг ашиглана уу.",
      );
    }

    const invitationToken = await this.issueAccountLink(actor.userId, id, "INVITATION");
    return { invitationToken };
  }

  /**
   * Issues a one-time link onto an account — and spends every earlier one of
   * the same purpose, so only the newest card opens anything. The operator's
   * resets (№9) come through here too.
   *
   * The actor is the one who handed it over, not the account — the
   * distinction the self-service audit row cannot make and this one must.
   * The token itself is never audited and never logged.
   */
  async issueAccountLink(
    actorUserId: string,
    userId: string,
    purpose: "PASSWORD_RESET" | "INVITATION",
  ): Promise<string> {
    await this.auth.invalidateAuthTokens(userId, purpose);

    const { token, hash } = this.tokens.createOneTimeToken();
    await this.auth.createAuthToken({
      userId,
      purpose,
      tokenHash: hash,
      expiresAt: new Date(
        Date.now() + (purpose === "INVITATION" ? INVITATION_TTL_MS : ADMIN_PASSWORD_RESET_TTL_MS),
      ),
      requestedIp: null,
    });

    await this.audit.append(
      purpose === "INVITATION"
        ? {
            action: "INVITE",
            actorUserId,
            objectType: "User",
            objectId: userId,
            metadata: { stage: "reissued_by_admin" },
          }
        : {
            action: "PASSWORD_RESET",
            actorUserId,
            objectType: "User",
            objectId: userId,
            metadata: { stage: "issued_by_admin" },
          },
    );

    return token;
  }

  async addMembership(actor: Actor, userId: string, dto: AddMembershipDto) {
    this.tenants.assertAdmin(actor, dto.kindergartenId);
    // ★ Somebody already on this administrator's staff, or an account nobody
    // else holds. Attaching a role to anybody else's id would put them in this
    // directory — and in reach of everything an administrator does to it.
    const inScope = await this.repo.findInScope(userId, this.tenants.adminKindergartenIds(actor));
    if (!inScope && !(await this.tenants.canManageAccount(actor, userId))) {
      throw new NotFoundException();
    }
    await this.solo.assertRoleAllowed(dto.kindergartenId, dto.role);

    const existing = await this.repo.findMembershipFor(userId, dto.kindergartenId, dto.role);
    if (existing) {
      // Re-granting a revoked role is the common case and should not be an
      // error — an admin re-hiring a teacher expects it to work.
      if (!existing.isActive) {
        const reactivated = await this.repo.reactivateMembership(existing.id);
        await this.audit.append({
          action: "PERMISSION_CHANGE",
          kindergartenId: dto.kindergartenId,
          actorUserId: actor.userId,
          objectType: "Membership",
          objectId: existing.id,
          metadata: { change: "reactivated", role: dto.role },
        });
        return reactivated;
      }
      throw new ConflictException("Энэ хэрэглэгч аль хэдийн энэ эрхтэй байна");
    }

    const membership = await this.repo.createMembership(userId, dto.kindergartenId, dto.role);
    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId: dto.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Membership",
      objectId: membership.id,
      metadata: { change: "granted", role: dto.role },
    });
    return membership;
  }

  /**
   * Changes a member of staff's role — "албан тушаал солих".
   *
   * ★ The two guards are the same pair every membership write uses: the row
   * must be in a kindergarten this actor administers (`adminKindergartenIds`,
   * which is what makes the 404 honest), and the *target* role must be one an
   * administrator may hand out at all.
   *
   * ★★ `ASSIGNABLE_ROLES` is checked here rather than in the schema.
   *
   * `roleSchema` is the full enum, and it has to be — it is what a `Membership`
   * row can hold, including roles this endpoint must not create. Validating
   * against the assignable list is a policy question, and policy belongs beside
   * the audit row that records the decision.
   *
   * ★★★ Changing to the role somebody already actively holds is a no-op, not a
   * conflict. An administrator pressing save on an unchanged select has not
   * made a mistake worth an error message.
   */
  async changeMembershipRole(actor: Actor, membershipId: string, dto: ChangeMembershipRoleDto) {
    const membership = await this.repo.findMembership(
      membershipId,
      this.tenants.adminKindergartenIds(actor),
    );
    if (!membership) throw new NotFoundException();

    await this.solo.assertRoleAllowed(membership.kindergartenId, dto.role);
    if (!ASSIGNABLE_ROLES.includes(dto.role as (typeof ASSIGNABLE_ROLES)[number])) {
      throw new BadRequestException("Энэ эрхийг олгох боломжгүй");
    }

    if (membership.role === dto.role && membership.isActive) return membership;

    const updated = await this.repo.changeMembershipRole(
      membership.id,
      membership.userId,
      membership.kindergartenId,
      dto.role,
    );

    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId: membership.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Membership",
      objectId: updated.id,
      // §14 asks for "өмнөх утга → шинэ утга"; a role change is exactly that
      // shape, so both ends are recorded rather than only where it landed.
      metadata: { change: "role_changed", from: membership.role, to: dto.role },
    });

    return updated;
  }

  /**
   * Revokes a membership.
   *
   * Deactivates rather than deletes, and ends the teacher's group assignments
   * with it. Leaving those open would mean reactivating the membership later
   * silently restored access to groups nobody re-granted.
   */
  async revokeMembership(actor: Actor, membershipId: string) {
    const membership = await this.repo.findMembership(
      membershipId,
      this.tenants.adminKindergartenIds(actor),
    );
    if (!membership) throw new NotFoundException();

    await this.repo.deactivateMembership(membershipId);
    await this.repo.endAssignmentsForMembership(membershipId);

    await this.audit.append({
      action: "PERMISSION_CHANGE",
      kindergartenId: membership.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Membership",
      objectId: membershipId,
      metadata: { change: "revoked", role: membership.role },
    });
  }

  /**
   * Takes back an invitation the person never used (the user, 2026-10-15).
   *
   * ★ An invitation's code is stored hashed and shown once. A director who lost
   * the card, or invited the wrong person, had no way back: the account existed,
   * so the person was off the ESIS unclaimed list for good. Revoking archives
   * the account and returns them to it, and «Урих» prints a fresh card.
   *
   * Only before the first sign-in. Somebody who has signed in has a history
   * here, and the way to stop their access is `revokeMembership`.
   */
  async revokeInvitation(actor: Actor, membershipId: string) {
    const scope = this.tenants.adminKindergartenIds(actor);
    const membership = await this.repo.findMembership(membershipId, scope);
    if (!membership) throw new NotFoundException();
    const user = await this.repo.findInScope(membership.userId, scope);
    if (!user) throw new NotFoundException();
    if (user.lastLoginAt) {
      throw new ConflictException(
        "Энэ хүн системд нэвтэрсэн тул урилгыг буцаах боломжгүй. «Идэвхгүй болгох»-ыг ашиглана уу.",
      );
    }

    const result = await this.repo.revokeInvitation(membershipId, membership.userId);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: membership.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Membership",
      objectId: membershipId,
      metadata: {
        change: "invitation_revoked",
        role: membership.role,
        userId: membership.userId,
        accountArchived: result.accountArchived,
        before: { isActive: membership.isActive, esisPersonId: result.esisPersonId },
      },
    });
  }

  // ── Own profile ───────────────────────────────────────────────────────────

  async getOwnProfile(actor: Actor) {
    const profile = await this.repo.findProfile(actor.userId);
    if (!profile) throw new NotFoundException();
    return profile;
  }

  async updateOwnProfile(actor: Actor, dto: UpdateProfileDto) {
    // The settings form sends every field on every save.
    const current = await this.repo.findProfile(actor.userId);
    if (dto.email && !sameEmail(dto.email, current?.email)) {
      const clash = await this.repo.findByEmail(dto.email, actor.userId);
      if (clash) {
        throw new ConflictException("Энэ и-мэйл аль хэдийн бүртгэлтэй");
      }
    }
    if (dto.phone) {
      const clash = await this.repo.findByPhone(dto.phone);
      if (clash && clash.id !== actor.userId) {
        throw new ConflictException("Энэ утас аль хэдийн бүртгэлтэй");
      }
    }

    const { phoneVerification, ...changes } = dto;
    if (sameEmail(changes.email, current?.email)) delete changes.email;

    /*
     * ★ A new number must be proven — verify.mn, 2026-10-01 — because the
     * phone is a login identifier and, now, the way back into the account: a
     * number typed wrong, or somebody else's, would hand the password reset
     * to whoever holds it. Clearing the phone needs no proof, and saving the
     * number already on file needs none either: the settings form sends every
     * field on every save.
     */
    if (changes.phone && this.phones.enabled) {
      if (changes.phone !== current?.phone) {
        await this.phones.consume(phoneVerification, {
          purpose: "PROFILE_PHONE",
          userId: actor.userId,
          phone: changes.phone,
        });
      }
    }

    // `isActive` is deliberately absent from UpdateProfileDto — a user must not
    // be able to reactivate an account an admin deactivated.
    return this.repo.update(actor.userId, changes);
  }

  /**
   * Starts proving a new number for one's own profile. The clash check runs
   * here too, so a number that is already somebody's is refused before the
   * person pays for an SMS rather than after.
   */
  async startOwnPhoneVerification(actor: Actor, phone: string, ipAddress: string | null) {
    const clash = await this.repo.findByPhone(phone);
    if (clash && clash.id !== actor.userId) {
      throw new ConflictException("Энэ утас аль хэдийн бүртгэлтэй");
    }
    return this.phones.start("PROFILE_PHONE", phone, actor.userId, ipAddress);
  }
}
