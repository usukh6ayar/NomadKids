/**
 * One live call per ESIS reader, through the real service code path.
 *
 * ★ This is the check the test suite cannot make. `test/setup.ts` deletes
 * `ESIS_TOKEN`, so every ESIS route under `vitest` answers from a stub. A green
 * suite therefore says nothing about whether a reader's schema parses what the
 * ministry actually sends — which is the failure mode `ESIS_API_READINESS.md`
 * §1.1 records nine times over.
 *
 * Discipline, from the 2026-09-15 design §3.2:
 *
 * - **One call per service**, and per-child services against **one** child. A
 *   discovery sweep across the roster is the log pattern the whole "named
 *   purpose, named trigger" argument exists to avoid.
 * - **Register numbers are masked** in every line this prints. They are
 *   parameters here, never output.
 *
 *   ESIS_INSTITUTION_ID=42778 pnpm --filter @kinder/api tsx scripts/esis-probe.ts
 */
import { loadEnv } from "../src/config/env";
import { EsisClient } from "../src/integrations/esis/esis.client";
import { EsisConfig } from "../src/integrations/esis/esis.config";
import { EsisService } from "../src/integrations/esis/esis.service";
import { ESIS_ENDPOINTS } from "../src/integrations/esis/esis.endpoints";

type Outcome = "OK" | "EMPTY" | "PARSE" | "HTTP" | "SKIP";

interface Row {
  key: string;
  outcome: Outcome;
  detail: string;
}

const mask = (value: string): string =>
  value.length > 4 ? `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}` : "***";

async function main(): Promise<void> {
  const config = new EsisConfig(loadEnv());
  if (!config.isConfigured) throw new Error("ESIS_TOKEN is not set");

  const service = new EsisService(new EsisClient(config), config);
  const institutionId = process.env.ESIS_INSTITUTION_ID ?? "42778";

  /*
   * Parameters come from the roster itself, so the probe follows the same path
   * a real screen would. `personRegNumber` is refused by the field catalogue,
   * so it is read from the raw envelope rather than from a parsed row — the one
   * place this script reaches past the reader, and the value never leaves it
   * unmasked.
   */
  const raw = async (path: string): Promise<Record<string, unknown>[]> => {
    const res = await fetch(`${config.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { RESULT?: unknown };
    return Array.isArray(body.RESULT) ? (body.RESULT as Record<string, unknown>[]) : [];
  };

  const groups = await service.read("groups", {}, institutionId);
  const students = await service.read("students", {}, institutionId);
  const products = await service.read("foodProducts", {}, institutionId);
  const programs = await service.read("programs", {}, institutionId);

  const firstGroup = groups.data?.[0] as { studentGroupId?: number | string } | undefined;
  const firstChild = students.data?.[0] as { personId?: number | string } | undefined;
  const firstProduct = products.data?.[0] as { productId?: number | string } | undefined;
  const firstProgram = programs.data?.[0] as { programOfStudyId?: number | string } | undefined;

  const staffRaw = await raw(`/svc/api/hub/v2/school/staff?institutionId=${institutionId}`);
  const studentsRaw = await raw(`/svc/api/hub/v2/students/list?institutionId=${institutionId}`);
  const workerNid = String(staffRaw[0]?.personRegNumber ?? "");
  const childNid = String(studentsRaw[0]?.personRegNumber ?? "");

  const studentGroupId = String(firstGroup?.studentGroupId ?? "");
  const personId = String(firstChild?.personId ?? "");
  const productId = String(firstProduct?.productId ?? "");
  const programOfStudyId = String(firstProgram?.programOfStudyId ?? "");

  let programStageId = "";
  let programPlanId = "";
  if (programOfStudyId) {
    const stages = await service.read("programStages", { programOfStudyId }, institutionId);
    programStageId = String(
      (stages.data?.[0] as { programStageId?: number | string } | undefined)?.programStageId ?? "",
    );
    if (programStageId) {
      const plans = await service.read(
        "programPlans",
        { programOfStudyId, programStageId },
        institutionId,
      );
      programPlanId = String(
        (plans.data?.[0] as { programPlanId?: number | string } | undefined)?.programPlanId ?? "",
      );
    }
  }

  const years = await service.read("academicYearStatuses", {}, institutionId);
  const academicYear = String(
    (years.data?.[0] as { academicYearId?: number | string; year?: number | string } | undefined)
      ?.academicYearId ??
      (years.data?.[0] as { year?: number | string } | undefined)?.year ??
      "2026",
  );

  const params: Record<string, string> = {
    studentGroupId,
    personId,
    productId,
    programOfStudyId,
    programStageId,
    programPlanId,
    academicYear,
    academicMonth: "9",
    beginDate: "2026-09-01",
    dayDate: "2026-09-11",
    personRegNumber: childNid,
    primaryNidNumber: workerNid,
  };

  console.log("resolved parameters");
  for (const [name, value] of Object.entries(params)) {
    const secret = name === "personRegNumber" || name === "primaryNidNumber";
    console.log(`  ${name.padEnd(18)} ${value ? (secret ? mask(value) : value) : "(unresolved)"}`);
  }
  console.log("");

  const keys = Object.keys(ESIS_ENDPOINTS).filter((key) => {
    const endpoint = ESIS_ENDPOINTS[key as keyof typeof ESIS_ENDPOINTS];
    return endpoint.method === "GET";
  });

  const rows: Row[] = [];
  for (const key of keys) {
    const endpoint = ESIS_ENDPOINTS[key as keyof typeof ESIS_ENDPOINTS];
    const needed = [...endpoint.path.matchAll(/:(\w+)/g)].map((match) => match[1]!);
    const missing = needed.filter((name) => !params[name]);
    if (missing.length > 0) {
      rows.push({ key, outcome: "SKIP", detail: `no ${missing.join(", ")}` });
      continue;
    }

    const supplied = Object.fromEntries(needed.map((name) => [name, params[name]!]));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (service as any).read(key, supplied, institutionId);
      if (res.status === "FAILED" || res.errorCode) {
        rows.push({ key, outcome: "HTTP", detail: `${res.errorCode ?? "failed"}` });
      } else if (!res.data || res.data.length === 0) {
        rows.push({ key, outcome: "EMPTY", detail: "203 / no rows" });
      } else {
        const fields = Object.keys(res.data[0] as object).length;
        rows.push({ key, outcome: "OK", detail: `${res.data.length} rows, ${fields} fields` });
      }
    } catch (error) {
      rows.push({
        key,
        outcome: "PARSE",
        detail: (error as Error).message.slice(0, 90).replace(/\s+/g, " "),
      });
    }
  }

  for (const row of rows) console.log(`${row.outcome.padEnd(6)} ${row.key.padEnd(24)} ${row.detail}`);

  const tally = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\n", tally, `of ${rows.length}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
