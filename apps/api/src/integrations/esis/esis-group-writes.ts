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
  /*
   * ★★★ **`CREATE`, not `UPDATE`** — corrected 2026-09-18 from the ministry's
   * documentation, which is explicit: "UPDATE зөвхөн instructorRole өөрчлөх
   * үед хийнэ. Багшийг солихдоо өмнөх багшийг устгах үйлдэл хийсний дараа
   * шинэ багшийг оруулна уу!"
   *
   * So assigning a teacher is `CREATE`. `UPDATE` changes only the role of a
   * teacher already assigned, and **swapping teachers is DELETE then CREATE** —
   * two writes, not one. This product assigns; the other two operations are
   * named in §3.3 of the spec and deliberately not built, because a swap that
   * half-succeeds leaves a group with no teacher in the ministry's register.
   *
   * The earlier `UPDATE` here came from the probe, which got further with upper
   * case than lower and stopped there. It would have been the wrong verb for
   * the one thing this product wants to do.
   */
  groupInstructor: "CREATE",
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
/**
 * `instructorRole` — "Багшийн хариуцах үүрэг", in the words this product
 * already shows on the group screen.
 *
 * ★ **The field is free text, proved live 2026-09-18.** The documentation marks
 * it required and names it, but lists no vocabulary — and none exists anywhere
 * readable: no reference resource carries it, and all four of 42778's groups
 * read `instructorId: null`. So it was asked of the service directly, with
 * `studentGroupId: 0` so that an accepted value could not attach anybody to a
 * real group. `""` was refused ("Багшийн хариуцах үүрэг оруулна уу."); `LEAD`,
 * `MAIN`, `ҮНДСЭН`, `Үндсэн багш` and `1` all got **past** it to the next check.
 * The service wants a non-empty string and nothing narrower.
 *
 * ★★ Given a free field, the honest value is the one our own screens already
 * use for the same fact — `role === "LEAD" ? "Үндсэн" : "Туслах"` on the group
 * page. Sending `LEAD` would put an English enum name into a ministry record
 * that Mongolian staff read; sending an invented code would put a private
 * vocabulary there.
 */
const INSTRUCTOR_ROLE_LABEL: Record<string, string> = {
  LEAD: "Үндсэн",
  ASSISTANT: "Туслах",
};

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
 * Whether the group writes' contract has been proved against live ESIS.
 *
 * ★ **`true` since 2026-09-18**, and it was earned rather than assumed. On
 * institution 42778, driven by the builder in this file and the send methods in
 * `esis.service.ts` — not by a script assembling its own JSON:
 *
 *   150  `200 Бүлэг амжилттай үүсгэлээ.`  studentGroupId 100006693991734
 *   152  `200 Бүлэг амжилттай идэвхгүй болголоо.`
 *
 * Group count before 4, after 4: nothing was left behind.
 * `ESIS_API_READINESS.md` §1.1.9 carries every request and response.
 *
 * ★★ It stood at `false` for a day and paid for itself. The payload this branch
 * shipped that morning — `{ institutionId, groupName, ageBand }` — was wrong in
 * **structure**: every service is discriminated by an `event`, 152 needs an
 * `academicYear` and a `studentGroupId`, and a create needs eight ministry-side
 * ids this database does not hold. No test could have caught that, and the gate
 * meant no director could approve it.
 *
 * ★★★ **162 is not covered by this flag, and is no longer refused.** This
 * paragraph said it was held shut "one layer down, by
 * `ESIS_INSTRUCTOR_ROLE_UNKNOWN`", and that symbol has not existed in the
 * source since the probe above settled the field: `INSTRUCTOR_ROLE_LABEL`
 * answers it with the same words the group screen already shows, and
 * `buildGroupPayload` throws only `ESIS_INSTRUCTOR_ROLE_UNMAPPED` — for a
 * `TeacherRole` this product does not have a label for, which is neither of
 * the two it does. So `groupInstructor` goes through prepare → approve → send
 * like the other two, and the group screen offers it.
 *
 * The line is corrected rather than deleted because a comment describing a
 * gate that is open is worse than no comment: the next reader either believes
 * it and stops, or checks and stops trusting the file.
 */
export const ESIS_GROUP_WRITE_CONTRACT_PROVEN = true;

/**
 * How long a group's name may be, as far as ESIS is concerned.
 *
 * ★ **Five.** 2026-09-18, from 150 itself: "Анги бүлгийн нэрийг 5 буюу түүнээс
 * багаар өгнө үү!". Nothing documents it and nothing else in this product
 * limits `Group.name`, so a kindergarten's perfectly ordinary "Дэлбээ" — six
 * characters — is refused by the ministry.
 *
 * ★★ Checked here so the director meets it at **prepare**, with a sentence
 * naming the limit, rather than after they have approved a write that was
 * always going to fail. That is the same argument as the roster refusal in
 * §3.1; this one simply has a number.
 *
 * ★★★ Ironically the ministry's own four groups break it — "ахлах бүлэг" is
 * eleven. The rule is enforced on the way in, not on what is already stored.
 */
