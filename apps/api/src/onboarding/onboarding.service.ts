import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { StorageService } from "../storage/storage.service";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { UsersRepository } from "../users/users.repository";
import type {
  ApplicationApproval,
  ApplicationReceipt,
  KindergartenApplication,
} from "@kinder/contracts";
import type { Actor } from "../authz/actor";
import { PlatformAccessService } from "../authz/platform-access.service";
import { AuditRepository } from "../audit/audit.repository";
import { ReportsQueue } from "../reports/reports.queue";
import { ReportsRepository } from "../reports/reports.repository";
import { OnboardingRepository } from "./onboarding.repository";
import { contractNumberPrefix, nextContractNumber } from "./contract-number";
import type {
  ApproveApplicationDto,
  ListApplicationsQuery,
  RejectApplicationDto,
  SubmitApplicationDto,
} from "./onboarding.dto";

/**
 * Onboarding — `docs/CONTRACT_ONBOARDING.md`, steps 1–4.
 *
 * ★ The one service in the product with a method reachable without a session.
 * `submit` below is called from a `@Public()` route, and every decision in it
 * is shaped by that.
 */
/** Matches `PlatformService` and `UsersService` — an invitation is an
 * invitation wherever it is issued. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly platform: PlatformAccessService,
    private readonly repo: OnboardingRepository,
    private readonly audit: AuditRepository,
    private readonly reports: ReportsRepository,
    private readonly queue: ReportsQueue,
    private readonly storage: StorageService,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Step 2 — a kindergarten asks to join.
   *
   * ★★★ **The response is identical whether or not the registration number is
   * already on file.**
   *
   * The obvious implementation returns a 409 on a duplicate. That turns a
   * public form into an oracle: anyone could type registration numbers and
   * learn which kindergartens have a relationship with this platform. So a
   * repeat submission is *recorded as a no-op* and answered with the existing
   * application's receipt — the caller cannot tell the two cases apart, and a
   * genuine kindergarten resubmitting their form sees no error either.
   *
   * ★★ It is the same reasoning as §1.7's 404-never-403, applied to a table
   * that holds no child data. The rule there is about not confirming a record
   * exists; the risk here is the same shape.
   *
   * ★ No `Kindergarten` is created. That happens in `approve`, after a person
   * has looked at this. An anonymous request must never write into the table
   * every tenant boundary in the system is keyed on.
   */
  async submit(dto: SubmitApplicationDto): Promise<ApplicationReceipt> {
    const existing = await this.repo.findLiveByRegistration(dto.registrationNumber);
    if (existing) {
      this.logger.log(`Duplicate application for ${dto.registrationNumber} — answered as a repeat`);
      return { id: existing.id, status: existing.status };
    }

    const created = await this.repo.createApplication({
      kindergartenName: dto.kindergartenName,
      registrationNumber: dto.registrationNumber,
      address: dto.address,
      directorName: dto.directorName,
      phone: dto.phone,
      email: dto.email,
      childCount: dto.childCount,
      note: dto.note ?? null,
    });

    /*
     * ★ No `actorUserId` — there is nobody signed in. `AuditLog` allows it
     * (`actorUserId` is nullable, for exactly this class of event) and the row
     * is still worth writing: it is the only record that an application arrived
     * before anyone looked at it.
     */
    await this.audit.append({
      action: "CREATE",
      objectType: "KindergartenApplication",
      objectId: created.id,
      actorLabel: `Нээлттэй маягт — ${dto.kindergartenName}`,
      metadata: { registrationNumber: dto.registrationNumber, childCount: dto.childCount },
    });

    return created;
  }

  /**
   * A short-lived link to the generated contract — step 4's output.
   *
   * ★★ Authorization runs **strictly before** the URL is minted. A presigned
   * URL is a bearer credential: generating one for an unauthorized caller has
   * already leaked the object, whatever the response then says. The same
   * ordering `MediaService.getDownloadUrl` and `FinanceReportPdfService`
   * document, restated because getting it backwards is silent.
   *
   * ★ Superadmin only for now. Step 5 — the kindergarten downloading its own
   * contract — is second wave and needs its own authorization path, not a
   * widened version of this one.
   */
  async contractPdfUrl(actor: Actor, contractId: string) {
    this.platform.assertSuperAdmin(actor);

    const contract = await this.repo.findContractWithPdf(contractId);
    if (!contract) throw new NotFoundException();
    if (!contract.pdf) {
      throw new BadRequestException("Гэрээний PDF хараахан бэлэн болоогүй байна");
    }

    await this.audit.append({
      kindergartenId: contract.kindergartenId,
      actorUserId: actor.userId,
      action: "DOWNLOAD",
      objectType: "Contract",
      objectId: contract.id,
      metadata: { number: contract.number },
    });

    const url = await this.storage.presignedGetUrl(
      contract.pdf.storageKey,
      contract.pdf.originalName,
    );

    return { url };
  }

  async list(actor: Actor, query: ListApplicationsQuery) {
    this.platform.assertSuperAdmin(actor);
    const { items, total } = await this.repo.listApplications(query);

    return {
      items: items.map(toApplication),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(actor: Actor, id: string): Promise<KindergartenApplication> {
    this.platform.assertSuperAdmin(actor);
    const row = await this.repo.findApplication(id);
    if (!row) throw new NotFoundException();
    return toApplication(row);
  }

  /**
   * Step 3 — the operator approves, and step 4 begins.
   *
   * ★ The tenant, the application's new state and the contract are one
   * transaction (see the repository). The PDF job is enqueued **after** it
   * commits — CLAUDE.md §3.5, or the worker starts before the rows exist.
   */
  async approve(
    actor: Actor,
    id: string,
    dto: ApproveApplicationDto,
  ): Promise<ApplicationApproval> {
    this.platform.assertSuperAdmin(actor);

    const application = await this.repo.findApplication(id);
    if (!application) throw new NotFoundException();
    if (application.status !== "PENDING") {
      throw new BadRequestException("Энэ хүсэлт аль хэдийн шийдэгдсэн байна");
    }

    /*
     * ★★★ Checked before anything is written. Approving used to create a
     * kindergarten and nothing else, leaving a tenant **nobody could sign in
     * to**; it now creates the first administrator too, and a username already
     * taken must fail here rather than as a constraint violation halfway
     * through the transaction.
     */
    if (await this.users.findByUsername(dto.adminUsername)) {
      throw new ConflictException("Энэ нэвтрэх нэр аль хэдийн бүртгэлтэй байна");
    }
    if (await this.users.findByEmail(application.email)) {
      throw new ConflictException("Энэ и-мэйл аль хэдийн бүртгэлтэй байна");
    }

    /*
     * Hashing outside the transaction, exactly as `PlatformService.create`
     * does: argon2 takes hundreds of milliseconds and a transaction held open
     * for it is a transaction holding locks for it.
     */
    const passwordHash = await this.passwords.hash(randomBytes(32).toString("hex"));
    const { token, hash } = this.tokens.createOneTimeToken();
    const [lastName, ...rest] = application.directorName.trim().split(/\s+/);

    const year = new Date().getUTCFullYear();
    const last = await this.repo.lastContractNumber(contractNumberPrefix(year));
    const number = nextContractNumber(year, last);

    const { kindergartenId, admin, contract } = await this.repo.approve({
      applicationId: id,
      reviewedById: actor.userId,
      reviewNote: dto.reviewNote ?? null,
      kindergartenName: application.kindergartenName,
      kindergartenAddress: application.address,
      kindergartenPhone: application.phone,
      kindergartenEmail: application.email,
      admin: {
        username: dto.adminUsername,
        email: application.email,
        // ★ The director's name as written, split on the first space. Mongolian
        // convention puts the family name first, which is the order `lastName`
        // then `firstName` expects. A single-word name becomes the surname with
        // an empty given name, so the fallback keeps `firstName` non-empty.
        lastName: lastName ?? application.directorName,
        firstName: rest.join(" ") || application.directorName,
        passwordHash,
        invitationTokenHash: hash,
        invitationExpiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
      number,
      childCount: application.childCount,
      annualFee: dto.annualFee,
      perChildMonthlyFee: dto.perChildMonthlyFee,
      startsOn: new Date(`${dto.startsOn}T00:00:00.000Z`),
      endsOn: new Date(`${dto.endsOn}T00:00:00.000Z`),
    });

    await this.audit.append({
      kindergartenId,
      actorUserId: actor.userId,
      action: "INVITE",
      objectType: "User",
      objectId: admin.id,
      metadata: { role: "ADMIN", username: admin.username },
    });

    await this.audit.append({
      kindergartenId,
      actorUserId: actor.userId,
      action: "UPDATE",
      objectType: "KindergartenApplication",
      objectId: id,
      metadata: {
        previous: "PENDING",
        next: "APPROVED",
        contractNumber: contract.number,
        annualFee: dto.annualFee,
        perChildMonthlyFee: dto.perChildMonthlyFee,
      },
    });

    /*
     * ★★ Committed first, enqueued second — §3.5. A `ReportJob` row the worker
     * cannot see yet is a job that fails on its first attempt for no reason
     * anybody can reproduce.
     */
    const job = await this.reports.createJob({
      kindergartenId,
      childId: null,
      type: "CONTRACT",
      params: { contractId: contract.id },
      requestedById: actor.userId,
    });
    await this.queue.enqueue(job.id);

    /*
     * ★ The invitation token is returned so the operator can hand it over —
     * exactly as `PlatformService.create` does, and for the same reason: the
     * kindergarten has no account yet, so there is nobody to email it to
     * through the product's own notification path. Never logged.
     */
    return {
      ...(await this.get(actor, id)),
      invitationToken: token,
      adminUsername: admin.username,
    };
  }

  async reject(
    actor: Actor,
    id: string,
    dto: RejectApplicationDto,
  ): Promise<KindergartenApplication> {
    this.platform.assertSuperAdmin(actor);

    const application = await this.repo.findApplication(id);
    if (!application) throw new NotFoundException();
    if (application.status !== "PENDING") {
      throw new BadRequestException("Энэ хүсэлт аль хэдийн шийдэгдсэн байна");
    }

    await this.repo.reject({
      applicationId: id,
      reviewedById: actor.userId,
      reviewNote: dto.reviewNote,
    });

    await this.audit.append({
      actorUserId: actor.userId,
      action: "UPDATE",
      objectType: "KindergartenApplication",
      objectId: id,
      metadata: { previous: "PENDING", next: "REJECTED" },
    });

    return this.get(actor, id);
  }
}

/** The row shape from the repository, as the wire shape. */
function toApplication(row: {
  id: string;
  kindergartenName: string;
  registrationNumber: string;
  address: string;
  directorName: string;
  phone: string;
  email: string;
  childCount: number;
  note: string | null;
  status: string;
  reviewedAt: Date | null;
  reviewNote: string | null;
  kindergartenId: string | null;
  createdAt: Date;
  contract: {
    id: string;
    number: string;
    version: number;
    status: string;
    pdfMediaFileId: string | null;
  } | null;
}): KindergartenApplication {
  return {
    id: row.id,
    kindergartenName: row.kindergartenName,
    registrationNumber: row.registrationNumber,
    address: row.address,
    directorName: row.directorName,
    phone: row.phone,
    email: row.email,
    childCount: row.childCount,
    note: row.note,
    status: row.status as KindergartenApplication["status"],
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    kindergartenId: row.kindergartenId,
    createdAt: row.createdAt.toISOString(),
    contract: row.contract
      ? {
          id: row.contract.id,
          number: row.contract.number,
          version: row.contract.version,
          status: row.contract.status as NonNullable<KindergartenApplication["contract"]>["status"],
          pdfMediaFileId: row.contract.pdfMediaFileId,
        }
      : null,
  };
}
