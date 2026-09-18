import { describe, expect, it } from "vitest";
import {
  buildGroupPayload,
  ESIS_WRITE_ENDPOINT,
  ESIS_WRITE_EVENT,
  ESIS_WRITE_SERVICES,
  readGroupRows,
  type EsisGroupRow,
} from "./esis-group-writes";

/*
 * ★ These rows are **captured, not invented** — two of the four api-40 returned
 * for institution 42778 on 2026-09-18, trimmed of the fields a write does not
 * send. Every id below is the ministry's own. A fixture written by hand would
 * have agreed with whatever the builder did, which is exactly how the shape
 * this file replaced went unnoticed.
 */
const AHLAH: EsisGroupRow = {
  studentGroupId: "100006351517832",
  studentGroupName: "ахлах бүлэг",
  academicLevel: "17",
  academicLevelName: "Ахлах",
  programOfStudyId: "100000287145352",
  programStageId: "100000287145361",
  programPlanId: "100000287145358",
  groupTypeCode: "STREAM",
  groupShiftId: "108004001",
  groupClassificationId: "1",
  groupCategoryCode: "MAIN_STUDENT_GROUP",
  academicGroupId: "42778",
  academicYear: "2026",
};

const BAGA: EsisGroupRow = {
  ...AHLAH,
  studentGroupId: "100006351518106",
  studentGroupName: "бага бүлэг",
  academicLevel: "15",
  academicLevelName: "Бага",
  programStageId: "100000287145359",
};

const MINISTRY = [AHLAH, BAGA];

const GROUP = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Дэлб",
  ageBand: "MIDDLE",
  esisGroupId: null as string | null,
};

