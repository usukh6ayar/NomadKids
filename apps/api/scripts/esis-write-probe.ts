/**
 * What do the thirteen undocumented write services want in their bodies?
 *
 * The developer portal renders 24 of our 73 services and none of these; the
 * ministry's granted-service export carries only an id, a method and a URL. So
 * their field lists are inference — `fieldSource: "ADAPTER"` — and 162 showed
 * on 2026-09-18 what inference costs: three of its five fields were wrong,
 * including the verb.
 *
 * ★ **Nothing here can change a record, and that is by construction rather
 * than by care.** Every body is `{}` or `{ institutionId }`. No `personId`, no
 * child, no value — so the best case is a `400` naming what is missing, and
 * there is no case in which the ministry writes something about somebody. That
 * is the same discipline `esis-group-write-probe.ts` used, and the reason 150
 * was never probed: a create can succeed on a half-right body, a save about
 * nobody cannot.
 *
 * ★★ These services carry children's medical records — allergies, disability,
 * surgery, incidents, screening. A probe that sent a real `personId` would be
 * putting a child's identifier into the ministry's logs to learn a field name.
 * The empty body learns the same thing and names nobody.
 *
 *   ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-write-probe.ts
 */
import { loadEnv } from "../src/config/env";
import { EsisClient, EsisError } from "../src/integrations/esis/esis.client";
import { EsisConfig } from "../src/integrations/esis/esis.config";
import { ESIS_ENDPOINTS } from "../src/integrations/esis/esis.endpoints";

/** The thirteen writes whose contract has never been seen. */
const PROBED = [
  "studentContactsSave",
  "studentStatisticsSave",
  "studentConditionSave",
  "studentAllergySave",
  "studentProhibitedFoodSave",
  "studentDisabilitySave",
  "studentAssessmentsSave",
  "studentMeasurementSave",
  "studentSurgerySave",
  "studentIncidentSave",
  "studentAttachmentSave",
  "groupMeasurementsSave",
  "studentScreeningSave",
] as const;

async function main(): Promise<void> {
  const config = new EsisConfig(loadEnv());
  if (!config.isConfigured) throw new Error("ESIS_TOKEN is not set");

  const client = new EsisClient(config);
  const institutionId = Number(process.env.ESIS_INSTITUTION_ID ?? "42778");

  for (const key of PROBED) {
    const endpoint = ESIS_ENDPOINTS[key];
    /*
     * ★ `studentContactsSave` gets a third body. It answered **500 Серверийн
     * алдаа** to both of the others where every sibling answered a 400 naming a
     * field — an unhandled exception rather than a validation refusal, which
     * says the shape is wrong at a level the service does not check. Its read
     * half takes `{ personId }`, so that is the next thing to try.
     */
    const bodies: Record<string, unknown>[] =
      key === "studentContactsSave"
        ? [
            {},
            { institutionId },
            { institutionId, personId: 0 },
            { institutionId, contactList: [] },
          ]
        : [{}, { institutionId }];

    for (const body of bodies) {
      const label = `${key} ${JSON.stringify(body)}`;
      try {
        const response = await client.request<unknown>({
          path: endpoint.path,
          method: "POST",
          body,
          parse: (raw: unknown) => raw,
        });
        /*
         * ★ A `200` here is a result worth reading twice, not a success. It
         * would mean the service accepted a body naming no child — and what it
         * then did is the question.
         */
        console.log(`${label} → OK ${JSON.stringify(response.data)}`);
      } catch (error) {
        console.log(`${label} → ${describe(error)}`);
      }
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof EsisError) {
    return `status=${String(error.detail.status ?? "?")} body=${error.detail.bodyExcerpt ?? "(none)"}`;
  }
  return String(error);
}

void main();
