/**
 * One-off: does this token reach the мэргэшлийн зэрэг services at all?
 *
 * ★ **Read-only. 165 is deliberately absent.**
 *
 * `ESIS_TRIAL_STATE.md` §1: there is no test environment — "Илгээх `POST` бүр
 * яамны бодит бичлэг рүү очно". 165 is `degree/request/v2`, which files a real
 * qualification-degree application against a real teacher at institution 42778.
 * That is not a thing to discover with. This script establishes whether the
 * three **reads** work; the write is a separate decision with the client.
 *
 * ★★ It probes 119 on **both roots**, which is the whole point.
 *
 * `esis.requests.ts` records a live probe from 2026-09-17: the export's stated
 * root `/svc/api/zereg/…` answered `404 Зам олдсонгүй` (so it is not a path on
 * this host), while `/svc/api/hub/v2/zereg/…` answered `403 Энэ API-д хандах
 * эрх байхгүй` (the shape a real route gives an unauthorised token). The client
 * has since named 119 as one to use, so the question is whether that 403 has
 * been opened. Both roots are tried because the answer *distinguishes* them:
 * 404 on one and 403 on the other is what proved the route exists at all.
 *
 * ★★★ 119 gates the other two for *use*, not for *diagnosis*. 167 and 170 are
 * keyed by `:requestId`, and 119 is what turns a register number into one — so
 * without it they cannot be driven. They are still probed with a placeholder
 * id, because the answer separates the two states that matter: `403` is the
 * token being refused the service, as 119 is, while a not-found shape is the
 * service being open and the id being wrong. Only the first would mean the
 * grant is missing.
 *
 * ★★★★ Register numbers are masked in every line, the same discipline
 * `esis-probe.ts` states: they are parameters here, never output.
 *
 *   ESIS_INSTITUTION_ID=42778 pnpm --filter @kinder/api exec tsx scripts/esis-degree-probe.ts
 */
import { loadEnv } from "../src/config/env";
import { EsisClient, EsisError } from "../src/integrations/esis/esis.client";
import { EsisConfig } from "../src/integrations/esis/esis.config";
import { EsisService } from "../src/integrations/esis/esis.service";

const mask = (value: string): string =>
  value.length > 4
    ? `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`
    : "***";

