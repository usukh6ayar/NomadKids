/**
 * Removes one group from ESIS by the id its create returned.
 *
 * ★ Exists because `esis-group-write-exercise.ts` could not clean up after
 * itself: 150 answered `200 Бүлэг амжилттай үүсгэлээ` with a `studentGroupId`,
 * and api-40 (`groups`) then did **not** list the new group — so a lookup by
 * name found nothing and the exercise stopped with a real record left behind.
 * The id from the create response is the only handle on it.
 *
 *   ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-group-delete-by-id.ts <id> --i-mean-it
 */
import { loadEnv } from "../src/config/env";
import { EsisClient, EsisError } from "../src/integrations/esis/esis.client";
import { EsisConfig } from "../src/integrations/esis/esis.config";
import { EsisService } from "../src/integrations/esis/esis.service";

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id || !process.argv.includes("--i-mean-it")) {
    console.log("Usage: esis-group-delete-by-id.ts <studentGroupId> --i-mean-it");
    return;
  }

  const config = new EsisConfig(loadEnv());
  const service = new EsisService(new EsisClient(config), config);
  const institutionId = Number(process.env.ESIS_INSTITUTION_ID ?? "42778");

  const payload = {
    institutionId,
    event: "delete",
    academicYear: "2026",
    studentGroupId: id,
  };
  console.log(`DELETE payload ${JSON.stringify(payload)}`);

  try {
    const response = await service.sendGroupDelete(payload);
    console.log(`DELETE → OK ${JSON.stringify(response.data)}`);
  } catch (error) {
    if (error instanceof EsisError) {
      console.log(
        `DELETE → status=${String(error.detail.status ?? "?")} body=${error.detail.bodyExcerpt ?? "(none)"}`,
      );
    } else {
      console.log(`DELETE → ${String(error)}`);
    }
  }
}

void main();
