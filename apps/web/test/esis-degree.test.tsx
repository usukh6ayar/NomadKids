import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";

/**
 * Мэргэшлийн зэргийн хүсэлт — the two reads, 2026-09-22.
 *
 * ★ The client named four services. Two are wired and tested here; the other two
 * are not, for reasons the code records and these cases deliberately do **not**
 * assert, because a test cannot prove a live gateway's grant: 119 answers `403`
 * and was dropped at the client's instruction, and 165 is a POST that files a
 * real application against a real teacher.
 *
 * ★★ What is worth pinning in the browser is small and specific: the panel asks
 * for a request number instead of calling with a guessed one, and it sends that
 * number as `requestId`. Whether ESIS answers is `scripts/esis-degree-probe.ts`'s
 * business — `test/setup.ts` deletes the token, so nothing here reaches the
 * ministry and a green run proves nothing about it.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const CATALOG_PATH = `/kindergartens/${KG}/esis/catalog`;
const READ_PATH = `/kindergartens/${KG}/esis/resource`;

/**
 * The catalog row, shaped as the panel reads it.
 *
 * ★ One field and it is the anchor, matching `ESIS_FIELDS`: neither service has
 * ever answered with a populated `RESULT`, so the rest of the columns arrive by
 * discovery. A fixture inventing output fields would be testing a contract
 * nobody has seen.
 */
const endpoint = (key: string, apiId: number, slug: string, name: string) => ({
  key,
  apiId,
  slug,
  method: "GET",
  path: `/svc/api/hub/v2/${key}`,
  name,
  domain: "ROSTER",
  usage: "Хүсэлтийн дугаараар",
  previewable: false,
  readable: true,
  params: ["requestId"],
  fields: [{ name: "requestId", label: "Хүсэлтийн дугаар", io: "OUTPUT" as const, ingested: true }],
  fieldSource: "ADAPTER",
  ingestedFieldCount: 1,
  accessStatus: "UNKNOWN",
  direction: "ESIS_TO_NOMADKIDS",
  targetModel: "StaffRecord",
  mappings: [],
  responseMode: "LIVE",
  syncStatus: "PENDING",
  syncErrorCode: null,
  httpStatus: null,
  lastSyncAt: null,
});

const catalog = {
  mode: "LIVE" as const,
  canRead: true,
  endpoints: [
    endpoint("degreeDecisions", 167, "API-000265", "Мэргэшлийн зэргийн хүсэлтийн шийдвэрлэлт"),
    endpoint("degreeHistory", 170, "API-000268", "Мэргэшлийн зэргийн хүсэлтийн түүх"),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("мэргэшлийн зэргийн хүсэлт — ЭСИС панелууд", () => {
  it("asks for a request number instead of reading on open", async () => {
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog },
    ]);
    renderWithProviders(<EsisDataPanel resource="degreeDecisions" />);

    expect(await screen.findByLabelText("Хүсэлтийн дугаар")).toHaveValue("");

    /*
     * ★ The assertion that matters. A panel keyed by an id it does not hold must
     * not call: guessing a request number means asking the ministry about
     * somebody else's application. The three panels beside it on `/admin/users`
     * follow the same rule, and `students` is the one that reads on open —
     * because it takes no parameter at all.
     */
    expect(api.calls.filter((call) => call.url.startsWith(READ_PATH))).toEqual([]);
  });

  /*
   * ★ It sends `requestId`, not one of the register-number params. Those are
   * redacted out of the audit row on purpose; a request number is an ESIS id and
   * belongs in it, so sending it under the wrong name would both mislabel the
   * value and lose the audit trail. `esis.dto.ts` carries that reasoning.
   */
  it("sends what was typed as requestId", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: CATALOG_PATH, body: catalog },
      {
        path: READ_PATH,
        body: {
          resource: "degreeHistory",
          endpoint: { method: "GET", path: "/svc/api/hub/v2/degree/history/v2" },
          source: "LIVE",
          status: "SUCCEEDED",
          errorCode: null,
          count: 0,
          durationMs: 8,
          fields: catalog.endpoints[1]!.fields,
          rows: [],
          response: { SUCCESS_CODE: 203, RESPONSE_MESSAGE: "Хүсэлтэд тохирох утга олдсонгүй." },
        },
      },
    ]);
    renderWithProviders(<EsisDataPanel resource="degreeHistory" />);

    /*
     * ★ `{Enter}` rather than a button, and the parameter rides in the **query**
     * — the shape `studentByRegister`'s own case pins. Asserting on a request
     * body here would pass against a panel that never sent the value at all.
     */
    await user.type(await screen.findByLabelText("Хүсэлтийн дугаар"), "7788{Enter}");

    const reads = api.calls.filter((call) => call.url.startsWith(READ_PATH));
    expect(reads.length).toBeGreaterThan(0);

    /*
     * ★ The **last** read, not the only one. A non-personal parameter reads as
     * it is typed, so four keystrokes make four calls — that is the panel's
     * existing behaviour for every id-keyed service, not something these two
     * introduce, and `studentByRegister` is the exception because a register
     * number is held back until Enter on purpose.
     *
     * What this pins is the name the value travels under.
     */
    expect(reads.at(-1)!.url).toContain("requestId=7788");
    // Never under a register-number name: those are redacted out of the audit row.
    expect(reads.at(-1)!.url).not.toContain("personRegNumber");
  });

  /*
   * ★ Not tested here: that a `203` reads as "empty" rather than "failed".
   *
   * `esis-columns.test.tsx` already pins that distinction centrally, on
   * `EsisNoAnswer` itself — "separates an empty answer from a failed one" — and
   * these two panels do nothing to it. A third copy of the same assertion,
   * phrased against this fixture, would pin the copy of an empty state rather
   * than the rule, and would need editing the next time the wording changes.
   */
});
