import { ESIS_RESOURCE_CATALOG, type EsisEndpointKey } from "./esis.catalog";
import { ESIS_DISPOSITIONS, ESIS_PORTAL_REQUESTS } from "./esis.requests";

/**
 * The evidence the ministry reads — spec `2026-09-15-esis-full-coverage-design`
 * §7, one row per granted service.
 *
 * ★ It answers two questions that pull against each other. The ministry granted
 * 84 services for one institution for one month, and at the end will ask both
 * "did you use what we gave you?" and "did you call anything you had no reason
 * to?" — where calling more looks good against the first and bad against the
 * second. A page that answers only one of them argues for nothing.
 *
 * ★★ Every uncalled service carries a **named reason**. That is the whole
 * difference between this and a usage report: a silent zero reads as
 * carelessness, and "129 files an income return this product does not produce"
 * reads as a decision. The reasons come from `ESIS_DISPOSITIONS` and from the
 * catalogue's own notes, written when each decision was made rather than
 * reconstructed here.
 */

/** Where a service stands, and why. */
export type EsisCoverageState =
  /** Called by this kindergarten in the window. */
  | "IN_USE"
  /** Wired to a screen, but nothing has called it in the window. */
  | "WIRED_UNUSED"
  /** Deliberately not wired, with a reason. */
  | "DISPOSITIONED"
  /** Granted, unwired, and nobody has decided what to do about it. */
  | "UNDECIDED"
  /** A later version of the same service is wired instead. */
  | "SUPERSEDED";

export interface EsisCoverageRow {
  apiId: number;
  /** The portal's own name, which is what a ministry reviewer recognises. */
  name: string;
  /** Our key, or `null` when this product does not carry the service. */
  serviceKey: string | null;
  method: string | null;
  path: string | null;
  /** What it is for, in this product's words. Empty when unwired. */
  purpose: string;
  /** What causes a call: a screen, a schedule, an approval. */
  trigger: string;
  lastCalledAt: string | null;
  calls: number;
  state: EsisCoverageState;
  /** Why an uncalled service is uncalled. */
  reason: string | null;
}

export interface EsisCoverageMatrix {
  /** The window these counts cover. */
  from: string;
  to: string;
  totals: {
    granted: number;
    wired: number;
    inUse: number;
    /** Wired but not called in the window. */
    wiredUnused: number;
    /** Not wired, and every one of them with a stated reason. */
    dispositioned: number;
    superseded: number;
    /** Granted, unwired, no reason recorded. **This should be zero.** */
    undecided: number;
  };
  rows: EsisCoverageRow[];
}

/**
 * The services a later version replaced.
 *
 * ★ Named here rather than inferred. `…793` and `105` are attendance v1 and v2;
 * 171 (v3) is wired and live, and wiring all three would invite two screens to
 * write the same day differently. A reviewer reading "0 calls" needs to see
 * that this was a choice about correctness.
 */
const SUPERSEDED: Readonly<Record<number, string>> = {
  100004874669793:
    "Ирцийн v1 — 171 (v3) холбогдсон. Гурвуулангаас бичвэл нэг өдрийг зөрүүтэй бичнэ.",
  105: "Ирцийн v2 — 171 (v3) холбогдсон. Мөн шалтгаан.",
};

/**
 * What causes a call, per service key.
 *
 * ★ A trigger is the second half of "we used it with a reason". `AuditLog`
 * records that `staff` was read 31 times; only this says those were a nightly
 * sweep rather than somebody looping over the roster.
 *
 * ★★ Keys absent from this map fall back to "дэлгэц нээхэд", which is what an
 * on-demand read is. The map names the ones that are **not** that, because a
 * scheduled service and an approval-gated write are the two a reviewer will
 * look for.
 */
const TRIGGERS: Readonly<Partial<Record<EsisEndpointKey, string>>> = {
  staff: "Ажилтны sync — өдөр бүр 03:40",
  teachers: "Ажилтны sync — өдөр бүр 03:40",
  studentMovements: "Ажилтны sync — өдөр бүр 03:40",
  foodProductTypes: "Лавлахын шүүрдэлт — сард нэг, 1-ний 04:10",
  foodMaterialGroups: "Лавлахын шүүрдэлт — сард нэг",
  foodMaterials: "Лавлахын шүүрдэлт — сард нэг",
  foodProducts: "Лавлахын шүүрдэлт — сард нэг",
  foodProductMaterials: "Лавлахын шүүрдэлт — сард нэг",
  screeningQuestions: "Лавлахын шүүрдэлт — сард нэг",
  buildings: "Лавлахын шүүрдэлт — сард нэг",
  rooms: "Лавлахын шүүрдэлт — сард нэг",
  programs: "Лавлахын шүүрдэлт — сард нэг",
  subjectAreas: "Лавлахын шүүрдэлт — сард нэг",
  academicOrg: "Лавлахын шүүрдэлт — сард нэг",
  vaccineCatalog: "Лавлахын шүүрдэлт — сард нэг",
  academicYearStatuses: "Лавлахын шүүрдэлт — сард нэг",
  groupCreate: "Захирал батласны дараа, дараалалаар",
  groupUpdate: "Захирал батласны дараа, дараалалаар",
  groupInstructor: "Захирал батласны дараа, дараалалаар",
  saveAttendanceV3: "Багш ирц бүртгэхэд",
};

