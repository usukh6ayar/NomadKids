/**
 * Does `students/list` (api-8) already carry every child `group/student/list`
 * (api-13) returns for a group?
 *
 * ★ **The question the roster importer turns on.** `EsisRosterImportService`
 * reads api-8 once for the whole institution and places each child by the
 * `studentGroupId` on their own row. api-13 asks the same question per group.
 * If the two agree, api-13 is a *verification* surface and the import needs no
 * second write path; if they disagree, api-13 is authoritative for membership
 * and the importer has to read it.
 *
 * Nothing about the field lists answers this — both resolve to `STUDENT_FIELDS`
 * in `esis.fields.ts`, so coverage has to be measured against the live service.
 *
 * ★★ Person ids only. No names, no register numbers, no birth dates are
 * printed: this compares set membership, and the sets are ids.
 *
 *   ESIS_INSTITUTION_ID=42778 pnpm --filter @kinder/api tsx scripts/esis-group-roster-probe.ts
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

  const groups = (await service.read("groups", {}, institutionId)).data as Record<
    string,
    unknown
  >[];
  const students = (await service.read("students", {}, institutionId)).data as Record<
    string,
    unknown
  >[];

  /** Every child api-8 returned, by the group it placed them in. */
  const byGroup = new Map<string, Set<string>>();
  for (const row of students) {
    const groupId = String(row.studentGroupId ?? "");
    const personId = String(row.personId ?? "");
    if (!personId) continue;
    const set = byGroup.get(groupId) ?? new Set<string>();
    set.add(personId);
    byGroup.set(groupId, set);
  }

  console.log(`api-8 students/list: ${students.length} rows, ${byGroup.size} distinct groups`);
  console.log(`api-40 group/list:   ${groups.length} groups\n`);

  let disagreements = 0;

  for (const group of groups) {
    const studentGroupId = String(group.studentGroupId ?? "");
    if (!studentGroupId) continue;

    const listed = byGroup.get(studentGroupId) ?? new Set<string>();

    const response = await service.read("groupStudents", { studentGroupId }, institutionId);
    const inGroup = new Set(
      (response.data as Record<string, unknown>[])
        .map((row) => String(row.personId ?? ""))
        .filter(Boolean),
    );

    const onlyInGroupList = [...inGroup].filter((id) => !listed.has(id));
    const onlyInStudentList = [...listed].filter((id) => !inGroup.has(id));
    if (onlyInGroupList.length > 0 || onlyInStudentList.length > 0) disagreements += 1;

    console.log(
      [
        `group ${studentGroupId}`,
        `api-13 ${inGroup.size}`,
        `api-8 ${listed.size}`,
        `only-api-13 ${onlyInGroupList.length}`,
        `only-api-8 ${onlyInStudentList.length}`,
      ].join("  ·  "),
    );
  }

  console.log(
    `\n${disagreements === 0 ? "AGREE" : "DISAGREE"} — ${disagreements} of ${groups.length} groups differ`,
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
