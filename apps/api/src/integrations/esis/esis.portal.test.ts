import { describe, expect, it } from "vitest";
import snapshot from "./esis.portal-snapshot.json";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_FIELDS } from "./esis.fields";

/**
 * The catalogue, checked against the developer portal's own document.
 *
 * ★ The portal publishes `https://developerv2.esis.edu.mn/api/structure` as
 * **JSON** — every service with each input and output, its type and a
 * Mongolian description. `ESIS_FIELDS` has been transcribed from that page by
 * hand, service by service, for a month. This compares the two mechanically,
 * which is how a `slug` that had read `"GRANTED"` since 2026-09-14 turned out
 * to be `API-000148` all along.
 *
 * ★★ Against a **committed snapshot**, not the live page. A test that fetched
 * would fail on an aeroplane and pass on a portal outage, and a suite that
 * reaches the network is a suite nobody trusts. `scripts/esis-portal-reconcile.ts`
 * is the live version; run it when the ministry changes something, and commit
 * the new snapshot with whatever it corrects.
 *
 * ★★★ It covers **11 of our 73** services, because that is how many the public
 * page renders. The other 62 are granted and documented nowhere we can read —
 * `esis.fields.ts`'s `fieldSource` records which of those met a live response
 * (`LIVE`) and which are still inference (`ADAPTER`). This test is the part
 * that can be mechanical; it does not pretend to be the whole check.
 */
const PORTAL = snapshot as Record<
  string,
  {
    slug: string | null;
    method: string | null;
    url: string;
    params: { name: string; type: string; required: boolean; io: string }[];
  }
>;

/** Our services that the public portal page also carries. */
const SHARED = Object.entries(ESIS_ENDPOINTS).filter(
  ([, endpoint]) => endpoint.apiId !== null && PORTAL[String(endpoint.apiId)] !== undefined,
);

describe("the developer portal's own document", () => {
  it("covers the eleven services the public page renders", () => {
    expect(SHARED).toHaveLength(11);
  });

  it("agrees with every shared service's path, method and slug", () => {
    for (const [key, endpoint] of SHARED) {
      const portal = PORTAL[String(endpoint.apiId)]!;
      const path = portal.url.replace("https://hubv2.esis.edu.mn", "").split("?")[0];

      expect({ key, path: endpoint.path, method: endpoint.method, slug: endpoint.slug }).toEqual({
        key,
        path,
        method: portal.method,
        slug: portal.slug,
      });
    }
  });

  /*
   * ★ Compared as a set, in **both** directions. A field we declare that the
   * portal does not have renders as a permanently empty column; one the portal
   * has and we do not is a value the ministry sends and nobody sees — and the
   * second is the one a count would miss.
   */
  it("declares exactly the fields the portal documents", () => {
    for (const [key, endpoint] of SHARED) {
      const portal = PORTAL[String(endpoint.apiId)]!;
      const wanted = endpoint.method === "POST" ? "input" : "output";
      const expected = portal.params.filter((p) => p.io === wanted).map((p) => p.name);
      if (expected.length === 0) continue;

      const declared = (ESIS_FIELDS[key as keyof typeof ESIS_FIELDS] ?? []).map((f) => f.name);
      const inputs = new Set(portal.params.filter((p) => p.io === "input").map((p) => p.name));

      /*
       * ★ A field can be **both**, and the portal says so: `livelihoodForm1`
       * lists `academicYear` and `academicMonth` as inputs *and* as outputs —
       * the service echoes back the period it was asked about. So an input is
       * only set aside when the portal does not also name it an output, rather
       * than being stripped on sight.
       */
      const outputsDeclared =
        wanted === "input"
          ? declared
          : declared.filter((name) => expected.includes(name) || !inputs.has(name));

      expect({ key, fields: [...new Set(expected)].sort() }).toEqual({
        key,
        fields: [...new Set(outputsDeclared)].sort(),
      });
    }
  });
});
