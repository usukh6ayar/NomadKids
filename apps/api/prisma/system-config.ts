/**
 * The system configuration every kindergarten inherits.
 *
 * Defined once and used by both `seed.ts` and the test helpers, so a test can
 * never pass against a different set of domains than production runs with.
 *
 * These are rows with `kindergartenId = NULL`. A kindergarten admin may create
 * their own overrides but may not edit these — docs/DATABASE.md §7.
 */

/** The five development domains of the Mongolian preschool curriculum. */
export const SYSTEM_DOMAINS = [
  { code: "physical", name: "Бие бялдрын хөгжил", color: "#f97316", order: 1 },
  { code: "social", name: "Нийгэмшихүй, сэтгэл хөдлөл", color: "#ec4899", order: 2 },
  { code: "language", name: "Хэл яриа, харилцаа", color: "#3b82f6", order: 3 },
  { code: "cognitive", name: "Танин мэдэхүй", color: "#8b5cf6", order: 4 },
  { code: "creative", name: "Урлаг, гоо зүйн хүмүүжил", color: "#10b981", order: 5 },
] as const;

/** Four assessment levels, values 1–4. RFP §6.2. */
export const SYSTEM_LEVELS = [
  {
    value: 1,
    label: "Дэмжлэгтэй",
    color: "#ef4444",
    description: "Багшийн тогтмол дэмжлэгтэйгээр гүйцэтгэнэ",
  },
  {
    value: 2,
    label: "Хөгжиж буй",
    color: "#f59e0b",
    description: "Хэсэгчлэн бие даан гүйцэтгэж байна",
  },
  {
    value: 3,
    label: "Хүрсэн",
    color: "#10b981",
    description: "Насны онцлогт тохирсон түвшинд хүрсэн",
  },
  {
    value: 4,
    label: "Давсан",
    color: "#3b82f6",
    description: "Насны онцлогоос давсан чадвар үзүүлж байна",
  },
] as const;

/**
 * The kinds of note a teacher files — "Явцын үнэлгээ".
 *
 * ★ Rewritten 2026-09-06 to the client's three, plus the family's own.
 *
 * It was five names invented here: Өдөр тутмын ажиглалт, Үйл ажиллагааны
 * ажиглалт, Онцлох ахиц, Анхаарал шаардсан, Гэр бүлээс ирсэн. The client's
 * report was that the teacher's screen is unreadable — "одоо байгаа юмнууд
 * ойлгомжгүй байна" — and they named the three the product should offer, by
 * pointing at the screen that already offers them: the parent's Хөгжил page
 * (`parent-growth-launcher.tsx`), whose three doors are Ажиглалт, Ярилцлага
 * and Бүтээл.
 *
 * Those three were **presentational there and stored nowhere.** That file says
 * so in its own docblock: all three post the same `CreateParentObservationDto`,
 * and "a later pass can give Ярилцлага/Бүтээл their own stored distinction if
 * the client asks for one". They have asked. This is that row in the table.
 *
 * ★★ `daily` keeps its code and gains the name "Ажиглалт".
 *
 * The code is what every existing `Observation` points at and what six API
 * tests look the type up by; renaming a row is a rename, where a new code
 * beside a retired one would strand every note ever filed. The other two are
 * new codes because they are new kinds.
 *
 * ★★★ `parent` stays, and is not one of the three.
 *
 * `ObservationsService.parentObservationType` resolves it by code and falls
 * back to `types[0]`, so dropping it would silently file every family's note
 * as an "Ажиглалт" by a teacher. It is deliberately absent from the teacher's
 * own picker — see `NewRecordStrip` — because a note from a family arrives
 * through the family's screen, not by a teacher choosing that label.
 *
 * ★★★★ The three retired codes are swept below rather than left behind.
 * `Observation.typeId` is a foreign key, so the rows cannot be deleted without
 * taking history with them; they are soft-deleted, which keeps every existing
 * note readable under the name it was filed with and stops any new one being
 * filed under a kind the product no longer offers.
 */
export const SYSTEM_OBSERVATION_TYPES = [
  { code: "daily", name: "Ажиглалт", order: 1 },
  { code: "conversation", name: "Ярилцлага", order: 2 },
  { code: "artwork", name: "Бүтээл", order: 3 },
  { code: "parent", name: "Гэр бүлээс ирсэн", order: 4 },
] as const;

/**
 * Creates or updates the system rows. Idempotent — the partial unique indexes
 * on `(code) WHERE "kindergartenId" IS NULL` turn a duplicate into a database
 * error rather than a silent second row.
 *
 * Typed loosely because it is shared between the seed script and the test
 * helpers, which construct their Prisma clients separately.
 */
export async function applySystemConfig(db: {
  developmentDomain: SystemTable;
  assessmentLevel: SystemTable;
  observationType: SystemTable;
}): Promise<void> {
  for (const d of SYSTEM_DOMAINS) {
    const existing = await db.developmentDomain.findFirst({
      where: { kindergartenId: null, code: d.code },
    });
    if (existing) {
      await db.developmentDomain.update({
        where: { id: existing.id },
        data: { name: d.name, color: d.color, order: d.order },
      });
    } else {
      await db.developmentDomain.create({ data: { ...d, kindergartenId: null } });
    }
  }

  for (const l of SYSTEM_LEVELS) {
    const existing = await db.assessmentLevel.findFirst({
      where: { kindergartenId: null, value: l.value },
    });
    if (existing) {
      await db.assessmentLevel.update({
        where: { id: existing.id },
        data: { label: l.label, color: l.color, description: l.description, order: l.value },
      });
    } else {
      await db.assessmentLevel.create({ data: { ...l, order: l.value, kindergartenId: null } });
    }
  }

  for (const t of SYSTEM_OBSERVATION_TYPES) {
    const existing = await db.observationType.findFirst({
      where: { kindergartenId: null, code: t.code },
    });
    if (existing) {
      await db.observationType.update({
        where: { id: existing.id },
        // `deletedAt: null` because a code can come *back*: a type retired by
        // the sweep below and later restored to the list must be usable again
        // rather than silently staying soft-deleted.
        data: { name: t.name, order: t.order, deletedAt: null },
      });
    } else {
      await db.observationType.create({ data: { ...t, kindergartenId: null } });
    }
  }

  /*
   * ★ System types this list no longer names are retired — 2026-09-06.
   *
   * Without this, changing the list only ever *adds*: the three kinds dropped
   * when the client named theirs (`activity`, `milestone`, `concern`) would
   * have stayed in every picker in the product, and the screen the change was
   * made to simplify would have gone from five confusing options to seven.
   *
   * Soft-deleted, never deleted — CLAUDE.md §3.2, and here the rule has teeth
   * beyond the principle: `Observation.typeId` is a foreign key, so a hard
   * delete either fails or takes years of notes with it. A retired row keeps
   * every existing observation readable under the name it was filed with.
   *
   * Scoped to `kindergartenId: null`. A type a kindergarten added for itself is
   * that administrator's to retire, on `/admin/assessment-config`.
   */
  const systemCodes = SYSTEM_OBSERVATION_TYPES.map((t) => t.code);
  await db.observationType.updateMany({
    where: { kindergartenId: null, deletedAt: null, code: { notIn: [...systemCodes] } },
    data: { deletedAt: new Date() },
  });
}

interface SystemTable {
  findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
}
