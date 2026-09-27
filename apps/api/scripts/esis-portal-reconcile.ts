/**
 * Compares this catalogue's declared field lists against the developer
 * portal's own `params`, service by service.
 *
 * ★ The portal publishes `https://developerv2.esis.edu.mn/api/structure` as
 * **JSON** — 45 rows, 24 of them real services, each carrying every input and
 * output with a name, a type and a Mongolian description. That is the document
 * `ESIS_FIELDS` has been transcribed from by hand, one service at a time, and
 * this compares the two mechanically instead.
 *
 * ★★ It reads the portal live rather than from a committed copy. A snapshot
 * would answer the question "did we transcribe it right in September" when what
 * matters is "is it right now" — the same reason the food-discount read is
 * never stored.
 *
 *   pnpm exec tsx scripts/esis-portal-reconcile.ts
 */
import { ESIS_ENDPOINTS } from "../src/integrations/esis/esis.endpoints";
import { ESIS_FIELDS } from "../src/integrations/esis/esis.fields";

const PORTAL = "https://developerv2.esis.edu.mn/api/structure";

interface PortalParam {
  name: string;
  type: string;
  required: boolean;
  desc: string;
  io: "input" | "output";
}

interface PortalItem {
  API_ID: number | null;
  slug: string | null;
  name: string | null;
  method: string | null;
  url?: string;
  params?: PortalParam[];
}

async function main(): Promise<void> {
  const response = await fetch(PORTAL);
  const body = (await response.json()) as { sections: { items: PortalItem[] }[] };
  const portal = new Map<number, PortalItem>();
  for (const section of body.sections) {
    for (const item of section.items) {
      if (item.url && item.API_ID !== null) portal.set(item.API_ID, item);
    }
  }
  console.log(`portal: ${portal.size} services with a URL`);

  let compared = 0;
  let clean = 0;

  for (const [key, endpoint] of Object.entries(ESIS_ENDPOINTS)) {
    if (endpoint.apiId === null) continue;
    const item = portal.get(endpoint.apiId);
    if (!item) continue;
    compared += 1;

    const problems: string[] = [];

    const portalPath = (item.url ?? "")
      .trim()
      .replace("https://hubv2.esis.edu.mn", "")
      .split("?")[0]!;
    if (portalPath !== endpoint.path) {
      problems.push(`path: ours ${endpoint.path} · portal ${portalPath}`);
    }
    if (item.method && item.method !== endpoint.method) {
      problems.push(`method: ours ${endpoint.method} · portal ${item.method}`);
    }
    if (item.slug && item.slug !== endpoint.slug) {
      problems.push(`slug: ours ${endpoint.slug} · portal ${item.slug}`);
    }

    /*
     * ★ Outputs are compared as a set, in both directions. A field we declare
     * that the portal does not have renders as a permanently empty column; one
     * the portal has and we do not is a value shown to nobody — and the second
     * is the one a count would miss.
     */
    const declared = new Set(
      (ESIS_FIELDS[key as keyof typeof ESIS_FIELDS] ?? []).map((f) => f.name),
    );
    const portalOut = new Set(
      (item.params ?? []).filter((p) => p.io === "output").map((p) => p.name),
    );
    const portalIn = new Set(
      (item.params ?? []).filter((p) => p.io === "input").map((p) => p.name),
    );
    const expected = endpoint.method === "POST" ? portalIn : portalOut;

    if (expected.size > 0) {
      const missing = [...expected].filter((n) => !declared.has(n));
      const extra = [...declared].filter((n) => !expected.has(n) && !portalIn.has(n));
      if (missing.length > 0) problems.push(`missing: ${missing.join(", ")}`);
      if (extra.length > 0) problems.push(`not in portal: ${extra.join(", ")}`);
    }

    if (problems.length === 0) {
      clean += 1;
      console.log(`OK   ${String(endpoint.apiId).padStart(4)} ${key}`);
    } else {
      console.log(`DIFF ${String(endpoint.apiId).padStart(4)} ${key}`);
      for (const p of problems) console.log(`       ${p}`);
    }
  }

  console.log(`\ncompared ${compared} · clean ${clean} · differing ${compared - clean}`);
}

void main();
