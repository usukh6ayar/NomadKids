/**
 * Seeds a kindergarten from the **live ESIS roster**, for local development.
 *
 * ★ This is the file `seed-demo.ts` deliberately is not.
 *
 * `seed-demo.ts` invents a kindergarten so every screen has rows to render.
 * This one asks ESIS for a real institution's organisation record, groups and
 * student roster and writes those. Nothing here is fabricated: if ESIS returns
 * eighty-three children, eighty-three children land, with the names, birth
 * dates and group placements the ministry holds.
 *
 * ★★ It refuses to run anywhere but a local database — `assertLocalOnly`, the
 * same guard `seed-demo.ts` carries and for a sharper reason. That script's
 * risk is a known password in a deployment; this one's is a real roster of
 * named children written into a database nobody meant to fill.
 *
 * ★★★ **The roster is fetched at run time and never committed.** There is no
 * fixture beside this file and there must not be: a JSON dump of
 * `students/list` is eighty-three children's names, civil-registry numbers and
 * provider passwords, and `git` does not forget. `esis.fixtures.ts` holds the
 * invented demo responses; that is the only roster shape this repository
 * stores.
 *
 * ★★★★ **What is dropped is dropped mechanically — two filters since
 * 2026-09-15, not one.** Every record is still projected through
 * `ESIS_FIELDS`' own `ingested` flag before any code reads a property, which
 * removes `googlePassword` and `microsoftPassword` as it always did. It no
 * longer removes `civilId` and `personRegNumber` on its own — the client
 * asked for register numbers that day, and the catalogue now says so, because
 * an ADMIN's operator screen reads its columns off that same flag. `readEsis`
 * filters a second time with `esisVisibleRows(rows, { identifiers: false })`,
 * so those two are still gone before the mapping below can see them — a
 * development database has no more business holding a register number than
 * a password. A hand-written "don't copy these four" is a comment somebody
 * edits; this is two field catalogues, `ESIS_FIELDS` and
 * `ESIS_IDENTIFIER_FIELDS`, used as filters. See `ESIS_REQUEST.md` §1.1 (b)
 * and §1.2 for the document this project has since partly overridden, and
 * `esis.schemas.ts` for the 2026-09-15 decision.
 *
 * Not idempotent, and not trying to be: `children` carries no ESIS external id
 * — `нэмэлт.md` §15, the external-ID history, is not built — so there is no key
 * to dedupe a second run against, and inventing one from a refused field is
 * exactly what this script must not do. Run it against a database that was
 * just reset:
 *
 *   pnpm --filter @kinder/api db:reset
 *   ESIS_INSTITUTION_ID=42778 pnpm --filter @kinder/api seed:esis
 */

import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { ESIS_ENDPOINTS } from "../src/integrations/esis/esis.endpoints";
import { ESIS_FIELDS } from "../src/integrations/esis/esis.fields";
import { esisVisibleRows } from "../src/integrations/esis/esis.schemas";