export const ESIS_GROUP_NAME_MAX = 5;

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

/**
 * 162's body, from the ministry's own documentation — 2026-09-18.
 *
 * ★ **Not built on `basePayloadSchema`**, and that is the correction. 162 takes
 * five fields and `academicYear` is **not** one of them: `event`,
 * `institutionId`, `studentGroupId`, `instructorId`, `instructorRole`. Sharing
 * the base would have sent a sixth field the service never asked for.
 *
 * ★★ `instructorId`, not `personId`. Both are "the teacher's number" in
 * conversation and the wrong name is a `400` at best — this one was written
 * from the pattern the суралцагч services use, where the key really is
 * `personId`.
 *
 * ★★★ Both ids are **numbers** here, unlike 150/152 where `studentGroupId` is
 * a string. The documentation says `number` for each, so that is what it gets.
 */
export const groupInstructorPayloadSchema = z
  .object({
    event: z.string().min(1),
    institutionId: z.number().int(),
    studentGroupId: z.number().int(),
    instructorId: z.number().int(),
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
  /** Our own `TeacherRole`, which names what ESIS calls `instructorRole`. */
  teacherRole?: string | null;
}): Record<string, unknown> {
  const { service, group, institutionId, ministryGroups } = input;
  const event = ESIS_WRITE_EVENT[service];

  if (service === "groupCreate") {
    assertNameFits(group.name);
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

  if (group.esisGroupId === null) throw new Error("ESIS_GROUP_ID_UNKNOWN");

  /*
   * ★ A delete needs **only the id**, so it must not require the ministry's
   * list to carry the group — and on 2026-09-18 it was proved that the list
   * sometimes does not. A create answered `200 Бүлэг амжилттай үүсгэлээ` with a
   * `studentGroupId`, and the very next api-40 read came back with the original
   * four rows and no sign of the new group. Requiring a match here would have
   * made a freshly created group **impossible to remove through this product**
   * — which is precisely the row most likely to need removing.
   *
   * `academicYear` comes from any of the institution's rows: every one of
   * 42778's carries "2026", and a delete's year is the school year the write
   * happens in rather than anything about the group.
   */
  if (service === "groupDelete") {
    const year = ministryGroups[0]?.academicYear;
    if (year === undefined) throw new Error("ESIS_ACADEMIC_YEAR_UNKNOWN");
    return groupDeletePayloadSchema.parse({
      institutionId,
      event,
      academicYear: year,
      studentGroupId: group.esisGroupId,
    });
  }

  /*
   * ★★ An update **does** need the group's own row, and here the strictness is
   * right: it carries the programme, the stage and the classification, and
   * those have to be the ones the group actually has rather than a sibling's at
   * the same level. If the list does not carry it — the case above — the
   * refusal tells the director to sync rather than sending a guess.
   */
  const own = ministryGroups.find((row) => row.studentGroupId === group.esisGroupId);
  if (!own) throw new Error("ESIS_GROUP_NOT_IN_MINISTRY");

  if (service === "groupInstructor") {
    if (!input.esisPersonId) throw new Error("ESIS_PERSON_ID_UNKNOWN");
    const instructorId = Number(input.esisPersonId);
    if (!Number.isFinite(instructorId)) throw new Error("ESIS_PERSON_ID_UNKNOWN");

    const studentGroupId = Number(group.esisGroupId);
    if (!Number.isFinite(studentGroupId)) throw new Error("ESIS_GROUP_ID_UNKNOWN");

    const instructorRole = INSTRUCTOR_ROLE_LABEL[input.teacherRole ?? "LEAD"];
    if (instructorRole === undefined) throw new Error("ESIS_INSTRUCTOR_ROLE_UNMAPPED");

    /*
     * ★ `event: "CREATE"`, which is what assigning is. The documentation is
     * explicit that `UPDATE` changes only the role of a teacher already
     * assigned, and that **swapping teachers is DELETE then CREATE** — two
     * writes. This product assigns; a swap is not built, because one that
     * half-succeeds leaves a group with no teacher at all in the ministry's
     * register, and nothing here could tell which half ran.
     */
    return groupInstructorPayloadSchema.parse({
      event,
      institutionId,
      studentGroupId,
      instructorId,
      instructorRole,
    });
  }

  assertNameFits(group.name);
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
/** The ministry's own name-length rule, met before anything is approved. */
function assertNameFits(name: string): void {
  if ([...name.trim()].length > ESIS_GROUP_NAME_MAX) throw new Error("ESIS_GROUP_NAME_TOO_LONG");
}

function templateForBand(rows: EsisGroupRow[], ageBand: string): EsisGroupRow {
  const levelName = AGE_BAND_LEVEL_NAME[ageBand];
  if (levelName === undefined) throw new Error("ESIS_AGE_BAND_UNMAPPED");
  const match = rows.find((row) => row.academicLevelName.trim() === levelName);
  if (!match) throw new Error("ESIS_LEVEL_TEMPLATE_MISSING");
  return match;
}
