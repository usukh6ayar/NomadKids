import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { EsisInstitutionStaff } from "@kinder/contracts";
import { AuditRepository } from "../audit/audit.repository";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { PlatformAccessService } from "../authz/platform-access.service";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { DashboardRepository } from "../dashboard/dashboard.repository";
import { EsisInstitutionLookupService } from "../integrations/esis/esis-institution-lookup.service";
import { UsersRepository } from "../users/users.repository";
import type { UpdateKindergartenDto } from "../tenants/tenants.dto";
import { PlatformRepository } from "./platform.repository";
import type {
  CreateKindergartenAdminDto,
  CreateKindergartenDto,
  DeleteKindergartenDto,
  ListPlatformKindergartensQuery,
} from "./platform.dto";

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
    private readonly dashboard: DashboardRepository,
    private readonly lookup: EsisInstitutionLookupService,
  ) {}

  async create(actor: Actor, dto: CreateKindergartenDto) {
    this.platform.assertSuperAdmin(actor);

    await this.assertIdentifiersFree(dto.admin);

    /*
     * ★ The lookup runs again here, server-side, even though the screen that
     * sent this body has already shown the operator the very same answer.
     *
     * The name and the address in the body are just text: nobody's
     * authorization depends on them, and an operator who mistypes one corrects
     * it on the next screen. The institution id is a different kind of value —
     * it decides a **mapping**, and every ESIS read and write this tenant ever
     * makes is scoped by it. So it is verified where it is stored rather than
     * where it was typed: a hand-made request must not be able to save an id
     * the ministry never granted this deployment.
     *
     * ★★ After `assertIdentifiersFree`, so a body that is going to collide on
     * its username does not spend a round trip to the ministry first.
     *
     * ★★★ `actor` is handed over because `lookup` asserts superadmin for
     * itself — this is the caller its docblock names as the reason it does.
     * The `@SuperAdmin()` on this controller is a filter in front of the
     * decision, not the decision. CLAUDE.md §1.1.
     */
    const institution = dto.esisInstitutionId
      ? await this.lookup.lookup(actor, dto.esisInstitutionId)
      : null;

    if (institution?.alreadyUsed) {
      throw new ConflictException(`Энэ институц аль хэдийн бүртгэлтэй: ${institution.name}`);
    }

    /*
     * The staff row that becomes the first director. `undefined` when the
     * operator named nobody, which is allowed — the admin is then described
     * entirely by the body.
     *
     * ★ The find and the throw are one block on purpose. `createKindergartenSchema`
     * already refuses an `adminEsisPersonId` with no `esisInstitutionId`, so
     * `institution` cannot be null here — but written as two statements this
     * would be correct only for as long as the two files agree, and a loosened
     * refine would turn a missing institution into «this person is not on the
     * staff list», a sentence about a list nobody asked for.
     */
    let chosen: EsisInstitutionStaff | undefined;
    if (dto.adminEsisPersonId) {
      chosen = institution?.staff.find((person) => person.personId === dto.adminEsisPersonId);
      if (!chosen) {
        throw new ConflictException("Сонгосон ажилтан ESIS-ийн жагсаалтад алга байна.");
      }
    }

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
          /*
           * ★ When a roster row was chosen, the **roster's** spelling of the
           * name wins over the body's. It is the ministry's own, and it is what
           * a member of staff is matched against at self-registration; two
           * spellings of one person is how that match silently stops working.
           *
           * ★★ `username` still comes from the body, always. A login name is
           * not a name — it is something a person has to be able to type and
           * remember, and a Mongolian name has no single obvious latin form.
           */
          lastName: chosen?.lastName ?? dto.admin.lastName,
          firstName: chosen?.firstName ?? dto.admin.firstName,
          passwordHash,
          invitationTokenHash: hash,
          invitationExpiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
        esis: institution
          ? {
              institutionId: institution.institutionId,
              // `suggestedRole` is advice for the screen and has no column;
              // everything else the roster stores comes straight across.
              staff: institution.staff.map((person) => ({
                personId: person.personId,
                registerNumber: person.registerNumber,
                lastName: person.lastName,
                firstName: person.firstName,
                jobCode: person.jobCode,
                positionName: person.positionName,
              })),
            }
          : null,
      });
    } catch (error) {
      // The pre-check above closes the common case; this closes the race
      // between it and the insert. Without it a concurrent duplicate surfaces
      // as a 500.
      if (isUniqueViolation(error)) {
        /*
         * ★ Two different facts arrive here under one Prisma code, and the
         * institution one is not a race.
         *
         * `alreadyUsed` above is genuinely narrower than the unique index it
         * stands for: `findKindergartenByInstitutionId` filters
         * `deletedAt: null`, and a **soft-deleted** kindergarten still holds
         * its institution id. So the insert can fail on `esisInstitutionId`
         * after the pre-check truthfully said no live kindergarten has it —
         * and reporting that as a duplicate username would send the operator
         * to change a field that was never the problem.
         */
        if (uniqueViolationMentions(error, "esisInstitutionId")) {
          throw new ConflictException(
            "Энэ ESIS байгууллагын код өөр цэцэрлэгтэй холбогдсон байна.",
          );
        }
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
    if (institution) {
      /*
       * ★ The same shape `EsisAdminService.updateMapping` writes, so the two
       * ways a kindergarten comes to be mapped read alike in one log.
       *
       * ★★ No register number and no name in the metadata, ever. A roster
       * refresh records `{ count, skipped }` and not who, and a mapping made at
       * creation time must not be the exception — `rosterCount` says how much
       * arrived and `adminFromRoster` says whether the director was picked from
       * it, without saying who anybody is.
       */
      await this.audit.append({
        action: "CREATE",
        kindergartenId: created.kindergarten.id,
        actorUserId: actor.userId,
        objectType: "EsisMapping",
        objectId: created.kindergarten.id,
        metadata: {
          mapped: true,
          environment: "PRODUCTION",
          fields: ["esisInstitutionId"],
          rosterCount: institution.staff.length,
          adminFromRoster: Boolean(chosen),
        },
      });
    }

    // The token is returned so the operator can hand it over, exactly as the
    // teacher-invites-a-family flow does. Never logged.
    return { ...created, invitationToken: token };
  }

  /** RFP §12.2 — system-wide totals for the platform operator's dashboard. */
  async stats(actor: Actor) {
    this.platform.assertSuperAdmin(actor);
    /*
     * ★ One round trip for both halves. The ESIS figures answer the same
     * question the totals do — "how much of this is real" — and fetching them
     * separately would let an operator watch the two disagree while one was
     * still in flight.
     */
    const [totals, esis] = await Promise.all([
      this.repo.platformTotals(),
      this.repo.platformEsisTotals(),
    ]);
    return { ...totals, esis };
  }

  async list(actor: Actor, query: ListPlatformKindergartensQuery) {
    this.platform.assertSuperAdmin(actor);

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.list({ q: query.q, isActive: query.isActive }, page);
    return paginate(items, total, page);
  }

  /**
   * The detail view: the kindergarten row plus the same shape
   * `DashboardService.admin()` gives that kindergarten's own admin — counts,
   * this term's assessment coverage and recent audit activity — scoped to
   * just this one kindergarten rather than the caller's memberships, since a
   * superadmin holds none. CLAUDE.md §1.1.
   */
  async get(actor: Actor, id: string) {
    this.platform.assertSuperAdmin(actor);

    const kindergarten = await this.repo.findById(id);
    if (!kindergarten) throw new NotFoundException();

    const term = await this.dashboard.currentTerm([id], new Date());
    const [counts, assessmentCoverage, recentActivity, admins] = await Promise.all([
      this.dashboard.kindergartenCounts([id]),
      term ? this.dashboard.assessmentCoverage([id], term.id) : Promise.resolve([]),
      this.dashboard.recentAuditEntries([id]),
      this.repo.listAdmins(id),
    ]);

    return {
      ...kindergarten,
      counts,
      currentTerm: term ? { id: term.id, number: term.number, name: term.name } : null,
      assessmentCoverage,
      recentActivity,
      admins,
    };
  }

  /**
   * A second Захирал/Эрхлэгч for a kindergarten that already exists.
   *
   * ★ Why the operator needs this at all. `POST /kindergartens/:id/users` —
   * the route `/admin/users` calls — is `@Roles("ADMIN")`, and a superadmin
   * holds no membership, so it answers them 404. That is right (§1.1) and it
   * left one situation with no way out inside the product: a kindergarten
   * whose only director cannot sign in, because the invitation was closed
   * without being handed over, or expired, or the person left. The answer was
   * a shell on the server, which is not an answer for a platform operator
   * onboarding kindergartens.
   *
   * ★★ **This grants no capability the operator did not already have.**
   * Registering a kindergarten creates its first ADMIN and hands the operator
   * that invitation — so "the operator can mint an administrator of a tenant
   * and hold the token" has been true since `createWithAdmin` was written.
   * This is the same act at a later moment, and refusing it here while
   * allowing it at registration would be a rule that only inconveniences the
   * honest case.
   *
   * What it does add is a **record**: an audit row naming the operator, the
   * kindergarten and the account. The registration path writes one too, and
   * this is the other half of that pair.
   *
   * ★★★ No password is set, generated or accepted — the same construction as
   * every other invitation in this system. The operator hands over a link;
   * the person chooses their own password. An operator who typed one would
   * know it.
   */
  async addAdmin(actor: Actor, kindergartenId: string, dto: CreateKindergartenAdminDto) {
    this.platform.assertSuperAdmin(actor);

    const kindergarten = await this.repo.findById(kindergartenId);
    if (!kindergarten) throw new NotFoundException();

    /*
     * ★ On a mapped kindergarten the person must come from **its own ESIS
     * staff list** — client, 2026-09-19. Not a browser-side filter: the check
     * is here, against the ministry's live answer, because a hand-made request
     * must not be able to install an administrator the institution has never
     * employed.
     *
     * ★★ Re-read rather than trusted from the body, exactly as `create` does
     * with `adminEsisPersonId`. The screen has already shown the operator this
     * same list; that is a convenience, not evidence.
     *
     * ★★★ An **unmapped** kindergarten skips all of it and takes the body's
     * names. There is no institution to read a list from, and refusing here
     * would make a manually-registered tenant whose director cannot sign in
     * unrescuable — which is the exact hole this method was added to close.
     */
    let chosen: EsisInstitutionStaff | undefined;
    if (kindergarten.esisInstitutionId) {
      if (!dto.esisPersonId) {
        throw new BadRequestException("Удирдлагыг ESIS-ийн ажилтны жагсаалтаас сонгоно уу.");
      }

      const institution = await this.lookup.lookup(actor, kindergarten.esisInstitutionId);
      chosen = institution.staff.find((person) => person.personId === dto.esisPersonId);
      if (!chosen) {
        throw new ConflictException("Сонгосон ажилтан ESIS-ийн жагсаалтад алга байна.");
      }
    } else if (dto.esisPersonId) {
      throw new BadRequestException(
        "Энэ цэцэрлэг ESIS-д холбогдоогүй тул ажилтныг жагсаалтаас сонгох боломжгүй.",
      );
    }

    await this.assertIdentifiersFree({ ...dto, phone: null });

    // Hashing outside the transaction — argon2 takes hundreds of milliseconds
    // and a transaction held open for it is a transaction holding locks for it.
    const passwordHash = await this.passwords.hash(randomBytes(32).toString("hex"));
    const { token, hash } = this.tokens.createOneTimeToken();

    let user;
    try {
      user = await this.repo.createAdminForExisting({
        kindergartenId,
        username: dto.username,
        email: dto.email ?? null,
        // The ministry's spelling wins when a roster row was chosen — see the
        // DTO's third note.
        lastName: chosen?.lastName ?? dto.lastName,
        firstName: chosen?.firstName ?? dto.firstName,
        passwordHash,
        invitationTokenHash: hash,
        invitationExpiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      });
    } catch (error) {
      // Closes the race between the pre-check and the insert, exactly as
      // `create` does. Without it a concurrent duplicate is a 500.
      if (isUniqueViolation(error)) {
        throw new ConflictException("Энэ нэвтрэх нэр эсвэл и-мэйл аль хэдийн бүртгэлтэй байна");
      }
      throw error;
    }

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "User",
      objectId: user.id,
      metadata: {
        username: user.username,
        role: "ADMIN",
        by: "platform-operator",
        esisPersonId: chosen?.personId ?? null,
      },
    });

    // The token is returned so the operator can hand it over. Never logged.
    return { user, invitationToken: token };
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
   * Retires a kindergarten — the operator's "Устгах".
   *
   * ★ It is a **soft** delete (§3.2) and the audit row is written after the
   * commit (§3.5). `PlatformRepository.softDelete` documents what moves and
   * what deliberately does not.
   *
   * ★★ The caller must type the kindergarten's name back.
   *
   * Deactivating is reversible in one click and this is not — it closes every
   * membership in the tenant, so a director and thirteen staff lose their way
   * in at once. A `window.confirm` is dismissed by reflex; retyping a name is
   * the cheapest control that cannot be. The comparison is trimmed and
   * case-insensitive: the point is to make the operator read which
   * kindergarten they are on, not to test their typing.
   *
   * ★★★ The count of what was closed goes in the response as well as the
   * audit row, so the screen can say what actually happened rather than
   * "Амжилттай".
   */
  async remove(actor: Actor, id: string, dto: DeleteKindergartenDto) {
    this.platform.assertSuperAdmin(actor);

    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException();

    const typed = dto.confirmName.trim().toLocaleLowerCase("mn-MN");
    const actual = existing.name.trim().toLocaleLowerCase("mn-MN");
    if (typed !== actual) {
      throw new BadRequestException("Цэцэрлэгийн нэрийг яг таг бичнэ үү");
    }

    const footprint = await this.repo.footprint(id);
    const { closedMemberships } = await this.repo.softDelete(id);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: id,
      actorUserId: actor.userId,
      objectType: "Kindergarten",
      objectId: id,
      /*
       * `before` nested in `metadata`, matching `invoices.service.ts` — the
       * `AuditEntry` shape has no column of its own for it.
       *
       * The whole prior state, because there is no live row left to read it
       * off: §14's "Өмнөх утга → Шинэ утга" for the one record whose new value
       * is "gone". The ESIS institution id especially — the mapping is
       * released here, so this row becomes the only trace that this tenant
       * ever held it.
       */
      metadata: {
        before: {
          name: existing.name,
          isActive: existing.isActive,
          esisInstitutionId: existing.esisInstitutionId,
        },
        footprint,
        closedMemberships,
      },
    });

    return { id, name: existing.name, closedMemberships, ...footprint };
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

/**
 * Whether a unique violation was about a particular column.
 *
 * ★ **Prisma 7 does not populate `meta.target`.** With a driver adapter the
 * column arrives nested and quoted instead —
 * `meta.driverAdapterError.cause.constraint.fields: ["\"esisInstitutionId\""]`
 * — with the index name in `originalMessage` beside it. Measured 2026-09-19
 * against Postgres: reading `meta.target` returned `undefined` every time, so
 * the first version of this branch reported every collision as a duplicate
 * username.
 *
 * So the whole `meta` is serialised and searched rather than one path being
 * read. That is blunt on purpose. A column name is specific enough that a
 * false positive would need a *second* column whose name contains it, while a
 * path that moves between Prisma releases fails **silently** — and a silent
 * failure here is an operator being told to change the one field that was
 * fine. The `meta`-less shape a test double throws is simply not a match,
 * which is the right answer for it.
 */
function uniqueViolationMentions(error: unknown, column: string): boolean {
  const meta = (error as { meta?: unknown } | null)?.meta;
  return meta !== undefined && meta !== null && JSON.stringify(meta).includes(column);
}
