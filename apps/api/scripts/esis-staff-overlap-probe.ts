/**
 * How do `teacher/list` (api-41) and `school/staff` (API-000154) overlap?
 *
 * ★ **The staff directory's Төрөл column turns on this.** It classifies
 * somebody as a teacher by *identity* — presence in `teacher/list` — rather
 * than by reading "багш" out of a job title, because a title is free text and
 * "Багшийн туслах" contains the word without being one.
 *
 * That is only the right rule if the two services nest the way this project's
 * notes assume: `school/staff` the superset, `teacher/list` a subset of it. If
 * instead there are people `school/staff` calls a багш that `teacher/list` has
 * never heard of, the column would file them under "Бусад ажилтан" beside an
 * Албан тушаал reading "Бүлгийн багш", which is a visible contradiction.
 *
 * ★★ Names are printed for the disagreements only, and only the given name and
 * the post — no register numbers, no person ids, no e-mail. The point is to see
 * *what kind of person* falls in the gap, not who.
 *
 *   ESIS_INSTITUTION_ID=42778 npx tsx -r dotenv/config \
 *     scripts/esis-staff-overlap-probe.ts dotenv_config_path=../../.env
 */
import { loadEnv } from "../src/config/env";
import { EsisClient } from "../src/integrations/esis/esis.client";
import { EsisConfig } from "../src/integrations/esis/esis.config";
import { EsisService } from "../src/integrations/esis/esis.service";

async function main(): Promise<void> {
  const config = new EsisConfig(loadEnv());
  const service = new EsisService(new EsisClient(config), config);

  const institutionId = process.env.ESIS_INSTITUTION_ID;
  if (!institutionId) throw new Error("ESIS_INSTITUTION_ID is required.");

  const teachers = (await service.read("teachers", {}, institutionId)).data as Record<
    string,
    unknown
  >[];
  const staff = (await service.read("staff", {}, institutionId)).data as Record<string, unknown>[];

  const ids = (rows: Record<string, unknown>[]) =>
    new Set(rows.map((row) => String(row.personId ?? "")).filter(Boolean));

  const teacherIds = ids(teachers);
  const staffIds = ids(staff);

  console.log(`teacher/list : ${teachers.length} rows, ${teacherIds.size} distinct people`);
  console.log(`school/staff : ${staff.length} rows, ${staffIds.size} distinct people\n`);

  const onlyTeacher = [...teacherIds].filter((id) => !staffIds.has(id));
  const onlyStaff = [...staffIds].filter((id) => !teacherIds.has(id));

  console.log(`in teacher/list only : ${onlyTeacher.length}`);
  console.log(`in school/staff only : ${onlyStaff.length}\n`);

  /*
   * The question the directory actually asks: of the people only `school/staff`
   * knows, what does it call them? If none of these posts read as a teaching
   * post, classifying by identity is safe.
   */
  const posts = new Map<string, number>();
  for (const row of staff) {
    const personId = String(row.personId ?? "");
    if (!personId || teacherIds.has(personId)) continue;
    const post = String(row.positionName ?? "").trim() || "(хоосон)";
    posts.set(post, (posts.get(post) ?? 0) + 1);
  }

  console.log("posts held by people school/staff lists and teacher/list does not:");
  for (const [post, count] of [...posts].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${count}×  ${post}`);
  }

  /* And the reverse, which would be the surprising direction. */
  if (onlyTeacher.length > 0) {
    console.log("\nposts of people teacher/list knows and school/staff does not:");
    for (const row of teachers) {
      const personId = String(row.personId ?? "");
      if (!personId || staffIds.has(personId)) continue;
      console.log(`  ${String(row.positionName ?? "(хоосон)")}`);
    }
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
