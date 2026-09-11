/**
 * The system configuration every kindergarten inherits.
 *
 * Defined once and used by both `seed.ts` and the test helpers, so a test can
 * never pass against a different set of domains than production runs with.
 *
 * These are rows with `kindergartenId = NULL`. A kindergarten admin may create
 * their own overrides but may not edit these — docs/DATABASE.md §7.
 */

import { CURRICULUM } from "./curriculum";

/**
 * The seven development strands of the Mongolian preschool curriculum.
 *
 * ★ Seven since 2026-09-11, and five of them are renamed rather than replaced.
 *
 * The client's own СҮД spreadsheet names the strands, and `group-coverage.tsx`
 * had been aliasing them onto these five for months — which is the tell that
 * the five were the wrong list wearing different words. The codes are
 * unchanged, so every `Assessment` and `ObservationDomain` row already filed
 * keeps pointing at the strand it was filed under; only the label a teacher
 * reads has moved onto the curriculum's own wording.
 *
 * `environment` and `music` are genuinely new: the five had nowhere to put
 * "Байгаль, нийгмийн орчин" or "Хөгжим", which is why the alias table could
 * only ever cover five of the seven.
 */
export const SYSTEM_DOMAINS = [
  { code: "social", name: "Нийгэм-сэтгэл хөдлөл", color: "#ec4899", order: 1 },
  { code: "physical", name: "Хөдөлгөөн, эрүүл мэнд", color: "#f97316", order: 2 },
  { code: "language", name: "Хэл яриа", color: "#3b82f6", order: 3 },
  { code: "environment", name: "Байгаль, нийгмийн орчин", color: "#14b8a6", order: 4 },
  { code: "cognitive", name: "Математик", color: "#8b5cf6", order: 5 },
  { code: "creative", name: "Зураг, урлал", color: "#10b981", order: 6 },
  { code: "music", name: "Хөгжим", color: "#f43f5e", order: 7 },
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
 * The special-needs categories — Order А/261, kindergarten criterion 11.
 *
 * ★ The eight of the Law on the Rights of Persons with Disabilities, in the
 * order the state's own return lists them, plus "бусад".
 *
 * `other` is last and exists on purpose: a closed list with no escape makes
 * staff record a child under the nearest wrong category, which is worse for
 * the aggregate than an honest "бусад" the ministry can ask about. It is not
 * a licence to skip classifying — the note field beside it is where the real
 * answer goes.
 */
export const SYSTEM_SPECIAL_NEEDS_CATEGORIES = [
  { code: "vision", name: "Хараа", order: 1 },
  { code: "hearing", name: "Сонсгол", order: 2 },
  { code: "speech", name: "Хэл яриа", order: 3 },
  { code: "mobility", name: "Хөдөлгөөн, тулгуур эрхтэн", order: 4 },
  { code: "intellectual", name: "Оюун ухаан", order: 5 },
  { code: "psychosocial", name: "Сэтгэц, зан үйл", order: 6 },
  { code: "autism", name: "Аутизмын хүрээний эмгэг", order: 7 },
  { code: "multiple", name: "Олон талт бэрхшээл", order: 8 },
  { code: "other", name: "Бусад", order: 9 },
] as const;

/**
 * Creates or updates the system rows. Idempotent — the partial unique indexes
 * on `(code) WHERE "kindergartenId" IS NULL` turn a duplicate into a database
 * error rather than a silent second row.
 *
 * ★ **Two queries per table, not two per row.**
 *
 * It used to be a `findFirst` plus a `create` for each of the fourteen system
 * rows, which was tolerable until the special-needs categories made it
 * twenty-three — forty-six round trips. That matters because `resetData()`
 * calls this **before every integration test**: `TRUNCATE ... CASCADE` empties
 * these tables too (they have no kindergarten to cascade from), so the config
 * is restored between every case in a suite of eighteen hundred. The three
 * `beforeEach` hook timeouts on 2026-09-05 were traced to contention rather
 * than to this, but a 10-second hook budget should not be spent on round trips
 * that one `createMany` covers.
 *
 * Typed loosely because it is shared between the seed script and the test
 * helpers, which construct their Prisma clients separately.
 */
export async function applySystemConfig(db: {
  developmentDomain: SystemTable;
  assessmentLevel: SystemTable;
  observationType: SystemTable;
  specialNeedsCategory: SystemTable;
  curriculumIndicator: Parameters<typeof syncCurriculum>[0]["curriculumIndicator"];
  curriculumIndicatorLevel: Parameters<typeof syncCurriculum>[0]["curriculumIndicatorLevel"];
}): Promise<void> {
  await syncSystemRows(db.developmentDomain, SYSTEM_DOMAINS, "code", (d) => ({
    code: d.code,
    name: d.name,
    color: d.color,
    order: d.order,
  }));

  await syncSystemRows(db.assessmentLevel, SYSTEM_LEVELS, "value", (l) => ({
    value: l.value,
    label: l.label,
    color: l.color,
    description: l.description,
    order: l.value,
  }));

  await syncSystemRows(db.observationType, SYSTEM_OBSERVATION_TYPES, "code", (t) => ({
    code: t.code,
    name: t.name,
    order: t.order,
  }));

  await syncSystemRows(db.specialNeedsCategory, SYSTEM_SPECIAL_NEEDS_CATEGORIES, "code", (c) => ({
    code: c.code,
    name: c.name,
    order: c.order,
  }));

  /*
   * ★ System observation types this list no longer names are retired —
   * 2026-09-06, when the client named their own three (Ажиглалт · Ярилцлага ·
   * Бүтээл).
   *
   * Without this, changing the list only ever *adds*: the three kinds dropped
   * (`activity`, `milestone`, `concern`) would have stayed in every picker,
   * and the screen the change was made to simplify would have gone from five
   * confusing options to seven.
   *
   * Soft-deleted, never deleted — CLAUDE.md §3.2, and here the rule has teeth
   * beyond the principle: `Observation.typeId` is a foreign key, so a hard
   * delete either fails or takes years of notes with it. A retired row keeps
   * every existing observation readable under the name it was filed with.
   *
   * Scoped to `kindergartenId: null`. A type a kindergarten added for itself
   * is that administrator's to retire, on `/admin/assessment-config`.
   *
   * ★★ Only this table gets a sweep. Retiring a development domain or an
   * assessment level would change what a *finished* term's report means, and
   * retiring a special-needs category would break a figure the state counts —
   * none of those are edits a list change should make silently.
   */
  const systemCodes = SYSTEM_OBSERVATION_TYPES.map((t) => t.code);
  await db.observationType.updateMany({
    where: { kindergartenId: null, deletedAt: null, code: { notIn: [...systemCodes] } },
    data: { deletedAt: new Date() },
  });

  await syncCurriculum(db);
}

/**
 * The СҮД indicators — seventy-one of them, at up to four levels each.
 *
 * ★ Idempotent by code, like every other system list here.
 *
 * The partial unique index on `(code) WHERE "kindergartenId" IS NULL` is what
 * makes that safe rather than hopeful: a second seed of the same indicator is
 * a database error, not a duplicate row nobody notices.
 *
 * ★★ Levels are replaced, not merged. An indicator whose level III wording was
 * corrected in the source must not keep both versions, and the four rows are
 * small enough that deleting and rewriting them is simpler than diffing.
 *
 * ★★★ Nothing is retired here. Unlike an observation type, an indicator is
 * referenced by `Observation.indicatorId` — a note filed as evidence for
 * НСХ1а stays evidence for НСХ1а even if the ministry renumbers, and the
 * sweep that would tidy the list would quietly orphan years of them.
 */
async function syncCurriculum(db: {
  developmentDomain: SystemTable;
  curriculumIndicator: {
    count: (args: unknown) => Promise<number>;
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
    update: (args: unknown) => Promise<{ id: string }>;
  };
  curriculumIndicatorLevel: {
    deleteMany: (args: unknown) => Promise<unknown>;
    createMany: (args: unknown) => Promise<unknown>;
  };
}): Promise<void> {
  /*
    ★ One count before ~284 round trips.

    `resetData` runs before every test case, and re-seeding seventy-one
    indicators and their two hundred and sixty-five level rows each time would
    put a `findFirst`, an `update` and two writes per indicator into the
    critical path of every one of two thousand cases. The curriculum is a
    national standard: if the right number of system rows is already there,
    there is nothing to do.

    A count rather than a checksum, deliberately — a wrong *text* is a seed
    change, which arrives with a fresh database anyway. What this guards
    against is a wrong *number*, which is the only way the table goes stale
    within a run.
  */
  const expected = CURRICULUM.reduce((sum, strand) => sum + strand.indicators.length, 0);
  const present = await db.curriculumIndicator.count({ where: { kindergartenId: null } });
  if (present === expected) return;

  for (const strand of CURRICULUM) {
    const domain = (await db.developmentDomain.findFirst({
      where: { kindergartenId: null, code: strand.domainCode },
    })) as { id: string } | null;

    // A strand whose domain is missing is a seed run against a database that
    // predates it — skipped rather than throwing, so the rest still lands.
    if (!domain) continue;

    for (const [index, indicator] of strand.indicators.entries()) {
      const existing = await db.curriculumIndicator.findFirst({
        where: { kindergartenId: null, code: indicator.code },
      });

      const row = existing
        ? await db.curriculumIndicator.update({
            where: { id: existing.id },
            data: { domainId: domain.id, order: index, isActive: true, deletedAt: null },
          })
        : await db.curriculumIndicator.create({
            data: { code: indicator.code, domainId: domain.id, order: index },
          });

      await db.curriculumIndicatorLevel.deleteMany({ where: { indicatorId: row.id } });
      await db.curriculumIndicatorLevel.createMany({
        data: Object.entries(indicator.levels).map(([level, text]) => ({
          indicatorId: row.id,
          level: Number(level),
          text,
        })),
      });
    }
  }
}

/**
 * Reads what is there, inserts what is missing in one statement, and updates
 * only the rows whose values actually changed.
 *
 * ★ The update is skipped when nothing differs, which is the common case and
 * the one that runs eighteen hundred times. `resetData()` has just truncated,
 * so every row is missing and this is exactly one `findMany` and one
 * `createMany`; the seed on a live database usually finds everything present
 * and unchanged and issues neither.
 */
async function syncSystemRows<T>(
  table: SystemTable,
  rows: readonly T[],
  keyField: string,
  dataOf: (row: T) => Record<string, unknown>,
): Promise<void> {
  const existing = await table.findMany({ where: { kindergartenId: null } });
  const byKey = new Map(existing.map((row) => [String(row[keyField]), row]));

  const missing: Record<string, unknown>[] = [];

  for (const row of rows) {
    /*
     * ★ `deletedAt: null` on every write — a code can come **back**.
     *
     * The sweep in `applySystemConfig` retires a system row this list no
     * longer names. If the client later asks for it again, adding the code
     * back has to make it usable rather than leave it silently soft-deleted
     * and invisible in every picker.
     */
    const data = { ...dataOf(row), deletedAt: null };
    const found = byKey.get(String(data[keyField]));

    if (!found) {
      missing.push({ ...data, kindergartenId: null });
      continue;
    }
    // Only when a value actually moved — a no-op UPDATE is still a round trip
    // and still takes a row lock.
    const changed = Object.entries(data).some(([key, value]) => found[key] !== value);
    if (changed) await table.update({ where: { id: String(found.id) }, data });
  }

  if (missing.length > 0) await table.createMany({ data: missing });
}

interface SystemTable {
  findMany(args: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<unknown>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<unknown>;
}
