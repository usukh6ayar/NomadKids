import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { HealthRecordsRepository } from "./health-records.repository";
import type {
  CreateAllergyDto,
  CreateMedicationDto,
  CreateVaccinationDto,
  UpdateAllergyDto,
} from "./health-records.dto";

@Injectable()
export class HealthRecordsService {
  constructor(
    private readonly repo: HealthRecordsRepository,
    private readonly childAccess: ChildAccessService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The whole health picture — allergies, medication, vaccinations and the
   * free-text note.
   *
   * Read by anyone who may see the child: a teacher needs it before every meal,
   * and a family needs to see what the kindergarten has recorded about them.
   */
  async get(actor: Actor, childId: string) {
    await this.childAccess.assertCanAccess(actor, childId);

    const { child, allergies, medications, vaccinations } = await this.repo.loadForChild(childId);
    if (!child) throw new NotFoundException();

    const today = todayIso();

    return {
      healthNotes: child.healthNotes,
      allergies: allergies.map((a) => ({
        ...a,
        notedOn: dateOnly(a.notedOn),
        endedOn: a.endedOn ? dateOnly(a.endedOn) : null,
      })),
      medications: medications.map((m) => ({
        ...m,
        startsOn: dateOnly(m.startsOn),
        endsOn: dateOnly(m.endsOn),
        timesOfDay: Array.isArray(m.timesOfDay) ? (m.timesOfDay as string[]) : [],
        /*
         * ★ Computed here, not in each client.
         *
         * "Is this authorisation live today" decides whether a teacher is
         * reminded to give a child medicine. Two screens deriving it from two
         * date comparisons is two chances to get the boundary wrong, and the
         * failure mode is a dose missed or given after consent expired.
         */
        isActive: dateOnly(m.startsOn) <= today && today <= dateOnly(m.endsOn),
      })),
      vaccinations: vaccinations.map((v) => ({
        ...v,
        administeredOn: dateOnly(v.administeredOn),
      })),
    };
  }

  // ── Allergies ──────────────────────────────────────────────────────────────

  /**
   * ★ Staff only, unlike growth or milestones.
   *
   * An allergy record drives an alert that other people act on: it changes what
   * a kitchen cooks and what a teacher does in an emergency. RFP Module 2 puts
   * it on "багшийн систем дээр", and a family telling the kindergarten about a
   * nut allergy is a conversation that ends with a member of staff recording
   * it — which is also who can be asked what "ноцтой" meant. Families read it
   * and see it is right; they do not write the flag themselves.
   */
  async createAllergy(actor: Actor, childId: string, dto: CreateAllergyDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    const saved = await this.repo.createAllergy({
      childId,
      kindergartenId: facts.childKindergartenId,
      kind: dto.kind,
      severity: dto.severity,
      allergen: dto.allergen,
      reaction: dto.reaction ?? null,
      treatment: dto.treatment ?? null,
      notedOn: toDate(dto.notedOn),
      recordedById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "AllergyRecord",
      objectId: saved.id,
      childId,
      metadata: { allergen: dto.allergen, severity: dto.severity },
    });

    return saved;
  }

  async updateAllergy(actor: Actor, id: string, dto: UpdateAllergyDto) {
    const allergy = await this.repo.findAllergy(id);
    if (!allergy) throw new NotFoundException();
    await this.childAccess.assertCanRecord(actor, allergy.childId);

    const data: Record<string, unknown> = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.severity !== undefined) data.severity = dto.severity;
    if (dto.allergen !== undefined) data.allergen = dto.allergen;
    if (dto.reaction !== undefined) data.reaction = dto.reaction;
    if (dto.treatment !== undefined) data.treatment = dto.treatment;
    if (dto.notedOn !== undefined) data.notedOn = toDate(dto.notedOn);
    // `null` reopens a record the child turned out not to have outgrown.
    if (dto.endedOn !== undefined) data.endedOn = dto.endedOn ? toDate(dto.endedOn) : null;

    const saved = await this.repo.updateAllergy(id, data);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: allergy.kindergartenId,
      actorUserId: actor.userId,
      objectType: "AllergyRecord",
      objectId: id,
      childId: allergy.childId,
      metadata: { fields: Object.keys(data) },
    });

    return saved;
  }

  async removeAllergy(actor: Actor, id: string) {
    const allergy = await this.repo.findAllergy(id);
    if (!allergy) throw new NotFoundException();
    await this.childAccess.assertCanRecord(actor, allergy.childId);

    await this.repo.softDeleteAllergy(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: allergy.kindergartenId,
      actorUserId: actor.userId,
      objectType: "AllergyRecord",
      objectId: id,
      childId: allergy.childId,
    });

    return { id };
  }

  // ── Medication ─────────────────────────────────────────────────────────────

  /**
   * ★ A guardian authorises; staff may record one on their behalf.
   *
   * This is the one health record a family writes, and RFP Module 2 is explicit
   * about why: "Эцэг эхчүүд өглөө хүүхдээ өгөхдөө уулгах ёстой эмийг тусгай
   * маягтаар … баталгаажуулан үлдээх". The row *is* the consent, which is why
   * `authorisedById` is the actor and never a client-supplied id.
   *
   * Staff may also create one — a family who phones in the instruction is
   * ordinary — and the audit row records who actually typed it.
   */
  async createMedication(actor: Actor, childId: string, dto: CreateMedicationDto) {
    const facts = await this.childAccess.assertCanContributeMedia(actor, childId);

    // A window that closed before it opened is a typo; one that ended weeks ago
    // is a record nobody will act on. Both are caught at the boundary rather
    // than silently stored as an inactive authorisation.
    if (dto.endsOn < todayIso()) {
      throw new BadRequestException("Дуусах огноо өнгөрсөн байна");
    }

    const saved = await this.repo.createMedication({
      childId,
      kindergartenId: facts.childKindergartenId,
      medicineName: dto.medicineName,
      dosage: dto.dosage,
      timesOfDay: dto.timesOfDay,
      instructions: dto.instructions ?? null,
      startsOn: toDate(dto.startsOn),
      endsOn: toDate(dto.endsOn),
      authorisedById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "MedicationAuthorisation",
      objectId: saved.id,
      childId,
      metadata: {
        medicineName: dto.medicineName,
        byGuardian: isGuardianOf(actor, facts),
      },
    });

    return saved;
  }

  /**
   * Withdrawing an authorisation — the guardian who gave it, or staff.
   *
   * A family stopping medication must not have to ask permission, and a teacher
   * clearing an expired instruction is ordinary. What nobody may do is withdraw
   * *another* guardian's consent, for the same reason they may not rewrite
   * their milestone.
   */
  async removeMedication(actor: Actor, id: string) {
    const medication = await this.repo.findMedication(id);
    if (!medication) throw new NotFoundException();

    const facts = await this.childAccess.assertCanContributeMedia(actor, medication.childId);
    if (isGuardianOf(actor, facts) && medication.authorisedById !== actor.userId) {
      throw new NotFoundException();
    }

    await this.repo.softDeleteMedication(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: medication.kindergartenId,
      actorUserId: actor.userId,
      objectType: "MedicationAuthorisation",
      objectId: id,
      childId: medication.childId,
    });

    return { id };
  }

  // ── Vaccination ────────────────────────────────────────────────────────────

  /** Staff record these: it is the kindergarten's immunisation register. */
  async createVaccination(actor: Actor, childId: string, dto: CreateVaccinationDto) {
    const facts = await this.childAccess.assertCanRecord(actor, childId);

    if (dto.administeredOn > todayIso()) {
      throw new BadRequestException("Огноо ирээдүйд байж болохгүй");
    }

    const saved = await this.repo.createVaccination({
      childId,
      kindergartenId: facts.childKindergartenId,
      vaccineName: dto.vaccineName,
      administeredOn: toDate(dto.administeredOn),
      doseLabel: dto.doseLabel ?? null,
      provider: dto.provider ?? null,
      note: dto.note ?? null,
      recordedById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId: facts.childKindergartenId,
      actorUserId: actor.userId,
      objectType: "VaccinationRecord",
      objectId: saved.id,
      childId,
      metadata: { vaccineName: dto.vaccineName },
    });

    return saved;
  }

  async removeVaccination(actor: Actor, id: string) {
    const vaccination = await this.repo.findVaccination(id);
    if (!vaccination) throw new NotFoundException();
    await this.childAccess.assertCanRecord(actor, vaccination.childId);

    await this.repo.softDeleteVaccination(id);
    await this.audit.append({
      action: "DELETE",
      kindergartenId: vaccination.kindergartenId,
      actorUserId: actor.userId,
      objectType: "VaccinationRecord",
      objectId: id,
      childId: vaccination.childId,
    });

    return { id };
  }
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** `@db.Date` is UTC midnight, so slicing the ISO string is the recorded date. */
function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