// ★ Loads the repository-root `.env` — see `seed-demo.ts` for the full reason.
// A seed script is its own process and never imports the application, so
// nothing else has read the file. `override` is off, so an exported variable
// always wins.
loadDotenv({ path: resolve(__dirname, "..", "..", "..", ".env"), quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * The admin account this script creates so somebody can log in and look.
 *
 * `seed.ts` seeds a superadmin with no membership anywhere, which is correct
 * for a deployment and useless for opening `/children`: every tenant screen
 * reads `Membership`, and the superadmin has none. So this script adds one
 * ADMIN, and the local-only guard above is what makes a default password
 * acceptable — the same argument `seed-demo.ts` makes.
 */
const PASSWORD = process.env.SEED_ESIS_PASSWORD ?? "esis-password-123";

/**
 * ESIS's four СӨБ levels, in this product's vocabulary.
 *
 * ★ The mapping is by `academicLevel`, the numeric code, not by the group's
 * name. A kindergarten types its own group names — this institution's are
 * "бага бүлэг", "дунд бүлэг" — and matching on them would break at the first
 * school that calls its middle group "Наран". The codes are the ministry's and
 * do not move.
 *
 * ★★ The labels line up exactly, which is worth stating because the words look
 * off by one: `AGE_BANDS` in `admin/groups/page.tsx` renders NURSERY as "Бага
 * бүлэг" and SENIOR as "Бэлтгэл бүлэг", so ESIS's Бага→NURSERY and
 * Бэлтгэл→SENIOR are the same four rungs under two spellings, not a shift.
 */
const AGE_BAND_BY_LEVEL: Record<string, "NURSERY" | "JUNIOR" | "MIDDLE" | "SENIOR"> = {
  "15": "NURSERY", // Бага
  "16": "JUNIOR", // Дунд
  "17": "MIDDLE", // Ахлах
  "18": "SENIOR", // Бэлтгэл
};

function assertLocalOnly(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-esis refuses to run with NODE_ENV=production");
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
    throw new Error(
      `seed-esis refuses to run against a non-local database (host: ${host}).\n` +
        "It writes a real institution's roster and creates an account with a known\n" +
        "password. That is safe on a laptop and nowhere else.",
    );
  }
}

/** Only the fields `ESIS_FIELDS` marks `ingested`, keyed by endpoint. */
function ingestedNames(key: keyof typeof ESIS_ENDPOINTS): Set<string> {
  return new Set(ESIS_FIELDS[key].filter((field) => field.ingested).map((field) => field.name));
}

/**
 * One ESIS read, projected through the field catalogue before it is returned.
 *
 * ★ The projection happens here rather than at the call sites so there is no
 * path from `fetch` to a mapping function that carries a refused value. A
 * caller cannot forget to filter because a caller never sees the raw row.
 *
 * ★★ **Two filters, not one — 2026-09-15.** `ingestedNames` used to be
 * enough on its own, because `civilId` and `personRegNumber` were `drop()`-ed
 * in `esis.fields.ts` and so never survived it. They are `keep()`-ed there
 * now — the client asked for register numbers on 2026-09-15, and the
 * catalogue's `ingested` flag has to say so, because an ADMIN's operator
 * screen reads columns off that same flag. A local development database is
 * not an ADMIN screen, so this script filters again, after `ingestedNames`,
 * with `esisVisibleRows(rows, { identifiers: false })` — the same
 * list-driven, executable refusal `esis-admin.service.ts` uses, keyed on
 * `ESIS_IDENTIFIER_FIELDS` rather than on a catalogue flag that now
 * legitimately varies by who is asking. Credentials pass through
 * `esisVisibleRows` unaffected — they were never `keep()`-ed anywhere and
 * `ingestedNames` already removes them — so this is additive, not a
 * relaxation of the first filter.
 */
async function readEsis(
  key: keyof typeof ESIS_ENDPOINTS,
  institutionId: string,
): Promise<Record<string, unknown>[]> {
  const endpoint = ESIS_ENDPOINTS[key];
  const base = (process.env.ESIS_BASE_URL || "https://hubv2.esis.edu.mn").replace(/\/+$/, "");
  const token = (process.env.ESIS_TOKEN ?? "").trim().replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("ESIS_TOKEN is not set — this script only runs in live mode");

  const url = `${base}${endpoint.path}?institutionId=${encodeURIComponent(institutionId)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(Number(process.env.ESIS_TIMEOUT_MS ?? 15000)),
  });

  // ★ The path and status, never the body and never the headers. A failing ESIS
  // response can quote the request back, and the request carries the token.
  if (!response.ok) {
    throw new Error(`ESIS ${endpoint.path} answered ${response.status}`);
  }

  const payload = (await response.json()) as { RESULT?: unknown };
  const rows = Array.isArray(payload.RESULT) ? payload.RESULT : [];
  const allowed = ingestedNames(key);

  const ingested = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row as Record<string, unknown>).filter(([name]) => allowed.has(name)),
    ),
  );
  return esisVisibleRows(ingested, { identifiers: false });
}

/**
 * `"2024-07-04T00:00:00.000Z"` → `2024-07-04`, by slicing rather than parsing.
 *
 * ★ Not `new Date(value)`. ESIS sends midnight UTC and this runs at UTC+8, so
 * anything that round-trips through a local-time `Date` moves a July 4th
 * birthday to July 3rd — for every child, silently, in the one field a parent
 * would notice. The string already is the date; take it.
 */
function esisDate(value: unknown): Date {
  if (typeof value !== "string" || value.length < 10) {
    throw new Error(`ESIS sent an unusable date: ${JSON.stringify(value)}`);
  }
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

const str = (value: unknown): string => (typeof value === "string" ? value : String(value ?? ""));

async function main(): Promise<void> {
  assertLocalOnly();

  const institutionId = process.env.ESIS_INSTITUTION_ID?.trim();
  if (!institutionId) {
    throw new Error(
      "ESIS_INSTITUTION_ID is not set.\n" +
        "It names the institution this kindergarten mirrors, and the token is scoped\n" +
        "per institution — there is no default that would be right.",
    );
  }

  console.log(`Reading ESIS institution ${institutionId}…`);
  const [organisation] = await readEsis("organization", institutionId);
  if (!organisation) throw new Error(`ESIS returned no organisation for ${institutionId}`);

  const groupRows = await readEsis("groups", institutionId);
  const studentRows = await readEsis("students", institutionId);
  console.log(`  ${groupRows.length} groups, ${studentRows.length} students`);

  const name = str(organisation.institutionName);
  const existing = await prisma.kindergarten.findFirst({
    where: { esisInstitutionId: institutionId, deletedAt: null },
  });
  if (existing) {
    console.log(
      `Kindergarten ${existing.id} is already mapped to ${institutionId}. Nothing to do.`,
    );
    return;
  }

  /*
   * ★ The mapping columns are set here, in the same create.
   *
   * `esisInstitutionId` is what every live ESIS read resolves against —
   * `EsisAdminService` reads it off the tenant, never off the environment, so
   * one provider token can serve several kindergartens tenant-safely. A
   * kindergarten seeded from ESIS and then left unmapped would show its
   * operator "ESIS тохиргоо хүлээгдэж байна" over a roster that visibly came
   * from ESIS.
   *
   * ★★ `PRODUCTION`, because `hubv2.esis.edu.mn` is the live hub. It is the
   * environment the data came from, not a statement about this database.
   */
  const kindergarten = await prisma.kindergarten.create({
    data: {
      name,
      address: str(organisation.institutionAddress) || null,
      description:
        [
          str(organisation.longName) || name,
          str(organisation.institutionTypeName),
          str(organisation.propertyTypeName),
        ]
          .filter(Boolean)
          .join(" · ") || null,
      esisInstitutionId: institutionId,
      esisEnvironment: "PRODUCTION",
      esisMappedAt: new Date(),
    },
  });
  console.log(`Created ${name} (${kindergarten.id})`);

  /*
   * The school year ESIS says the roster belongs to.
   *
   * `academicYear` is the opening calendar year — "2026" is 2026-2027 — which
   * is the same convention `demo-data.ts` writes, so both seeds produce a name
   * the year picker renders identically.
   */
  const academicYear = Number(str(groupRows[0]?.academicYear) || new Date().getUTCFullYear());
  const startsOn = new Date(Date.UTC(academicYear, 8, 1));
  const endsOn = new Date(Date.UTC(academicYear + 1, 6, 1));
  const year = await prisma.schoolYear.create({
    data: {
      kindergartenId: kindergarten.id,
      name: `${academicYear}-${academicYear + 1}`,
      startsOn,
      endsOn,
      isCurrent: true,
    },
  });

  /*
   * ★ Group names are written exactly as ESIS holds them — lower case and all.
   *
   * "ахлах бүлэг" is what this kindergarten typed into ESIS. Title-casing it
   * here would make the two systems disagree about the name of the same group,
   * and the next person to compare a NomadKids screen against ESIS would be
   * chasing a difference this script invented.
   */
  const groupByEsisId = new Map<string, string>();
  for (const row of groupRows) {
    const level = str(row.academicLevel);
    const ageBand = AGE_BAND_BY_LEVEL[level];
    if (!ageBand) {
      console.warn(`  skipping group ${str(row.studentGroupName)}: unknown level ${level}`);
      continue;
    }

    const group = await prisma.group.create({
      data: {
        kindergartenId: kindergarten.id,
        schoolYearId: year.id,
        name: str(row.studentGroupName),
        ageBand,
      },
    });
    groupByEsisId.set(str(row.studentGroupId), group.id);
  }
  console.log(`Created ${groupByEsisId.size} groups`);

  /*
   * ★ `nationalId` stays null for every child, and that is the point.
   *
   * ESIS returns `civilId` and `personRegNumber` on this service. As of
   * 2026-09-15 neither is `drop()`-ed in `esis.fields.ts` any more — the
   * client asked for register numbers that day, and the product does ingest
   * them elsewhere, gated per caller on an ADMIN's screen. A development
   * database seeded from a live roster is not that screen and has no business
   * holding ninety-four children's register numbers, so `readEsis` removes
   * both explicitly, via `esisVisibleRows(rows, { identifiers: false })`, on
   * top of the catalogue projection. There is still no value here to write
   * even by accident; the reason moved from "the catalogue never let it
   * through" to "this script refuses it itself". Postgres allows repeated
   * NULLs under `children_kindergartenId_nationalId_key`, so eighty-three
   * unidentified children do not collide.
   *
   * ★★ `familyName` — the ургийн овог — is not a column. `lastName` is the
   * овог the product shows, and ESIS sends both; keeping the clan name would
   * mean a schema change this task does not need.
   */
  let children = 0;
  let enrolled = 0;
  const unplaced: string[] = [];

  for (const row of studentRows) {
    const groupId = groupByEsisId.get(str(row.studentGroupId));
    const child = await prisma.child.create({
      data: {
        kindergartenId: kindergarten.id,
        lastName: str(row.lastName),
        firstName: str(row.firstName),
        sex: str(row.genderCode) === "F" ? "FEMALE" : "MALE",
        dateOfBirth: esisDate(row.dateOfBirth),
        status: str(row.programStatus) === "ACTIVE" ? "ACTIVE" : "INACTIVE",
      },
    });
    children += 1;

    if (!groupId) {
      unplaced.push(`${str(row.lastName)} ${str(row.firstName)}`);
      continue;
    }

    /*
     * ★ Authorization reads this row, not `Child.kindergartenId` — CLAUDE.md
     * §1.2. A child seeded without an enrolment falls through to the single
     * documented fallback, which exists for a child somebody just registered
     * and not for eighty-three imported ones.
     *
     * ★★ `startedOn` is ESIS's own `actionDate`, the day the enrolment was
     * recorded there, even where that predates the school year's September 1st
     * — several of this roster's were entered in May. The real date is the
     * useful one; clamping it to the year's start would invent a fact.
     */
    await prisma.enrollment.create({
      data: {
        kindergartenId: kindergarten.id,
        childId: child.id,
        groupId,
        schoolYearId: year.id,
        startedOn: esisDate(row.actionDate),
      },
    });
    enrolled += 1;
  }

  /*
   * One ADMIN, so the seeded kindergarten can actually be opened.
   *
   * ★ No accounts are created for the ten teachers and thirteen staff ESIS
   * lists. They are named real people, and minting them logins with a shared
   * default password is not a thing to do to somebody who has not asked for an
   * account. Their ESIS records are readable through the integration's own
   * screens without a NomadKids user existing.
   */
  const admin = await prisma.user.create({
    data: {
      username: "esis-admin",
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      lastName: "ESIS",
      firstName: "Админ",
      memberships: {
        create: { kindergartenId: kindergarten.id, role: "ADMIN", startedOn: new Date() },
      },
    },
  });

  console.log("");
  console.log(`  kindergarten : ${name} (ESIS ${institutionId})`);
  console.log(`  school year  : ${year.name}`);
  console.log(`  groups       : ${groupByEsisId.size}`);
  console.log(`  children     : ${children}`);
  console.log(`  enrolments   : ${enrolled}`);
  if (unplaced.length > 0) {
    console.log(`  unplaced     : ${unplaced.length} (${unplaced.join(", ")})`);
  }
  console.log("");
  console.log(`  login: ${admin.username} / ${PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
