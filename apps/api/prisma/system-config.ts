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

export const SYSTEM_OBSERVATION_TYPES = [
  { code: "daily", name: "Өдөр тутмын ажиглалт", order: 1 },
  { code: "activity", name: "Үйл ажиллагааны ажиглалт", order: 2 },
  { code: "milestone", name: "Онцлох ахиц", order: 3 },
  { code: "concern", name: "Анхаарал шаардсан", order: 4 },
  { code: "parent", name: "Гэр бүлээс ирсэн", order: 5 },
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
        data: { name: t.name, order: t.order },
      });
    } else {
      await db.observationType.create({ data: { ...t, kindergartenId: null } });
    }
  }
}

interface SystemTable {
  findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
}