const DEFAULT_TRIGGER = "Дэлгэц нээхэд";

export interface EsisUsage {
  /** The service key an audit row named. */
  objectId: string;
  calls: number;
  lastCalledAt: Date | null;
}

export interface EsisSyncRunSummary {
  resources: string[];
  startedAt: Date;
}

/**
 * Builds the matrix from the register, the catalogue and what actually happened.
 *
 * ★ A pure function of its inputs, so the decisions in it — what counts as
 * used, what counts as a reason — are testable without a database or a
 * ministry. The repository supplies the two halves of "what happened"; nothing
 * here reaches for them.
 */
export function buildEsisCoverage(input: {
  from: Date;
  to: Date;
  usage: EsisUsage[];
  syncRuns: EsisSyncRunSummary[];
}): EsisCoverageMatrix {
  /*
   * ★ Indexed by the portal's id, because that is what a ministry reviewer
   * reads down. `ESIS_RESOURCE_CATALOG` already joins the endpoint, the
   * catalogue entry and the grant, so nothing here re-derives any of them.
   */
  const byApiId = new Map<number, (typeof ESIS_RESOURCE_CATALOG)[number]>();
  for (const entry of ESIS_RESOURCE_CATALOG) {
    if (entry.apiId !== null) byApiId.set(entry.apiId, entry);
  }

  /*
   * ★ A sync run's audit row names the run, not the thirteen services it swept.
   * Counting `AuditLog` alone would report every scheduled sweep as one call to
   * nothing, and the reference services — the largest block of the grant —
   * would all read zero. `EsisSyncRun.resources` is what a run actually did.
   */
  const counts = new Map<string, { calls: number; last: Date | null }>();
  const bump = (objectId: string, calls: number, at: Date | null) => {
    const seen = counts.get(objectId) ?? { calls: 0, last: null };
    seen.calls += calls;
    if (at && (!seen.last || at > seen.last)) seen.last = at;
    counts.set(objectId, seen);
  };

  for (const row of usageInWindow(input.usage)) bump(row.objectId, row.calls, row.lastCalledAt);
  for (const run of input.syncRuns) {
    for (const resource of run.resources) bump(resource, 1, run.startedAt);
  }

  const rows: EsisCoverageRow[] = ESIS_PORTAL_REQUESTS.filter(
    (request) => request.status === "APPROVED",
  ).map((request) => {
    const entry = byApiId.get(request.apiId);
    const key = entry?.key ?? null;
    const seen = key ? counts.get(key) : undefined;
    const calls = seen?.calls ?? 0;

    const superseded = SUPERSEDED[request.apiId];
    const disposition = ESIS_DISPOSITIONS[request.apiId];

    const state: EsisCoverageState = superseded
      ? "SUPERSEDED"
      : calls > 0
        ? "IN_USE"
        : key
          ? "WIRED_UNUSED"
          : disposition
            ? "DISPOSITIONED"
            : "UNDECIDED";

    return {
      apiId: request.apiId,
      name: request.name,
      serviceKey: key,
      method: entry?.method ?? null,
      path: entry?.path ?? null,
      purpose: entry?.usage ?? "",
      trigger: key ? (TRIGGERS[key] ?? DEFAULT_TRIGGER) : "—",
      lastCalledAt: seen?.last ? seen.last.toISOString() : null,
      calls,
      state,
      reason: superseded ?? disposition ?? null,
    };
  });

  const count = (state: EsisCoverageState) => rows.filter((row) => row.state === state).length;

  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    totals: {
      granted: rows.length,
      wired: rows.filter((row) => row.serviceKey !== null).length,
      inUse: count("IN_USE"),
      wiredUnused: count("WIRED_UNUSED"),
      dispositioned: count("DISPOSITIONED"),
      superseded: count("SUPERSEDED"),
      undecided: count("UNDECIDED"),
    },
    rows,
  };
}

/** The audit rows already come scoped to the window; this keeps the shape honest. */
function usageInWindow(usage: EsisUsage[]): EsisUsage[] {
  return usage.filter((row) => row.objectId.length > 0);
}