describe("group write payloads", () => {
  /*
   * ★ `MIDDLE` is Ахлах, which is `academicLevel` 17 with programme stage
   * …361 — copied from the ministry's row, never computed. The mapping this
   * file used to hold (`MIDDLE → 4`) was a guess and was wrong.
   */
  it("copies the programme ids from the ministry's group at the same level", () => {
    expect(
      buildGroupPayload({
        service: "groupCreate",
        group: GROUP,
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toEqual({
      institutionId: 42778,
      event: "create",
      academicYear: "2026",
      studentGroupName: "Дэлб",
      academicLevel: "17",
      programOfStudyId: "100000287145352",
      programStageId: "100000287145361",
      programPlanId: "100000287145358",
      groupTypeCode: "STREAM",
      groupShiftId: "108004001",
      groupClassificationId: "1",
      groupCategoryCode: "MAIN_STUDENT_GROUP",
      academicGroupId: "42778",
    });
  });

  it("takes the other level's stage for the other band", () => {
    const payload = buildGroupPayload({
      service: "groupCreate",
      group: { ...GROUP, ageBand: "NURSERY" },
      institutionId: 42778,
      ministryGroups: MINISTRY,
    });
    expect(payload).toMatchObject({ academicLevel: "15", programStageId: "100000287145359" });
  });

  /*
   * ★ A real and fixable refusal, unlike the old `AGE_BAND_UNMAPPED`: it means
   * "ЭСИС has no group at this level to copy from yet", which a director can
   * answer by creating that level's group first.
   */
  it("refuses a create when ESIS has no group at that level to copy", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupCreate",
        group: { ...GROUP, ageBand: "SENIOR" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toThrow("ESIS_LEVEL_TEMPLATE_MISSING");
  });

  it("refuses a band our own enum does not name", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupCreate",
        group: { ...GROUP, ageBand: "PRIMARY" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toThrow("ESIS_AGE_BAND_UNMAPPED");
  });

  /*
   * ★ An update carries the group's **own** programme, not a sibling's at the
   * same level. Matching on level would quietly move a group onto another
   * programme the day the two disagreed.
   */
  it("builds an update from the group's own ministry row", () => {
    expect(
      buildGroupPayload({
        service: "groupUpdate",
        group: { ...GROUP, esisGroupId: "100006351518106", name: "Навч" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toEqual({
      institutionId: 42778,
      event: "update",
      academicYear: "2026",
      studentGroupId: "100006351518106",
      studentGroupName: "Навч",
      academicLevel: "15",
      programOfStudyId: "100000287145352",
      programStageId: "100000287145359",
      programPlanId: "100000287145358",
      groupTypeCode: "STREAM",
      groupShiftId: "108004001",
      groupClassificationId: "1",
      groupCategoryCode: "MAIN_STUDENT_GROUP",
      academicGroupId: "42778",
    });
  });

  /*
   * ★ A delete names the group and nothing about it. A body that also carried
   * a name would be one field away from being an update, and there is no undo
   * on the other side of this call.
   */
  it("sends a delete that describes nothing", () => {
    expect(
      buildGroupPayload({
        service: "groupDelete",
        group: { ...GROUP, esisGroupId: "100006351517832" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toEqual({
      institutionId: 42778,
      event: "delete",
      academicYear: "2026",
      studentGroupId: "100006351517832",
    });
  });

  it("refuses an update for a group ESIS has never seen", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupUpdate",
        group: GROUP,
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toThrow("ESIS_GROUP_ID_UNKNOWN");
  });

  /*
   * ★ Proved necessary on 2026-09-18: a create answered `200` with a
   * `studentGroupId` and the next api-40 read did not list the new group. If a
   * delete needed a match here, a freshly created group would be impossible to
   * remove through this product — the row most likely to need removing.
   */
  it("deletes a group the ministry's list does not carry, on its id alone", () => {
    expect(
      buildGroupPayload({
        service: "groupDelete",
        group: { ...GROUP, esisGroupId: "100006693991734" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toEqual({
      institutionId: 42778,
      event: "delete",
      academicYear: "2026",
      studentGroupId: "100006693991734",
    });
  });

  it("refuses an update for an id the ministry's list does not carry", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupUpdate",
        group: { ...GROUP, esisGroupId: "999999" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toThrow("ESIS_GROUP_NOT_IN_MINISTRY");
  });

  /*
   * ★★ 162's five fields, from the ministry's own documentation — and
   * `academicYear` is **not** one of them, which is why this payload does not
   * share the base the other three use.
   *
   * ★★★ `event: "CREATE"`. The documentation is explicit: "UPDATE зөвхөн
   * instructorRole өөрчлөх үед хийнэ" — assigning is a create, and swapping
   * teachers is DELETE then CREATE.
   */
  it("assigns a teacher with CREATE and the five fields 162 documents", () => {
    expect(
      buildGroupPayload({
        service: "groupInstructor",
        group: { ...GROUP, esisGroupId: "100006351517832" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
        esisPersonId: "5512",
        teacherRole: "LEAD",
      }),
    ).toEqual({
      event: "CREATE",
      institutionId: 42778,
      studentGroupId: 100006351517832,
      instructorId: 5512,
      instructorRole: "Үндсэн",
    });
  });

  /*
   * ★ `instructorRole` is free text — proved live, with `studentGroupId: 0` so
   * that an accepted value could not attach anybody to a real group. `""` was
   * refused; `LEAD`, `MAIN`, `ҮНДСЭН`, `Үндсэн багш` and `1` all got past it.
   * Given a free field, the value sent is the word this product already shows
   * on its own group screen rather than an English enum name or an invented
   * code.
   */
  it("sends the assistant's role in the words the group screen uses", () => {
    const payload = buildGroupPayload({
      service: "groupInstructor",
      group: { ...GROUP, esisGroupId: "100006351517832" },
      institutionId: 42778,
      ministryGroups: MINISTRY,
      esisPersonId: "5512",
      teacherRole: "ASSISTANT",
    });
    expect(payload).toMatchObject({ instructorRole: "Туслах" });
  });

  it("refuses a teacher role our own enum does not name", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupInstructor",
        group: { ...GROUP, esisGroupId: "100006351517832" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
        esisPersonId: "5512",
        teacherRole: "SUBSTITUTE",
      }),
    ).toThrow("ESIS_INSTRUCTOR_ROLE_UNMAPPED");
  });

  it("refuses an instructor write with no person id first", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupInstructor",
        group: { ...GROUP, esisGroupId: "100006351517832" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toThrow("ESIS_PERSON_ID_UNKNOWN");
  });
});

describe("the ministry's own name rule", () => {
  /*
   * ★ Five characters, learned from 150 on 2026-09-18: "Анги бүлгийн нэрийг 5
   * буюу түүнээс багаар өгнө үү!". The first live create used "ЗЗЗ туршилт" and
   * was refused, which is the best outcome a first create can have — a rule
   * learned and no record made.
   */
  it("refuses a name longer than the ministry accepts, before anything is approved", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupCreate",
        group: { ...GROUP, name: "Дэлбээ" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toThrow("ESIS_GROUP_NAME_TOO_LONG");
  });

  it("accepts a name of exactly five", () => {
    const payload = buildGroupPayload({
      service: "groupCreate",
      group: { ...GROUP, name: "ЗЗЗ01" },
      institutionId: 42778,
      ministryGroups: MINISTRY,
    });
    expect(payload).toMatchObject({ studentGroupName: "ЗЗЗ01" });
  });

  it("applies the same rule to a rename", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupUpdate",
        group: { ...GROUP, esisGroupId: "100006351518106", name: "Хэтэрхий урт" },
        institutionId: 42778,
        ministryGroups: MINISTRY,
      }),
    ).toThrow("ESIS_GROUP_NAME_TOO_LONG");
  });

  /*
   * ★★ A delete carries no name, so the rule must not reach it. The ministry's
   * own groups are all longer than five ("ахлах бүлэг" is eleven) — refusing to
   * remove one because of a limit on the way *in* would be this product
   * inventing a rule the ministry does not have.
   */
  it("lets a delete through whatever the group is called", () => {
    const payload = buildGroupPayload({
      service: "groupDelete",
      group: { ...GROUP, esisGroupId: "100006351517832", name: "ахлах бүлэг" },
      institutionId: 42778,
      ministryGroups: MINISTRY,
    });
    expect(payload).toMatchObject({ event: "delete" });
  });
});

describe("what the services answered", () => {
  /*
   * ★ 152 takes a lower-case event, 162 takes UPPER — proved live on
   * 2026-09-18 and then confirmed by the ministry's documentation, which spells
   * 162's as "(CREATE, UPDATE, DELETE)". Pinning both means normalising the
   * case "for consistency" fails a test instead of failing at the ministry.
   */
  it("keeps 152 lower case and 162 upper case", () => {
    expect(ESIS_WRITE_EVENT.groupCreate).toBe("create");
    expect(ESIS_WRITE_EVENT.groupUpdate).toBe("update");
    expect(ESIS_WRITE_EVENT.groupDelete).toBe("delete");
    expect(ESIS_WRITE_EVENT.groupInstructor).toBe("CREATE");
  });

  /*
   * ★★ **162's assign is CREATE, not UPDATE**, and it is worth its own
   * assertion because the probe pointed the wrong way: upper-case `UPDATE` got
   * further than lower-case, so it looked like the answer. The documentation
   * settled it — "UPDATE зөвхөн instructorRole өөрчлөх үед хийнэ. Багшийг
   * солихдоо өмнөх багшийг устгах үйлдэл хийсний дараа шинэ багшийг оруулна
   * уу!" — so assigning is a create, and a swap is two writes this product does
   * not make.
   */
  it("assigns with CREATE, because a swap is two writes and is not built", () => {
    expect(ESIS_WRITE_EVENT.groupInstructor).toBe("CREATE");
  });

  /*
   * ★ A delete posts to 152, the same endpoint an update does — the probe's
   * finding, and the reason `groupDelete` is a registry key rather than an
   * endpoint.
   */
  it("sends a delete down the same endpoint as an update", () => {
    expect(ESIS_WRITE_ENDPOINT.groupDelete).toBe("groupUpdate");
    expect(ESIS_WRITE_SERVICES).toContain("groupDelete");
  });
});

describe("reading the ministry's rows", () => {
  it("keeps a row carrying every id a write needs", () => {
    expect(readGroupRows([AHLAH])).toEqual([AHLAH]);
  });

  /*
   * ★ A row missing one id is dropped rather than half-used. A payload built
   * from a partial template would be a well-formed request naming the wrong
   * programme.
   */
  it("drops a row with an id missing", () => {
    const { programStageId: _dropped, ...partial } = AHLAH;
    expect(readGroupRows([partial, BAGA])).toEqual([BAGA]);
  });
});