/** What one attempt produced, in the terms the 2026-09-17 probe used. */
async function attempt(
  client: EsisClient,
  label: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<{ ok: boolean; status: number | null; detail: string; body?: unknown }> {
  try {
    const response = await client.request({ path, query });
    // `.data` is the ministry's envelope; the wrapper carries status and source.
    return { ok: true, status: response.status, detail: "OK", body: response.data };
  } catch (error) {
    if (error instanceof EsisError) {
      /*
        ★ The body excerpt is the whole value of a 4xx here. "ESIS responded
        400" says the route exists and the request is wrong; only the body says
        *which* part — and on 2026-09-17 it was the difference between 403 (no
        access) and 404 (no such path) that proved the route was real at all.
      */
      return {
        ok: false,
        status: error.detail.status ?? null,
        detail:
          `${error.detail.status ?? "—"} ${error.message}` +
          (error.detail.bodyExcerpt ? ` · ${error.detail.bodyExcerpt}` : ""),
      };
    }
    return { ok: false, status: null, detail: String(error) };
  } finally {
    void label;
  }
}

async function main(): Promise<void> {
  const config = new EsisConfig(loadEnv());
  const client = new EsisClient(config);
  const institutionId = process.env.ESIS_INSTITUTION_ID;

  if (!config.isAvailable) {
    console.error("ESIS is not configured — ESIS_BASE_URL and ESIS_TOKEN must be set.");
    process.exitCode = 1;
    return;
  }
  if (!institutionId) {
    console.error("ESIS_INSTITUTION_ID is required.");
    process.exitCode = 1;
    return;
  }

  /*
   * ★ One real register number, from the staff roll this institution already
   * serves us. Inventing one would probe nothing — a made-up РД cannot be told
   * apart from a refused route, because both answer "not found".
   *
   * `school/staff` is the superset of the two staff lists and sends РД in lower
   * case (see the note in `esis.roster.ts`), so this reads that one.
   */
  const staff = await attempt(client, "staff", "/svc/api/hub/v2/school/staff", { institutionId });
  if (!staff.ok) {
    console.error(`staff roll unreadable (${staff.detail}) — cannot obtain a register number.`);
    process.exitCode = 1;
    return;
  }

  const envelope = staff.body as Record<string, unknown>;
  const rows = (Array.isArray(envelope?.RESULT) ? envelope.RESULT : []) as Record<
    string,
    unknown
  >[];
  const withReg = rows.find(
    (row) => typeof row.personRegNumber === "string" && row.personRegNumber,
  );
  const registerNumber = String(withReg?.personRegNumber ?? "").toUpperCase();

  if (!registerNumber) {
    /*
      ★ Print the envelope's shape, never its contents. `esis-field-lists-must-
      be-probed` is exactly this failure: a key guessed from documentation that
      the wire does not use. Keys are structure; the rows are people.
    */
    console.error(
      `no personRegNumber found. envelope keys: ${Object.keys(envelope ?? {}).join(", ") || "(none)"}` +
        ` · RESULT rows: ${rows.length}` +
        (rows[0] ? ` · row keys: ${Object.keys(rows[0]).join(", ")}` : ""),
    );
    process.exitCode = 1;
    return;
  }

  console.log(`institution ${institutionId} · staff rows ${rows.length}`);
  console.log(`probing with register ${mask(registerNumber)}\n`);

  // ── 119, both roots ───────────────────────────────────────────────────────
  const exportRoot = await attempt(
    client,
    "119 export root",
    `/svc/api/zereg/get/request/${registerNumber}`,
  );
  /*
    ★ `institutionId` on the hub root — the ministry's own 400 asked for it:
    `{"message":"institutionId дутуу байна"}`. The export's row does not mention
    it, which is the same gap `esis.service.ts` records for other services whose
    portal entry omits the parameter they refuse without.
  */
  const hubRoot = await attempt(
    client,
    "119 hub root",
    `/svc/api/hub/v2/zereg/get/request/${registerNumber}`,
    { institutionId },
  );

  console.log(`119  /svc/api/zereg/get/request/:rd        → ${exportRoot.detail}`);
  console.log(`119  /svc/api/hub/v2/zereg/get/request/:rd → ${hubRoot.detail}`);

  /*
    ── 167 and 170, classified rather than exercised ────────────────────────

    ★ Both are keyed by `:requestId`, which only 119 turns a register number
    into. Without 119 they cannot be *used* — but they can still be told apart,
    and the distinction is the one that matters to the client:

      403  the token is refused the service, exactly as 119 is
      400/404 with a not-found shape  the service is open and the id is wrong

    The second means the grant is live and only the 119 gap blocks the module.
    A placeholder id is honest here because the question is about access, not
    about a record — and nothing is written either way.

    ★★ 170's portal URL carries `institutionId` **twice** — once in the path and
    once in the query (`/degree/history/v2/:institutionId/:requestId?institutionId=…`).
    It is sent exactly as published rather than tidied: a guess at which one the
    gateway reads would turn a 400 into an unexplained failure.
  */
  const PLACEHOLDER_REQUEST_ID = "0";
  const decisions = await attempt(
    client,
    "167",
    `/svc/api/hub/v2/degree/request/decisions/${PLACEHOLDER_REQUEST_ID}`,
    { institutionId },
  );
  const history = await attempt(
    client,
    "170",
    `/svc/api/hub/v2/degree/history/v2/${institutionId}/${PLACEHOLDER_REQUEST_ID}`,
    { institutionId },
  );

  const shape = (result: { ok: boolean; status: number | null; detail: string; body?: unknown }) =>
    result.ok
      ? `${result.status} ${JSON.stringify(result.body) ?? "(no body)"}`.slice(0, 300)
      : result.detail;

  console.log(`167  /degree/request/decisions/:requestId  → ${shape(decisions)}`);
  console.log(`170  /degree/history/v2/:inst/:requestId   → ${shape(history)}`);

  /*
    ── The wired readers, through the real service path ──────────────────────

    ★ The two calls above go out through `EsisClient` directly, which proves the
    *routes*. This proves the **wiring**: `EsisService.read` resolving the
    catalog entry, filling `:institutionId` into 170's path from the tenant's own
    value, and running the response through `esisListParser`.

    It is the step the two calls above cannot cover, and the one most likely to
    be wrong — `scripts/esis-probe.ts` reports `degreeHistory` as needing an
    `institutionId` it has no way to supply, because it derives required params
    from the path template. That derivation is the probe's own; `getList`
    injects the value. If that injection were missing, this call throws
    `Missing ESIS path parameter institutionId` rather than reaching ESIS.
  */
  const service = new EsisService(client, config);
  for (const resource of ["degreeDecisions", "degreeHistory"] as const) {
    try {
      const response = await service.read(resource, { requestId: "0" }, institutionId);
      console.log(`${resource.padEnd(16)} via service → ${response.data.length} rows`);
    } catch (error) {
      const detail =
        error instanceof EsisError
          ? `${error.detail.status ?? "—"} ${error.message}`
          : String(error);
      console.log(`${resource.padEnd(16)} via service → ${detail}`);
    }
  }

  const reachable = exportRoot.ok ? exportRoot : hubRoot.ok ? hubRoot : null;
  if (!reachable) {
    console.log(
      "\n119 is refused on both roots: the export's /svc/api/zereg/ root is not a\n" +
        "path on this host (404), and the hub root answers 403 once institutionId\n" +
        "is supplied — the 400 without it is a parameter check that runs before\n" +
        "the access check, not a sign the grant is open.\n\n" +
        "119 is what turns a register number into a requestId, so the module\n" +
        "cannot be driven end to end until БМТТ opens it on the live gateway,\n" +
        "whatever the portal's APPROVED row says. The two lines above say\n" +
        "whether 167 and 170 are in the same state or merely lack an id.",
    );
    return;
  }

  console.log(`\n119 answered. Body:\n${JSON.stringify(reachable.body, null, 2).slice(0, 2000)}`);

  /*
   * ★ The requestId is whatever 119 calls it, and this script does not guess.
   * `esis-field-lists-must-be-probed` is the rule: eleven of thirty-six readers
   * were written from documentation and were fiction. The body is printed above
   * so the field name comes from the wire.
   */
  console.log("\nNext: name the requestId field from the body above, then probe 167 and 170.");
}

void main();
