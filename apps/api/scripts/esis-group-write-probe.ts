/**
 * What do 152 and 162 actually want in their bodies?
 *
 * Spec №3б Task 2. The developer portal documents none of the three group
 * writes and the ministry's granted-service export carries only an id, a method
 * and a URL, so the field names have to come from the services themselves — the
 * way `studentContacts`'s `{ personId }` body was learned on 2026-09-14, when an
 * empty body answered `400 personId шаардлагатай`.
 *
 * ★ **`update` and `instructor` only. `create` (150) is never probed.**
 *
 * A rejected update cannot create a record: it either names a group that
 * exists, or it fails. A create with a half-right body might **succeed**, and
 * leave a group in the ministry's register that nothing here asked for and 152
 * would then have to remove. There is no test environment. `groupCreate`'s
 * schema is written from what these two reveal plus the one deliberate,
 * watched create in the live exercise.
 *
 * ★★ Two bodies per service and no more. This runs against the ministry's
 * production gateway during a trial month in which every call is read, so it
 * spends exactly the calls it needs: an empty body, then `institutionId` alone,
 * which together separate "what is required" from "what is required *after*
 * the institution".
 *
 *   ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-group-write-probe.ts
 */
import { loadEnv } from "../src/config/env";
import { EsisClient, EsisError } from "../src/integrations/esis/esis.client";
import { EsisConfig } from "../src/integrations/esis/esis.config";
import { ESIS_ENDPOINTS } from "../src/integrations/esis/esis.endpoints";

/** The services this probe is allowed to touch. 150 is deliberately absent. */
const PROBED = ["groupUpdate", "groupInstructor"] as const;

async function main(): Promise<void> {
  const config = new EsisConfig(loadEnv());
  if (!config.isConfigured) throw new Error("ESIS_TOKEN is not set");

  const client = new EsisClient(config);
  const institutionId = Number(process.env.ESIS_INSTITUTION_ID ?? "42778");

  /*
   * ★ Step four, 2026-09-18 — the last unknown: what does `instructorRole`
   * accept?
   *
   * The ministry's documentation for 162 lists the field as required and names
   * it "Багшийн хариуцах үүрэг", but gives no vocabulary. Nothing else has it
   * either: none of the thirteen swept reference resources carries it, and all
   * four of 42778's groups read `instructorId: null`, so there is no example to
   * copy.
   *
   * ★★ Every body below names a **studentGroupId of 0** and an
   * **instructorId of 0**. That is deliberate: a rejected value teaches the
   * vocabulary, and a value the service happens to accept must not be able to
   * attach anybody to any real group. The documentation is also explicit that
   * assigning is `CREATE` — "UPDATE зөвхөн instructorRole өөрчлөх үед хийнэ" —
   * so that is the event used.
   */
  const roles: string[] = ["", "LEAD", "MAIN", "ҮНДСЭН", "Үндсэн багш", "1"];
  const probes: Record<string, Record<string, unknown>[]> = {
    groupUpdate: [],
    groupInstructor: roles.map((instructorRole) => ({
      event: "CREATE",
      institutionId,
      studentGroupId: 0,
      instructorId: 0,
      instructorRole,
    })),
  };

  for (const key of PROBED) {
    const endpoint = ESIS_ENDPOINTS[key];
    const bodies = probes[key] ?? [];
    for (const body of bodies) {
      const label = `${key} ${JSON.stringify(body)}`;
      try {
        const response = await client.request<unknown>({
          path: endpoint.path,
          method: "POST",
          body,
          parse: (raw: unknown) => raw,
        });
        console.log(`${label} → OK ${JSON.stringify(response.data)}`);
      } catch (error) {
        console.log(`${label} → ${describe(error)}`);
      }
    }
  }
}

/**
 * The error with its body kept.
 *
 * ★ The message body is the entire point of this script — "personId
 * шаардлагатай" is the ministry telling us the contract — so it is printed
 * whole rather than reduced to a status code the way `safeErrorCode` does for
 * audit rows.
 */
function describe(error: unknown): string {
  if (error instanceof EsisError) {
    const { status, bodyExcerpt } = error.detail;
    return `status=${String(status ?? "?")} body=${bodyExcerpt ?? "(none)"}`;
  }
  return String(error);
}

void main();
