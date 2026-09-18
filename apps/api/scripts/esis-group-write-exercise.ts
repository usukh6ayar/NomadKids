/**
 * The one deliberate live exercise of the group writes. Spec №3б §7.
 *
 * Creates **one throwaway group**, renames it, and removes it again — 150, then
 * 152 twice — against institution 42778's production register, because there is
 * no test environment and the client's instruction is that the trial runs on
 * real data ("turshiltiinh c gesen buren bodit orchin deer ajillana gesen ug").
 *
 * ★ It drives the **real** payload builder and the real send methods. A script
 * that assembled its own JSON would prove the ministry accepts something, not
 * that this product sends something the ministry accepts.
 *
 * ★★ It does **not** go through prepare → approve. The product gate
 * (`ESIS_GROUP_WRITE_CONTRACT_PROVEN`) is still shut, and shutting it is what
 * kept a wrong payload out of the register this morning. This exercise is how
 * it earns being opened; opening it first would be the wrong order.
 *
 * ★★★ Refuses to run without `--i-mean-it`. Every step below changes the
 * ministry's own records.
 *
 *   ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-group-write-exercise.ts --i-mean-it
 */
import { loadEnv } from "../src/config/env";
import { EsisClient, EsisError } from "../src/integrations/esis/esis.client";
import { EsisConfig } from "../src/integrations/esis/esis.config";
import { EsisService } from "../src/integrations/esis/esis.service";
import { buildGroupPayload, readGroupRows } from "../src/integrations/esis/esis-group-writes";

/*
 * Unmistakably ours, and **five characters or fewer** — 2026-09-18, the
 * ministry: "Анги бүлгийн нэрийг 5 буюу түүнээс багаар өгнө үү!". The first
 * attempt used "ЗЗЗ туршилт" and was refused, which is the best outcome a first
 * live create can have: a rule learned and no record made.
 */
const TEST_GROUP_NAME = "ЗЗЗ01";
const RENAMED = "ЗЗЗ02";

async function main(): Promise<void> {
  if (!process.argv.includes("--i-mean-it")) {
    console.log("Refusing: this writes to the ministry's production register. Pass --i-mean-it.");
    return;
  }

  const config = new EsisConfig(loadEnv());
  if (!config.isConfigured) throw new Error("ESIS_TOKEN is not set");
  const service = new EsisService(new EsisClient(config), config);
  const institutionId = process.env.ESIS_INSTITUTION_ID ?? "42778";

  const before = await groups(service, institutionId);
  console.log(`BEFORE ${before.length} groups`);

  /*
   * ★ The band is `MIDDLE` — Ахлах — because 42778 already has a group at that
   * level to copy the programme ids from. Which level hardly matters; that one
   * exists is the whole requirement, and `ESIS_LEVEL_TEMPLATE_MISSING` is the
   * refusal when it does not.
   */
  const group = {
    id: "00000000-0000-4000-8000-000000000000",
    name: TEST_GROUP_NAME,
    ageBand: "MIDDLE",
    esisGroupId: null as string | null,
  };

  const createPayload = buildGroupPayload({
    service: "groupCreate",
    group,
    institutionId: Number(institutionId),
    ministryGroups: before,
  });
  console.log(`CREATE payload ${JSON.stringify(createPayload)}`);
  const created = await attempt(() => service.sendGroupCreate(createPayload));
  console.log(`CREATE → ${created}`);

  /*
   * The create's answer is an input: an update and a delete both need the
   * ministry's own id, and this is the only moment it is sent to us. If it did
   * not come back, re-read the list and find the group by the name we gave it —
   * the exercise must still be able to clean up after itself.
   */
  const after = await groups(service, institutionId);
  const mine = after.find((row) => row.studentGroupName.trim() === TEST_GROUP_NAME);
  if (!mine) {
    console.log(`AFTER ${after.length} groups — nothing named "${TEST_GROUP_NAME}". Stopping.`);
    return;
  }
  console.log(`CREATED studentGroupId=${mine.studentGroupId}`);

  const withId = { ...group, esisGroupId: mine.studentGroupId, name: RENAMED };
  const updatePayload = buildGroupPayload({
    service: "groupUpdate",
    group: withId,
    institutionId: Number(institutionId),
    ministryGroups: after,
  });
  console.log(`UPDATE payload ${JSON.stringify(updatePayload)}`);
  console.log(`UPDATE → ${await attempt(() => service.sendGroupUpdate(updatePayload))}`);

  const deletePayload = buildGroupPayload({
    service: "groupDelete",
    group: withId,
    institutionId: Number(institutionId),
    ministryGroups: after,
  });
  console.log(`DELETE payload ${JSON.stringify(deletePayload)}`);
  console.log(`DELETE → ${await attempt(() => service.sendGroupUpdate(deletePayload))}`);

  const final = await groups(service, institutionId);
  const leftover = final.find((row) => row.studentGroupName.trim().startsWith("ЗЗЗ"));
  console.log(`FINAL ${final.length} groups`);
  console.log(leftover ? `LEFTOVER ${JSON.stringify(leftover)}` : "CLEAN — nothing of ours left");
}

async function groups(service: EsisService, institutionId: string) {
  const res = await service.read("groups", {}, institutionId);
  return readGroupRows((res.data ?? []) as unknown[]);
}

/** Runs one call and returns a printable outcome, never throwing. */
async function attempt(call: () => Promise<{ data: unknown }>): Promise<string> {
  try {
    const response = await call();
    return `OK ${JSON.stringify(response.data)}`;
  } catch (error) {
    if (error instanceof EsisError) {
      return `status=${String(error.detail.status ?? "?")} body=${error.detail.bodyExcerpt ?? "(none)"}`;
    }
    return String(error);
  }
}

void main();
