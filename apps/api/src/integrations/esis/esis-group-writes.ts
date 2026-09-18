import { z } from "zod";

/**
 * The closed list of ESIS writes that go through approval.
 *
 * ★ Separate from `ESIS_WRITE_RESOURCES`, which is the allow-list of the
 * immediate `POST …/esis/write` route a **teacher** may call. These three are a
 * director's: they are built from the ministry's own group rows rather than
 * echoed back from a form, and what gets approved has to be what gets sent. So
 * they need a different door. `esis.fields.test.ts` asserts the two lists never
 * overlap.
 */
export const ESIS_APPROVAL_WRITES = ["groupCreate", "groupUpdate", "groupInstructor"] as const;

export type EsisApprovalWrite = (typeof ESIS_APPROVAL_WRITES)[number];

/**
 * The registry key a request carries.
 *
 * ★ `groupDelete` is not an endpoint. 152 is one path for two operations, and
 * the live probe proved it exactly: `event: "update"` and `event: "delete"` are
 * the only two values it accepts — `create`, `save` and `edit` all answer
 * "event утга буруу байна". "Бүлэг засах, устгах" was one path and two events
 * all along. The key exists because what a director approves, what the audit
 * row records and what the queue shows must tell a rename from a removal.
 */
export const ESIS_WRITE_SERVICES = [
  "groupCreate",
  "groupUpdate",
  "groupDelete",
  "groupInstructor",
] as const;

export type EsisWriteServiceKey = (typeof ESIS_WRITE_SERVICES)[number];

/** Which endpoint each service key posts to. */
export const ESIS_WRITE_ENDPOINT: Record<EsisWriteServiceKey, EsisApprovalWrite> = {
  groupCreate: "groupCreate",
  groupUpdate: "groupUpdate",
  groupDelete: "groupUpdate",
  groupInstructor: "groupInstructor",
};

/**
 * The `event` each service sends, in the case that service wants it.
 *
 * ★ **152 takes lower case, 162 takes UPPER**, and that is not a tidy-up
 * waiting to happen — it is what the services answered on 2026-09-18. 162 with
 * `event: "update"` reaches its stored procedure, which replies "Үйлдлийн утга
 * буруу байна. (CREATE, UPDATE, DELETE)"; with `"UPDATE"` it gets past and asks
 * for the next field. One gateway, two layers, two rules.
 *
 * ★★ `groupCreate`'s value is the one thing here the ladder could not settle,
 * because 150 was deliberately never probed: a rejected update changes nothing,
 * a half-right create leaves a group in the ministry's register. It is
 * discovered by the first deliberate create of the throwaway group, where a
 * `400` costs nothing and a success is the row the exercise wanted anyway.
 */
export const ESIS_WRITE_EVENT: Record<EsisWriteServiceKey, string> = {
  groupCreate: "create",
  groupUpdate: "update",
  groupDelete: "delete",
  groupInstructor: "UPDATE",
};

/**
 * Our `AgeBand` as the ministry names the same level.
 *
 * ★ A **name**, not a number, and that is the whole correction of 2026-09-18.
 * This mapped `NURSERY..SENIOR → 1..4` and was wrong: api-40's own rows read
 * Бага 15 · Дунд 16 · Ахлах 17 · Бэлтгэл 18. Replacing the guess with
 * `15..18` would have been the same guess one level down — those numbers belong
 * to this institution's programme, and a kindergarten on another one would get
 * a plausible, wrong code.
 *
 * So the only hard-coded thing is what our own enum already means, in the words
 * `AGE_BAND_LABEL` uses on the child's screen. Every id that follows is copied
 * from the ministry's matching row.
 */
const AGE_BAND_LEVEL_NAME: Record<string, string> = {
  NURSERY: "Бага",
  JUNIOR: "Дунд",
  MIDDLE: "Ахлах",
  SENIOR: "Бэлтгэл",
};

/**
 * One group as api-40 (`groups`) returns it.
 *
 * ★ Every field here is an id **this database does not hold and cannot
 * invent** — the programme, its stage for this level, the plan, the shift, the
 * classification. A create needs all of them. That is why a payload is derived
 * from the ministry's own rows rather than built from our columns, and why
 * `prepare` makes a live read before it can show anyone anything.
 */
