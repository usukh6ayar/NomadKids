import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  esisCheckParser,
  esisContactsParser,
  esisGroupSchema,
  esisListParser,
  esisTeacherSchema,
} from "./esis.schemas";

/**
 * How the envelope parser reads an ESIS answer that carries no rows.
 *
 * ★ **The bodies below are real.** They were captured from the live hub against
 * institution 42778 on 2026-09-14 and are pasted verbatim. `esis.schemas.ts`
 * makes this argument itself, a few lines above the parser: "no hand-written
 * fixture can catch it, because every fixture is written to match the schema".
 * A body invented to exercise the parser would have been invented in the shape
 * the parser already accepted, which is exactly how `RESULT: ""` went unnoticed
 * until a real token met a child with no allergy record.
 *
 * ★★ This is **not** the fixture layer that was deleted on 2026-09-14. That
 * layer fed the application — `ESIS_DEMO_MODE` synthesised responses so screens
 * could be shown before the token had scope, and its only remaining effect was
 * to hide live failures behind something that looked like data. These are
 * inputs to a unit test of a parsing function. Nothing reads them at runtime.
 *
 * ★★★ **Exception: the absent-body cases below are synthetic.** `null` and
 * `undefined` are not something ESIS sent — they are `EsisClient`'s own
 * rendering of the zero-byte `205` it read from `teacher/movements` on
 * 2026-09-15 (see `esis.client.ts`). There is no envelope to paste verbatim
 * because the point being tested is that none arrived.
 */
describe("esisListParser", () => {
  const row = z.object({ personId: z.union([z.string(), z.number()]) });
  const parse = esisListParser(row);

  it("parses a populated RESULT", () => {
    expect(
      parse({
        SUCCESS_CODE: 200,
        RESPONSE_MESSAGE: "Амжилттай",
        RESULT: [{ personId: 9425579614258 }],
      }),
    ).toEqual([{ personId: 9425579614258 }]);
  });

  /*
   * The three shapes an empty answer arrives in. All three carried 203, and the
   * parser deliberately does not look at the code — see the note on
   * `esisListParser`.
   */
  it("reads an empty-string RESULT as no rows", () => {
    // GET /svc/api/hub/v2/student/allergy/:personId?institutionId=42778
    expect(
      parse({
        SUCCESS_CODE: 203,
        RESPONSE_MESSAGE: "Хүсэлтэд тохирох утга олдсонгүй.",
        RESULT: "",
      }),
    ).toEqual([]);
  });

  it("reads an empty-array RESULT as no rows", () => {
    // GET /svc/api/hub/v2/student/screening/:personId?institutionId=42778
    expect(
      parse({
        SUCCESS_CODE: 203,
        RESPONSE_MESSAGE: "Хүсэлтэд тохирох утга олдсонгүй.",
        RESULT: [],
      }),
    ).toEqual([]);
  });

  it("reads a missing RESULT as no rows", () => {
    // GET /svc/api/hub/v2/group/next/academicYear?institutionId=42778
    expect(
      parse({
        SUCCESS_CODE: 203,
        RESPONSE_MESSAGE: "Хүсэлтэд тохирох утга олдсонгүй",
      }),
    ).toEqual([]);
  });

  it("reads a null RESULT as no rows", () => {
    expect(
      parse({
        SUCCESS_CODE: 203,
        RESPONSE_MESSAGE: "Хүсэлтэд тохирох утга олдсонгүй",
        RESULT: null,
      }),
    ).toEqual([]);
  });

  /*
   * ★ The half that makes the four above safe. Widening "empty" until nothing
   * can fail would turn a changed contract into a silently empty screen, which
   * is the failure this parser exists to report.
   */
  it("still rejects a RESULT that is neither a list nor empty", () => {
    expect(() =>
      parse({ SUCCESS_CODE: 200, RESPONSE_MESSAGE: "Амжилттай", RESULT: { personId: 1 } }),
    ).toThrow();

    expect(() =>
      parse({ SUCCESS_CODE: 200, RESPONSE_MESSAGE: "Амжилттай", RESULT: "true" }),
    ).toThrow();
  });

  it("still rejects a row that does not match the schema", () => {
    expect(() =>
      parse({ SUCCESS_CODE: 200, RESPONSE_MESSAGE: "Амжилттай", RESULT: [{ wrong: 1 }] }),
    ).toThrow();
  });

  it("still rejects a body that is not the ESIS envelope", () => {
    expect(() => parse({ status: -1, message: "Зам олдсонгүй" })).toThrow();
  });

  /*
   * ★ ESIS answered `205` with a zero-length body for `teacher/movements` on
   * 2026-09-15. `EsisClient` turns an empty body into `null`, so the parser
   * receives `null` where it expects an envelope.
   *
   * Read as a contract break this reports "the ministry changed their API" for
   * what is in fact "nobody moved this month" — the same mistake the three
   * empty `RESULT` shapes above already avoid, one level further out.
   */
  it("reads an absent body as no rows", () => {
    expect(parse(null)).toEqual([]);
    expect(parse(undefined)).toEqual([]);
  });

  /*
   * …and the guarantee that makes the line above safe: an empty body is not a
   * licence for any malformed payload to pass as empty.
   */
  it("still rejects a payload that is neither an envelope nor absent", () => {
    expect(() => parse("unexpected")).toThrow();
    expect(() => parse(42)).toThrow();
    expect(() => parse({ SUCCESS_CODE: 200 })).toThrow();
  });
});

