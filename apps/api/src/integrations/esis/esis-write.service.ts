import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { AuditRepository } from "../../audit/audit.repository";
import { paginate, toSkipTake } from "../../common/pagination";
import type { Actor } from "../../authz/actor";
import { TenantAccessService } from "../../authz/tenant-access.service";
import {
  buildGroupPayload,
  ESIS_GROUP_WRITE_CONTRACT_PROVEN,
  ESIS_WRITE_ENDPOINT,
  readGroupRows,
} from "./esis-group-writes";
import { EsisService } from "./esis.service";
import type { PrepareEsisGroupWriteDto } from "./esis.dto";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { EsisRepository } from "./esis.repository";
import { EsisWriteQueue } from "./esis-write.worker";
import { EsisWriteRepository } from "./esis-write.repository";

/**
 * Each refusal a director can act on, in the language they read.
 *
 * ★ Specific, unlike the staff-registration route's deliberately identical
 * refusals (spec №2). That route is **public**, so a distinguishable message is
 * an oracle; this one is behind `@Roles("ADMIN")` and a membership check, and a
 * director who cannot tell "the roster is stale" from "this teacher does not
 * exist" cannot do anything about either.
 */
const REFUSALS: Record<string, string> = {
  ESIS_GROUP_ID_UNKNOWN:
    "ЭСИС энэ бүлгийг хараахан хараагүй байна. Эхлээд «Бүлэг үүсгэх»-ийг илгээнэ үү.",
  ESIS_GROUP_NOT_IN_MINISTRY:
    "Энэ бүлэг ЭСИС-ийн жагсаалтад олдсонгүй. Устгагдсан эсвэл өөр хичээлийн жилд байж магадгүй.",
  ESIS_LEVEL_TEMPLATE_MISSING:
    "Энэ насны түвшинд ЭСИС-д бүртгэлтэй бүлэг алга тул хөтөлбөрийн мэдээллийг хуулах эх байхгүй.",
  ESIS_GROUP_NAME_TOO_LONG:
    "ЭСИС бүлгийн нэрийг 5 тэмдэгтэд багтаахыг шаарддаг. Нэрийг богиносгоно уу.",
  ESIS_ACADEMIC_YEAR_UNKNOWN:
    "ЭСИС-ээс хичээлийн жил тодорхойлж чадсангүй. Лавлахыг шинэчлээд дахин үзнэ үү.",
  ESIS_INSTRUCTOR_ROLE_UNMAPPED: "Багшийн үүргийн төрлийг ЭСИС-ийн утгатай тааруулаагүй байна.",
  ESIS_PERSON_ID_UNKNOWN:
    "Энэ бүлгийн багшид ЭСИС-ийн дугаар алга. Багш өөрөө ЭСИС-ийн бүртгэлээр " +
    "нэвтэрсэн байх шаардлагатай.",
  ESIS_AGE_BAND_UNMAPPED: "Бүлгийн насны хэлбэрийг ЭСИС-ийн кодтой тааруулаагүй байна.",
};

/**
 * Prepare → approve → send, for the three group writes. Spec №3б.
 */
@Injectable()
export class EsisWriteRequestService {
  constructor(
    private readonly tenants: TenantAccessService,
    private readonly repo: EsisWriteRepository,
    private readonly esisRepo: EsisRepository,
    private readonly esis: EsisService,
    private readonly queue: EsisWriteQueue,
    private readonly audit: AuditRepository,
  ) {}

  async prepare(actor: Actor, kindergartenId: string, dto: PrepareEsisGroupWriteDto) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const kindergarten = await this.esisRepo.findKindergarten(kindergartenId);
    if (!kindergarten?.esisInstitutionId) {
      throw new BadRequestException("Энэ цэцэрлэг ЭСИС-т холбогдоогүй байна.");
    }

    /*
     * ★ 404 for a group outside this kindergarten (CLAUDE.md §1.7). The tenant
     * check above has already passed, so this is an administrator naming a
     * group id that belongs to somebody else — and the answer must not confirm
     * that it exists.
     */
    const group = await this.esisRepo.findGroupForWrite(kindergartenId, dto.groupId);
    if (!group) throw new NotFoundException();

    if (dto.service === "groupDelete") {
      await this.assertDeletable(kindergartenId, dto, group.name);
    }

    const teacher =
      dto.service === "groupInstructor"
        ? await this.esisRepo.findGroupTeacherForEsis(kindergartenId, dto.groupId)
        : null;

    /*
     * ★ A live read, inside prepare, and it is not avoidable.
     *
     * A create needs eight ministry-side ids — the programme, its stage for
     * this level, the plan, the shift, the classification — none of which this
     * database holds or could invent (`EsisGroupRow`). They are copied from
     * api-40's own rows. So the payload cannot be shown to anyone until those
     * rows are in hand, and showing the exact payload is the point of the step.
     *
     * ★★ Read, not stored. The ids belong to the ministry and change without
     * telling us; a cached copy would be quietly wrong on the day it mattered —
     * the same argument `funding/food-discount.ts` makes for reading
     * eligibility live.
     */
    const ministryGroups = readGroupRows(
      ((await this.esis.read("groups", {}, kindergarten.esisInstitutionId)).data ??
        []) as unknown[],
    );

