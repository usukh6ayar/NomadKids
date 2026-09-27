/**
 * The ministry's current group list for one institution.
 *
 * ★ Run before and after the spec №3б live exercise. The whole argument for
 * creating a throwaway group rests on being able to show it was created and
 * then removed, and a count nobody recorded beforehand proves neither.
 *
 *   ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-groups-snapshot.ts
 */
import { loadEnv } from "../src/config/env";
import { EsisClient } from "../src/integrations/esis/esis.client";
import { EsisConfig } from "../src/integrations/esis/esis.config";
import { EsisService } from "../src/integrations/esis/esis.service";

async function main() {
  const config = new EsisConfig(loadEnv());
  const service = new EsisService(new EsisClient(config), config);
  const institutionId = process.env.ESIS_INSTITUTION_ID ?? "42778";

  const res = await service.read("groups", {}, institutionId);
  const rows = (res.data ?? []) as Record<string, unknown>[];
  console.log(`GROUPS ${rows.length}`);
  for (const row of rows) console.log(JSON.stringify(row));
}

void main();