/**
 * The two services whose rows are not in `RESULT`.
 *
 * ★ Same provenance as above: every body here was captured from institution
 * 42778 on 2026-09-14. Both of these schemas were written without one, and both
 * were wrong — which is the argument for the tests being shaped this way.
 */
describe("esisCheckParser", () => {
  const parse = esisCheckParser();

  it("reads student/check's bare string and keeps the sentence", () => {
    expect(
      parse({
        SUCCESS_CODE: 200,
        RESPONSE_MESSAGE: "9425579614258 ID дугаартай сурагч байна.",
        RESULT: "true",
      }),
    ).toEqual([{ isRegistered: "true", message: "9425579614258 ID дугаартай сурагч байна." }]);
  });

  it("reads teacher/check's one-element array", () => {
    expect(parse({ SUCCESS_CODE: 200, RESPONSE_MESSAGE: "Амжилттай", RESULT: ["false"] })).toEqual([
      { isRegistered: "false", message: "Амжилттай" },
    ]);
  });

  /*
   * ★ "Declined to answer" is not "no". A 203 here must reach the screen as an
   * absent answer, because rendering it as `false` would tell a director that
   * ESIS does not hold a child it may simply not have been asked about.
   */
  it("reads an empty RESULT as no answer rather than as false", () => {
    expect(
      parse({
        SUCCESS_CODE: 203,
        RESPONSE_MESSAGE: "Хүсэлтэд тохирох утга олдсонгүй.",
        RESULT: "",
      }),
    ).toEqual([]);
  });
});

describe("esisContactsParser", () => {
  const parse = esisContactsParser();

  /** personId 9129027526058 — one of the two children on 42778 that has one. */
  const populated = {
    SUCCESS_CODE: 200,
    RESPONSE_MESSAGE: "Амжилттай",
    RESULT: {
      relInfo: [
        {
          studentContactId: 100004455848490,
          institutionId: 42778,
          personId: 9129027526058,
          relationshipType: "1",
          firstName: "Дорлиг",
          lastName: "Ламзав",
          familyName: "Ямаан ",
          dateOfBirth: "1992-05-18T00:00:00.000Z",
          jobTitle: "оператор",
          legalEmployerName: "Цэцэгс майнинг",
          note: null,
        },
      ],
      relAddress: [],
      relPhone: [
        {
          studentContactPhoneId: 100004455848491,
          institutionId: 42778,
          studentContactId: 100004455848490,
          phoneType: "MOBILE",
          phoneCountryCode: "976",
          phoneNumber: "99941652",
        },
      ],
      relEmail: [],
      relSocial: [],
      relWeb: [],
      contactAddress: [],
      contactPhone: [
        {
          studentPhoneId: 100004455848494,
          institutionId: 42778,
          personId: 9129027526058,
          legislationCode: "976",
          phoneType: "MOBILE",
          phoneCountryCode: "976",
          phoneAreaCode: null,
          phoneNumber: "99941652",
          speedDialNumber: null,
          phoneExtension: null,
          searchPhoneNumber: null,
          phoneValidity: null,
          primaryFlag: "Y",
        },
      ],
      contactEmail: [],
      contactSocial: [],
      contactWeb: [],
      status: 1,
      message: "Амжилттай",
    },
  };

  it("emits one row per entry, tagged with the list it came from", () => {
    const rows = parse(populated);

    expect(rows.map((row) => row.section)).toEqual(["relInfo", "relPhone", "contactPhone"]);
  });

  it("keeps the guardian's details", () => {
    const [guardian] = parse(populated);

    expect(guardian).toMatchObject({
      section: "relInfo",
      firstName: "Дорлиг",
      lastName: "Ламзав",
      relationshipType: "1",
      jobTitle: "оператор",
      legalEmployerName: "Цэцэгс майнинг",
      studentContactId: "100004455848490",
    });
  });

  /*
   * ★ The join key, which is the whole reason the entries are not merged into
   * one guardian row: a second number would have been dropped by the merge, and
   * this is what lets the screen say whose number it is instead.
   */
  it("carries the key that joins a phone to its guardian", () => {
    const rows = parse(populated);
    const guardian = rows.find((row) => row.section === "relInfo");
    const phone = rows.find((row) => row.section === "relPhone");

    expect(phone?.studentContactId).toBe(guardian?.studentContactId);
    expect(phone?.phoneNumber).toBe("99941652");
  });

  /* The child's own number is a different record and must not look like a guardian. */
  it("distinguishes the child's own contact points from a guardian's", () => {
    const own = parse(populated).find((row) => row.section === "contactPhone");

    expect(own?.studentPhoneId).toBe("100004455848494");
    expect(own?.studentContactId).toBeUndefined();
    expect(own?.personId).toBe("9129027526058");
  });

  it("reads a child with no contacts as no rows", () => {
    expect(
      parse({
        SUCCESS_CODE: 200,
        RESPONSE_MESSAGE: "Амжилттай",
        RESULT: {
          relInfo: [],
          relAddress: [],
          relPhone: [],
          relEmail: [],
          relSocial: [],
          relWeb: [],
          contactAddress: [],
          contactPhone: [],
          contactEmail: [],
          contactSocial: [],
          contactWeb: [],
          status: 1,
          message: "Амжилттай",
        },
      }),
    ).toEqual([]);
  });

  it("does not read status and message as entries", () => {
    const rows = parse(populated);

    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.section === "status" || row.section === "message")).toBe(false);
  });
});