    let payload: Record<string, unknown>;
    try {
      payload = buildGroupPayload({
        service: dto.service,
        group,
        institutionId: Number(kindergarten.esisInstitutionId),
        ministryGroups,
        esisPersonId: teacher?.esisPersonId ?? null,
        teacherRole: teacher?.role ?? null,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN";
      throw new BadRequestException(REFUSALS[code] ?? "Илгээх өгөгдлийг бэлтгэж чадсангүй.");
    }

    const idempotencyKey = writeKey(dto.service, dto.groupId, payload);

    /*
     * ★ Read before write, with a unique index behind it. Two directors
     * pressing the button together race here; the index decides, and the loser
     * re-reads rather than failing, because the row that already exists is the
     * answer they wanted.
     */
    const existing = await this.repo.findByIdempotencyKey(kindergartenId, idempotencyKey);
    if (existing) return existing;

    const endpointKey = ESIS_WRITE_ENDPOINT[dto.service];
    const row = await this.repo.create({
      kindergartenId,
      service: dto.service,
      apiId: ESIS_ENDPOINTS[endpointKey].apiId ?? 0,
      groupId: dto.groupId,
      payload: payload as never,
      idempotencyKey,
      preparedById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisWriteRequest",
      objectId: row.id,
      metadata: { service: dto.service, groupId: dto.groupId, apiId: row.apiId },
    });

    return row;
  }

  /**
   * The two guards on a delete, and both are about the same fact: there is no
   * undo.
   *
   * ★ The typed name is the product's ordinary destructive-action pattern
   * (CLAUDE.md §5). The second is stricter and specific to this trial — spec
   * №3б §5 opens 152's delete **only** against a group this system created in
   * ESIS itself, so the one live exercise runs against a throwaway group with
   * no children rather than against a real class.
   */
  private async assertDeletable(
    kindergartenId: string,
    dto: PrepareEsisGroupWriteDto,
    groupName: string,
  ) {
    if (dto.confirmGroupName !== groupName) {
      throw new BadRequestException("Устгахын тулд бүлгийн нэрийг яг бичнэ үү.");
    }
    const create = await this.repo.findSentCreate(kindergartenId, dto.groupId);
    if (!create) {
      throw new BadRequestException("Зөвхөн энэ системээс ЭСИС-д үүсгэсэн бүлгийг устгаж болно.");
    }
  }

  async approve(actor: Actor, kindergartenId: string, writeRequestId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const row = await this.repo.findOne(kindergartenId, writeRequestId);
    if (!row) throw new NotFoundException();
    if (row.state !== "PREPARED") {
      throw new ConflictException("Энэ илгээлт аль хэдийн шийдэгдсэн байна.");
    }

    /*
     * ★ The contract gate, and it sits on **approve** rather than on the
     * sender.
     *
     * Approval is the human decision that cannot be taken back, so it is the
     * step to close while the field names and the age-band codes are still
     * guesses (`esis-group-writes.ts`). Everything before it — preparing,
     * reading the exact payload, cancelling — works and can be exercised by a
     * director today, which is the half that needs the trial's feedback anyway.
     *
     * ★★ Not on the sender, because a gate there would make the send path
     * untestable: the tests drive `EsisWriteSender` directly against a row they
     * set to APPROVED, and a guard in front of `dispatch` would stop them
     * proving that a sent row is never sent twice. The guarantee has to stay
     * demonstrable.
     */
    if (!this.contractProven()) {
      throw new ConflictException(
        "ЭСИС-ийн бүлгийн сервисүүдийн талбарууд хараахан батлагдаагүй тул " +
          "илгээх боломжгүй. Эхлээд амьд шалгалт хийнэ үү.",
      );
    }

    const approved = await this.repo.approve(row.id, actor.userId);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisWriteRequest",
      objectId: row.id,
      metadata: {
        service: row.service,
        apiId: row.apiId,
        before: { state: row.state },
        state: "APPROVED",
      },
    });

    /*
     * ★ After the write above, never in a transaction with it (CLAUDE.md §3.5).
     * A worker that started while the row was still invisible would find
     * nothing and drop the job; a crash between the two leaves an `APPROVED`
     * row the queue screen shows as waiting, which a director can approve
     * again. A lost job is recoverable. A double post is not.
     */
    await this.queue.add(row.id);

    return approved;
  }

  /**
   * Whether the three services' contract has been proved against live ESIS.
   *
   * ★ A method rather than the constant read inline, so a test can override it
   * the same way this suite already overrides `EsisWriteQueue.add` and
   * `EsisService.sendGroupCreate`. That keeps both halves demonstrable: the
   * gate refuses by default, and the approval mechanics behind it still have
   * tests. A guard nobody can get past is a guard nobody has seen work.
   */
  contractProven(): boolean {
    return ESIS_GROUP_WRITE_CONTRACT_PROVEN;
  }

  async cancel(actor: Actor, kindergartenId: string, writeRequestId: string) {
    this.tenants.assertAdmin(actor, kindergartenId);

    const row = await this.repo.findOne(kindergartenId, writeRequestId);
    if (!row) throw new NotFoundException();
    if (row.state !== "PREPARED") {
      throw new ConflictException("Энэ илгээлт аль хэдийн шийдэгдсэн байна.");
    }

    const cancelled = await this.repo.cancel(row.id);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "EsisWriteRequest",
      objectId: row.id,
      metadata: {
        service: row.service,
        apiId: row.apiId,
        before: { state: row.state },
        state: "CANCELLED",
      },
    });

    return cancelled;
  }

  async list(actor: Actor, kindergartenId: string, page: { page: number; pageSize: number }) {
    this.tenants.assertAdmin(actor, kindergartenId);
    // The house envelope, so the shared `paginated()` contract validates it.
    const { items, total } = await this.repo.list(kindergartenId, toSkipTake(page));
    return paginate(items, total, page);
  }
}

/**
 * The idempotency key.
 *
 * ★ A hash of the payload, not a timestamp or a uuid. Preparing the same write
 * twice must collide; preparing a *different* write about the same group must
 * not. Renaming a group and sending it again is a new key, which is right —
 * that is a second write, and the ministry should receive it.
 */
function writeKey(service: string, groupId: string, payload: Record<string, unknown>) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  return `${service}:${groupId}:${digest}`;
}
