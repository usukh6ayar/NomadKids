import { z } from "zod";

/**
 * The closed list of ESIS writes that go through approval.
 *
 * ★ Separate from `ESIS_WRITE_RESOURCES`, which is the allow-list of the
 * immediate `POST …/esis/write` route a **teacher** may call. These three are a
 * director's: they are built from our own `Group` rather than echoed back from
 * a form the teacher just filled in, and what gets approved has to be what gets
 * sent. So they need a different door. `esis.fields.test.ts` asserts the two
 * lists never overlap.
 */
export const ESIS_APPROVAL_WRITES = ["groupCreate", "groupUpdate", "groupInstructor"] as const;

export type EsisApprovalWrite = (typeof ESIS_APPROVAL_WRITES)[number];

/**
 * The registry key a request carries.
 *
 * ★ `groupDelete` is not an endpoint. 152 is one path for two operations —
 * "бүлэг засах, устгах" — and it gets its own key here because what a director
 * approves, what the audit row records and what the queue screen shows must all
 * tell a rename apart from a removal. The endpoint they share is in
 * `ESIS_WRITE_ENDPOINT` below.
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
 * Our `AgeBand` as the ministry's level code.
 *
 * ★ **The numbers are unverified**, in the same sense and for the same reason
 * as the field names below. The authority is ESIS's own `academicLevel`, which
 * the read half (`groupsNextYear`, 14) returns beside `academicLevelName` — and
 * that service answered `203` for institution 42778, so no real pair has been
 * seen. These are the four bands in curriculum order (Бага · Дунд · Ахлах ·
 * Бэлтгэл), which is what the names mean, and they must be confirmed against a
 * live `groupsNextYear` row before any group write is approved.
 *
 * ★★ An explicit map rather than an index into the enum. A band an
 * administrator adds later would silently take a plausible-looking number under
 * any positional scheme and be sent; here it throws `ESIS_AGE_BAND_UNMAPPED`,
 * which a director reads as a refusal rather than discovering in the ministry's
 * register.
 */
const AGE_BAND_NUMBER: Record<string, number> = {
  NURSERY: 1,
  JUNIOR: 2,
  MIDDLE: 3,
  SENIOR: 4,
};

/*
 * ★★ **The field names below are unverified.** The plan's Task 2 — the live
 * probe that reads them out of each service's own `400` — has not been run, so
 * these are the shape the ministry's export implies and not a captured
 * contract. When the probe runs, the schemas here are what change; nothing
 * else does, which is the reason a registry exists. Until then no group write
 * should be approved against the live service.
 */
export const groupCreatePayloadSchema = z
  .object({
    institutionId: z.number().int(),
    groupName: z.string().min(1),
    ageBand: z.number().int(),
  })
  .strict();

export const groupUpdatePayloadSchema = groupCreatePayloadSchema
  .extend({ studentGroupId: z.number().int() })
  .strict();

export const groupInstructorPayloadSchema = z
  .object({
    institutionId: z.number().int(),
    studentGroupId: z.number().int(),
    personId: z.number().int(),
  })
  .strict();

/**
 * Whether the three group writes' contract has been proved against ESIS.
 *
 * ★ `false` until the live probe runs. Two things are still guesses: the field
 * names (the portal documents none of these services, and the ministry's export
 * carries only id, method and URL) and `AGE_BAND_NUMBER`, whose authority is
 * ESIS's own `academicLevel`.
 *
 * ★★ **A constant rather than a comment, because a comment stops no one.**
 * `EsisWriteSender` refuses to post while this is `false`, so a director can
 * prepare, read and approve — every part of the harness works and can be
 * exercised — and the one irreversible step is closed. There is no test
 * environment: a `groupCreate` with a wrong field name is a row in the
 * ministry's production register that 152 then has to remove.
 *
 * ★★★ Flipping this to `true` is the last step of the probe task, in the same
 * commit that replaces the guessed names with the captured ones. It should
 * never be flipped on its own.
 */
export const ESIS_GROUP_WRITE_CONTRACT_PROVEN = false;

export interface GroupForWrite {
  id: string;
  name: string;
  ageBand: string;
  esisGroupId: string | null;
}

/**
 * The payload for one write, built from our own row.
 *
 * ★ Throws named codes rather than returning `null`. Every one of these is a
 * refusal a director has to act on — "ЭСИС энэ бүлгийг хараахан хараагүй" tells
 * them to send the create first, an empty preview tells them nothing — and
 * `esis-write.service.ts` maps each code to its Mongolian sentence.
 */
export function buildGroupPayload(input: {
  service: EsisWriteServiceKey;
  group: GroupForWrite;
  institutionId: number;
  esisPersonId?: string | null;
}): Record<string, unknown> {
  const { service, group, institutionId } = input;
  const ageBand = AGE_BAND_NUMBER[group.ageBand];
  if (ageBand === undefined) throw new Error("ESIS_AGE_BAND_UNMAPPED");

  if (service === "groupCreate") {
    return groupCreatePayloadSchema.parse({
      institutionId,
      groupName: group.name,
      ageBand,
    });
  }

  if (group.esisGroupId === null) throw new Error("ESIS_GROUP_ID_UNKNOWN");
  const studentGroupId = Number(group.esisGroupId);
  if (!Number.isFinite(studentGroupId)) throw new Error("ESIS_GROUP_ID_UNKNOWN");

  if (service === "groupInstructor") {
    if (!input.esisPersonId) throw new Error("ESIS_PERSON_ID_UNKNOWN");
    const personId = Number(input.esisPersonId);
    if (!Number.isFinite(personId)) throw new Error("ESIS_PERSON_ID_UNKNOWN");
    return groupInstructorPayloadSchema.parse({
      institutionId,
      studentGroupId,
      personId,
    });
  }

  /*
   * `groupUpdate` and `groupDelete` post the same body to the same path. What
   * separates them today is the confirmation the director types and the
   * requirement that we created the group ourselves — both enforced in
   * `esis-write.service.ts`. Whatever field the ministry uses to mark a
   * removal is one of the names Task 2's probe has still to bring back; until
   * it does, a delete is prepared and shown but must not be approved live.
   */
  return groupUpdatePayloadSchema.parse({
    institutionId,
    studentGroupId,
    groupName: group.name,
    ageBand,
  });
}