/**
 * Ids that ESIS leaves null.
 *
 * ★ This is the failure that key-set comparison cannot see. Checking a schema's
 * field names against a live response finds invented names; it says nothing
 * about whether the *type* accepts what arrives. `identifier.optional()` takes
 * a missing key and refuses an explicit `null`, and `null` is the form ESIS
 * uses — so `group/list` threw on all four of institution 42778's groups while
 * every one of its field names was correct.
 *
 * ★★ The blast radius is the whole list, not the row: `esisListParser` runs the
 * row schema over the entire `RESULT`, so two teachers without a department
 * discarded all ten.
 */
describe("ids ESIS sends as null", () => {
  it("accepts a group with no instructor", () => {
    // GET /group/list — all four groups on 42778 come back this way.
    const rows = esisListParser(esisGroupSchema)({
      SUCCESS_CODE: 200,
      RESPONSE_MESSAGE: "Амжилттай",
      RESULT: [
        {
          institutionId: 42778,
          studentGroupId: 100006351518106,
          studentGroupName: "бага бүлэг",
          academicYear: "2026",
          instructorId: null,
          instructorName: null,
          programOfStudyId: null,
          programStageId: null,
          groupShiftId: null,
          groupClassificationId: null,
          academicGroupId: null,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ studentGroupName: "бага бүлэг", instructorId: null });
  });

  it("keeps the other nine teachers when two have no department", () => {
    const teacher = (personId: number, subjectDepartmentId: number | null) => ({
      institutionId: 42778,
      assignmentId: 100005687066992,
      personId,
      lastName: "Пүрэвсүрэн",
      firstName: "Доржханд",
      instructorId: 100005687073692,
      instructorTypeId: 1,
      subjectDepartmentId,
      subjectDepartmentName: subjectDepartmentId === null ? null : "заах аргын нэгдэл",
    });

    const rows = esisListParser(esisTeacherSchema)({
      SUCCESS_CODE: 200,
      RESPONSE_MESSAGE: "Амжилттай",
      RESULT: [teacher(1, 100000296070122), teacher(2, null), teacher(3, null)],
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.subjectDepartmentId)).toEqual(["100000296070122", null, null]);
  });

  /*
   * ★ The limit of the widening. An id the record cannot exist without stays
   * required, so a payload that lost `personId` is still a contract break
   * rather than a row with a hole in it.
   */
  it("still refuses a row with no personId", () => {
    expect(() =>
      esisListParser(esisTeacherSchema)({
        SUCCESS_CODE: 200,
        RESPONSE_MESSAGE: "Амжилттай",
        RESULT: [{ institutionId: 42778, assignmentId: 1, lastName: "А", firstName: "Б" }],
      }),
    ).toThrow();
  });
});