export interface EsisGroupRow {
  studentGroupId: string;
  studentGroupName: string;
  academicLevel: string;
  academicLevelName: string;
  programOfStudyId: string;
  programStageId: string;
  programPlanId: string;
  groupTypeCode: string;
  groupShiftId: string;
  groupClassificationId: string;
  groupCategoryCode: string;
  academicGroupId: string;
  academicYear: string;
}

const groupRowSchema = z.object({
  studentGroupId: z.string(),
  studentGroupName: z.string(),
  academicLevel: z.string(),
  academicLevelName: z.string(),
  programOfStudyId: z.string(),
  programStageId: z.string(),
  programPlanId: z.string(),
  groupTypeCode: z.string(),
  groupShiftId: z.string(),
  groupClassificationId: z.string(),
  groupCategoryCode: z.string(),
  academicGroupId: z.string(),
  academicYear: z.string(),
});

/** Keeps only the rows carrying every id a write needs. */
export function readGroupRows(rows: unknown[]): EsisGroupRow[] {
  const kept: EsisGroupRow[] = [];
  for (const row of rows) {
    const parsed = groupRowSchema.safeParse(row);
    if (parsed.success) kept.push(parsed.data);
  }
  return kept;
}

export interface GroupForWrite {
  id: string;
  name: string;
  ageBand: string;
  esisGroupId: string | null;
}

/**
 * Whether the three services' contract has been proved end to end.
 *
 * ★ Still `false` on 2026-09-18, and the probe is why it is worth having. The
 * shape this branch shipped that morning — `{ institutionId, groupName,
 * ageBand }` — was wrong in its **structure**, not merely its names: every one
 * of these services is discriminated by an `event`, 152 needs an
 * `academicYear` and a `studentGroupId`, and a create needs eight ministry-side
 * ids. No test could have caught that, and the gate meant no director could
 * approve it.
 *
 * ★★ What is still missing before this becomes `true`: 150's own `event` value
 * and its required fields, which only the first deliberate create can settle,
 * and the instructor role 162 asks for, which is a question for the ministry.
 */
export const ESIS_GROUP_WRITE_CONTRACT_PROVEN = false;

const basePayloadSchema = z.object({
  institutionId: z.number().int(),
  event: z.string().min(1),
  academicYear: z.string().min(1),
});

/** A create carries the whole group description, copied from a sibling row. */
export const groupCreatePayloadSchema = basePayloadSchema
  .extend({
    studentGroupName: z.string().min(1),
    academicLevel: z.string(),
    programOfStudyId: z.string(),
    programStageId: z.string(),
    programPlanId: z.string(),
    groupTypeCode: z.string(),
    groupShiftId: z.string(),
    groupClassificationId: z.string(),
    groupCategoryCode: z.string(),
    academicGroupId: z.string(),
  })
  .strict();

/** An update is a create plus the id of the row being changed. */
export const groupUpdatePayloadSchema = groupCreatePayloadSchema
  .extend({ studentGroupId: z.string() })
  .strict();

/**
 * A delete names the group and nothing about it.
 *
 * ★ Deliberately narrow. A delete that also carried a name and a level would
 * be a body that could be edited into an update by changing one field, and
 * there is no undo on the other side of this one.
 */
export const groupDeletePayloadSchema = basePayloadSchema
  .extend({ studentGroupId: z.string() })
  .strict();

export const groupInstructorPayloadSchema = basePayloadSchema
  .extend({
    studentGroupId: z.string(),
    personId: z.number().int(),
    instructorRole: z.string().min(1),
  })
  .strict();

/**
 * The payload for one write, derived from the ministry's own rows.
 *
 * ★ Throws named codes rather than returning `null`. Every one is a refusal a
 * director has to act on — "ЭСИС энэ бүлгийг хараахан хараагүй" tells them to
 * send the create first — and `esis-write.service.ts` maps each to its
 * Mongolian sentence.
 */
