import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { AuditRepository } from "../audit/audit.repository";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { PlatformAccessService } from "../authz/platform-access.service";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { UsersRepository } from "../users/users.repository";
import type { UpdateKindergartenDto } from "../tenants/tenants.dto";
import { PlatformRepository } from "./platform.repository";
import type { CreateKindergartenDto, ListPlatformKindergartensQuery } from "./platform.dto";

/** Matches UsersService — an invitation is an invitation wherever it is issued. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Registering and administering kindergartens as the platform operator.
 *
 * Every method opens with `assertSuperAdmin`. The guard on the controller says
 * the same thing, and both are kept: the guard makes a forgotten decorator
 * fail closed, this makes a forgotten guard fail closed.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly repo: PlatformRepository,
    private readonly platform: PlatformAccessService,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditRepository,
  ) {}

  async create(actor: Actor, dto: CreateKindergartenDto) {
    this.platform.assertSuperAdmin(actor);

    await this.assertIdentifiersFree(dto.admin);

    // Hashing is deliberately outside the transaction: argon2 takes hundreds of
    // milliseconds and a transaction held open for it is a transaction holding
    // locks for it.
    const passwordHash = await this.passwords.hash(randomBytes(32).toString("hex"));
    const { token, hash } = this.tokens.createOneTimeToken();

    let created;
    try {
      created = await this.repo.createWithAdmin({
        kindergarten: dto,
        admin: {
          username: dto.admin.username,
          email: dto.admin.email ?? null,
          phone: dto.admin.phone ?? null,
          lastName: dto.admin.lastName,
          firstName: dto.admin.firstName,
          passwordHash,
          invitationTokenHash: hash,
          invitationExpiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
      });
    } catch (error) {
      // The pre-check above closes the common case; this closes the race
      // between it and the insert. Without it a concurrent duplicate surfaces
      // as a 500.
      if (isUniqueViolation(error)) {
        throw new ConflictException("Энэ нэвтрэх нэр, и-мэйл эсвэл утас аль хэдийн бүртгэлтэй");
      }
      throw error;
    }

    // After the commit. A log row written inside the transaction would describe
    // a kindergarten that can still roll back. CLAUDE.md §3.5.
    await this.audit.append({
      action: "CREATE",
      kindergartenId: created.kindergarten.id,
      actorUserId: actor.userId,
      objectType: "Kindergarten",
      objectId: created.kindergarten.id,
    });
    await this.audit.append({
      action: "INVITE",
      kindergartenId: created.kindergarten.id,
      actorUserId: actor.userId,
      objectType: "User",
      objectId: created.admin.id,
      metadata: { role: "ADMIN" },
    });

    // The token is returned so the operator can hand it over, exactly as the
    // teacher-invites-a-family flow does. Never logged.
    return { ...created, invitationToken: token };
  }

  async list(actor: Actor, query: ListPlatformKindergartensQuery) {
    this.platform.assertSuperAdmin(actor);

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.list({ q: query.q, isActive: query.isActive }, page);
    return paginate(items, total, page);
  }

  async get(actor: Actor, id: string) {
    this.platform.assertSuperAdmin(actor);

    const kindergarten = await this.repo.findById(id);
    if (!kindergarten) throw new NotFoundException();
    return kindergarten;
  }

  async update(actor: Actor, id: string, dto: UpdateKindergartenDto) {
    this.platform.assertSuperAdmin(actor);

    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException();

    const updated = await this.repo.update(id, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: id,
      actorUserId: actor.userId,
      objectType: "Kindergarten",
      objectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  /**
   * Checked explicitly so a collision is a readable 409 rather than a raw
   * unique-constraint error surfacing as a 500. Mirrors UsersService.
   */
  private async assertIdentifiersFree(admin: CreateKindergartenDto["admin"]): Promise<void> {
    if (await this.users.findByUsername(admin.username)) {
      throw new ConflictException("Энэ нэвтрэх нэр аль хэдийн бүртгэлтэй байна");
    }
    if (admin.email && (await this.users.findByEmail(admin.email))) {
      throw new ConflictException("Энэ и-мэйл аль хэдийн бүртгэлтэй байна");
    }
    if (admin.phone && (await this.users.findByPhone(admin.phone))) {
      throw new ConflictException("Энэ утасны дугаар аль хэдийн бүртгэлтэй байна");
    }
  }
}

/** Prisma's unique-constraint code. Narrowed without importing the client. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
