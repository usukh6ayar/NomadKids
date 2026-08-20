import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { AuditRepository } from "../audit/audit.repository";
import { AuthRepository } from "../auth/auth.repository";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { UsersRepository } from "./users.repository";
import type {
  AddMembershipDto,
  CreateUserDto,
  ListUsersQuery,
  UpdateProfileDto,
  UpdateUserDto,
} from "./users.dto";

/** Invitation links last a week — long enough for a parent to notice the SMS. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly tenants: TenantAccessService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly auth: AuthRepository,
    private readonly audit: AuditRepository,
  ) {}

  async list(actor: Actor, query: ListUsersQuery) {
    // Restricting to the requested kindergarten happens after checking the
    // actor administers it — otherwise the parameter would widen the scope
    // rather than narrow it.
    const scope = query.kindergartenId
      ? (this.tenants.assertAdmin(actor, query.kindergartenId), [query.kindergartenId])
      : this.tenants.adminKindergartenIds(actor);

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.list(
      scope,
      { role: query.role, isActive: query.isActive, q: query.q },
      page,
    );
    return paginate(items, total, page);
  }

  async get(actor: Actor, id: string) {
    const user = await this.repo.findInScope(id, this.tenants.adminKindergartenIds(actor));
    if (!user) throw new NotFoundException();
    return user;
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

  private async createInvitedAccount(actor: Actor, kindergartenId: string, dto: CreateUserDto) {

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
      actorUserId: actor.userId,
      objectType: "User",
      objectId: user.id,
      metadata: { role: dto.role },
    });

    // Returned so the caller can deliver it. Never logged in production.
    return { user, invitationToken: token };
  }

  async update(actor: Actor, id: string, dto: UpdateUserDto) {
    const scope = this.tenants.adminKindergartenIds(actor);
    const existing = await this.repo.findInScope(id, scope);
    if (!existing) throw new NotFoundException();

    if (dto.email && dto.email !== existing.email) {
      const clash = await this.repo.findByEmail(dto.email);
      if (clash && clash.id !== id) throw new ConflictException("Энэ и-мэйл аль хэдийн бүртгэлтэй");
    }
    if (dto.phone && dto.phone !== existing.phone) {
      const clash = await this.repo.findByPhone(dto.phone);
      if (clash && clash.id !== id) throw new ConflictException("Энэ утас аль хэдийн бүртгэлтэй");
    }

    const updated = await this.repo.update(id, dto);
    await this.audit.append({
      action: "UPDATE",
      actorUserId: actor.userId,
      objectType: "User",
      objectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  async addMembership(actor: Actor, userId: string, dto: AddMembershipDto) {
    this.tenants.assertAdmin(actor, dto.kindergartenId);

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

  // ── Own profile ───────────────────────────────────────────────────────────

  async getOwnProfile(actor: Actor) {
    const profile = await this.repo.findProfile(actor.userId);
    if (!profile) throw new NotFoundException();
    return profile;
  }

  async updateOwnProfile(actor: Actor, dto: UpdateProfileDto) {
    if (dto.email) {
      const clash = await this.repo.findByEmail(dto.email);
      if (clash && clash.id !== actor.userId) {
        throw new ConflictException("Энэ и-мэйл аль хэдийн бүртгэлтэй");
      }
    }
    if (dto.phone) {
      const clash = await this.repo.findByPhone(dto.phone);
      if (clash && clash.id !== actor.userId) {
        throw new ConflictException("Энэ утас аль хэдийн бүртгэлтэй");
      }
    }

    // `isActive` is deliberately absent from UpdateProfileDto — a user must not
    // be able to reactivate an account an admin deactivated.
    return this.repo.update(actor.userId, dto);
  }
}