export function buildGroupPayload(input: {
  service: EsisWriteServiceKey;
  group: GroupForWrite;
  institutionId: number;
  ministryGroups: EsisGroupRow[];
  esisPersonId?: string | null;
}): Record<string, unknown> {
  const { service, group, institutionId, ministryGroups } = input;
  const event = ESIS_WRITE_EVENT[service];

  if (service === "groupCreate") {
    const template = templateForBand(ministryGroups, group.ageBand);
    return groupCreatePayloadSchema.parse({
      institutionId,
      event,
      academicYear: template.academicYear,
      studentGroupName: group.name,
      academicLevel: template.academicLevel,
      programOfStudyId: template.programOfStudyId,
      programStageId: template.programStageId,
      programPlanId: template.programPlanId,
      groupTypeCode: template.groupTypeCode,
      groupShiftId: template.groupShiftId,
      groupClassificationId: template.groupClassificationId,
      groupCategoryCode: template.groupCategoryCode,
      academicGroupId: template.academicGroupId,
    });
  }

  /*
   * ★ For everything else the template is the group's **own** ministry row,
   * found by the id a successful create stored. That is stricter than matching
   * on level: an update must carry the programme the group actually has, not
   * the programme a sibling at the same level happens to have.
   */
  if (group.esisGroupId === null) throw new Error("ESIS_GROUP_ID_UNKNOWN");
  const own = ministryGroups.find((row) => row.studentGroupId === group.esisGroupId);
  if (!own) throw new Error("ESIS_GROUP_NOT_IN_MINISTRY");

  if (service === "groupDelete") {
    return groupDeletePayloadSchema.parse({
      institutionId,
      event,
      academicYear: own.academicYear,
      studentGroupId: own.studentGroupId,
    });
  }

  if (service === "groupInstructor") {
    if (!input.esisPersonId) throw new Error("ESIS_PERSON_ID_UNKNOWN");
    const personId = Number(input.esisPersonId);
    if (!Number.isFinite(personId)) throw new Error("ESIS_PERSON_ID_UNKNOWN");

    /*
     * ★★ **162 cannot be built yet, and this is where that stops.** The
     * service answers "Багшийн хариуцах үүрэг оруулна уу." and no vocabulary
     * for that field exists anywhere: not in the thirteen swept reference
     * resources, and not as an example, because all four of 42778's groups
     * carry `instructorId: null`. Our own `TeacherRole` is `LEAD | ASSISTANT`
     * and there is no reason to believe the ministry shares it.
     *
     * Refusing here is the honest answer. Inventing a value would send a guess
     * into the ministry's register and call it an integration.
     */
    throw new Error("ESIS_INSTRUCTOR_ROLE_UNKNOWN");
  }

  return groupUpdatePayloadSchema.parse({
    institutionId,
    event,
    academicYear: own.academicYear,
    studentGroupId: own.studentGroupId,
    studentGroupName: group.name,
    academicLevel: own.academicLevel,
    programOfStudyId: own.programOfStudyId,
    programStageId: own.programStageId,
    programPlanId: own.programPlanId,
    groupTypeCode: own.groupTypeCode,
    groupShiftId: own.groupShiftId,
    groupClassificationId: own.groupClassificationId,
    groupCategoryCode: own.groupCategoryCode,
    academicGroupId: own.academicGroupId,
  });
}

/**
 * A sibling group at the same level, to copy the programme ids from.
 *
 * ★ Matched on the ministry's own `academicLevelName`, because that is the one
 * thing both sides name the same way. `ESIS_AGE_BAND_UNMAPPED` now means
 * something real and fixable — "this kindergarten has no group at this level in
 * ESIS yet, so there is nothing to copy" — rather than "somebody guessed a
 * number wrong".
 */
function templateForBand(rows: EsisGroupRow[], ageBand: string): EsisGroupRow {
  const levelName = AGE_BAND_LEVEL_NAME[ageBand];
  if (levelName === undefined) throw new Error("ESIS_AGE_BAND_UNMAPPED");
  const match = rows.find((row) => row.academicLevelName.trim() === levelName);
  if (!match) throw new Error("ESIS_LEVEL_TEMPLATE_MISSING");
  return match;
}
