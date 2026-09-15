import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import type { EsisClient } from "./esis.client";
import { EsisConfig } from "./esis.config";
import { ESIS_ENDPOINTS, esisPath } from "./esis.endpoints";
import { ESIS_READABLE_KEYS, ESIS_READERS, EsisService } from "./esis.service";
import { esisDiscoveredSchema } from "./esis.schemas";
import type { EsisRequest } from "./esis.types";

function serviceFor(body: unknown) {
  const request = vi.fn(async (options: EsisRequest) => ({
    data: options.parse ? options.parse(body) : body,
    status: 200,
    durationMs: 1,
  }));
  const config = new EsisConfig({
    ESIS_BASE_URL: "https://hubv2.esis.edu.mn",
    ESIS_TOKEN: "test-token-not-a-secret",
    ESIS_TIMEOUT_MS: 15_000,
  } as Env);
  return { service: new EsisService({ request } as unknown as EsisClient, config), request };
}

describe("ESIS v2 endpoint registry", () => {
  it("contains only the selected services, each with a distinct API id", () => {
    const endpoints = Object.values(ESIS_ENDPOINTS);
    const withId = endpoints.filter((item) => item.apiId !== null);

    /*
     * ★ 67 since 2026-09-14, was 40. The twenty-seven added that day are the
     * services the ministry's own granted-service export (`apis-granted.xlsx`)
     * listed as approved and this catalogue was not calling: the health block
     * and its writes, the three immunisation reads, group measurement and its
     * bulk save, the эрт илрүүлэг instrument, the three teacher-registration
     * reads, and the daily attendance roll-up.
     *
     * The export has **84** approved services. The seventeen still unwired are
     * the ones with an open question — a civil id we do not hold, an input
     * that duplicates a wired save, a state register number no column carries,
     * a subsystem on a domain `ESIS_BASE_URL` does not answer, and one row
     * whose URL cell is empty.
     */
    expect(endpoints).toHaveLength(67);
    expect(new Set(withId.map((item) => item.apiId)).size).toBe(withId.length);

    /*
     * ★★ **One service is not under `/hub/v2/`, and it is the one to watch.**
     *
     * This was `every(...startsWith("/svc/api/hub/v2/"))` until `workerInfo`
     * (api 49) arrived at `/svc/api/public/worker/info/:primaryNidNumber`. The
     * prefix is not cosmetic: `/hub/v2/` services take an `institutionId` and
     * are refused for an institution this token does not hold — proven live,
     * `403 Таны компанид энэ institutionId дээр эрх байхгүй`. The `public`
     * service takes no institution at all and answers for any worker in the
     * national database.
     *
     * So this assertion is pinned as a **list** rather than relaxed to a
     * predicate: a second unscoped path should have to be added here
     * deliberately, by someone who has read this note.
     */
    const outsideHub = endpoints.filter((item) => !item.path.startsWith("/svc/api/hub/v2/"));
    expect(outsideHub.map((item) => item.path)).toEqual([
      "/svc/api/public/worker/info/:primaryNidNumber",
    ]);
  });

  /*
   * A null id is a service whose numeric portal id has not been read.
   *
   * ★ **This is `toEqual([])` again**, and the round trip is the point.
   *
   * It was empty until 2026-09-10, when seventeen services arrived without a
   * numeric id and the expectation was widened to name them: the public
   * catalog page prints a number only for the `API-0000nn` services, and the
   * суралцагч section is not publicly rendered at all, so nine slugs and seven
   * client-supplied URLs had no id to carry. The list was written to say which
   * services were waiting on what, and every one of them "resolves when
   * somebody reads it from a signed-in portal session".
   *
   * ★★ That happened on 2026-09-14: the deployment's own request register
   * (`esis.requests.ts`) lists an id beside the portal's own name for all
   * seventeen. So the expectation returns to its original, stricter form — a
   * *new* null fails this test — and `esis.requests.test.ts` carries the half
   * this one cannot see, that each id is one the ministry actually approved.
   */
  it("names every service still missing its portal id", () => {
    const missing = Object.entries(ESIS_ENDPOINTS)
      .filter(([, item]) => item.apiId === null)
      .map(([key]) => key)
      .sort();

    expect(missing).toEqual([]);
  });

  it("pins the official API ids and encodes path parameters", () => {
    expect(ESIS_ENDPOINTS.organization.apiId).toBe(59);
    expect(ESIS_ENDPOINTS.studentByRegister.apiId).toBe(45);
    expect(ESIS_ENDPOINTS.saveAttendanceV3.apiId).toBe(171);
    expect(
      esisPath(ESIS_ENDPOINTS.groupAttendance.path, {
        studentGroupId: "12/34",
        dayDate: "2026-09-07",
      }),
    ).toBe("/svc/api/hub/v2/group/list/attendance/12%2F34/2026-09-07");
  });

  it("refuses an unresolved path parameter", () => {
    expect(() => esisPath(ESIS_ENDPOINTS.groupStudents.path, {})).toThrow(
      "Missing ESIS path parameter studentGroupId",
    );
  });
});

describe("ESIS v2 domain methods", () => {
  it("adds institutionId and removes the upstream envelope", async () => {
    const { service, request } = serviceFor({
      SUCCESS_CODE: 200,
      RESPONSE_MESSAGE: "Амжилттай",
      RESULT: [
        {
          institutionId: 40305,
          institutionName: "53-р сургууль",
          legalName: "Нийслэлийн ерөнхий боловсролын сургууль",
          secretField: "must-not-cross-the-boundary",
        },
      ],
    });

    const response = await service.organization("40305");

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/svc/api/hub/v2/organization/info",
        method: "GET",
        query: { institutionId: "40305" },
      }),
    );
    expect(response.data).toEqual([
      {
        institutionId: "40305",
        institutionName: "53-р сургууль",
        legalName: "Нийслэлийн ерөнхий боловсролын сургууль",
      },
    ]);
    expect(JSON.stringify(response.data)).not.toContain("secretField");
  });

  it("drops register numbers and provider passwords from student rows", async () => {
    const { service } = serviceFor({
      SUCCESS_CODE: 200,
      RESPONSE_MESSAGE: "Амжилттай",
      RESULT: [
        {
          institutionId: 40305,
          personId: 90000000000000,
          lastName: "Баяр",
          firstName: "Ану",
          dateOfBirth: "2021-03-04",
          genderCode: "F",
          personRegNumber: "АА00000000",
          microsoftPassword: "upstream-password",
          googlePassword: "upstream-password",
        },
      ],
    });

    const response = await service.students("40305");

    expect(response.data[0]).toEqual({
      institutionId: "40305",
      personId: "90000000000000",
      lastName: "Баяр",
      firstName: "Ану",
      dateOfBirth: "2021-03-04",
      genderCode: "F",
    });
  });

  /*
   * ★ The portal gave us these field *names* on 2026-09-07; it did not give us
   * their JSON types. `esisListParser` validates the whole `RESULT` array, so a
   * year that arrives as a string would throw away every staff row and the
   * operator would read "хариу гэрээнд тохирохгүй" on the screen meant to prove
   * the fields are ready. Both shapes are accepted and normalised once.
   */
  it("accepts a staff count or flag in either JSON type", async () => {
    const { service } = serviceFor({
      SUCCESS_CODE: 200,
      RESPONSE_MESSAGE: "Амжилттай",
      RESULT: [
        {
          institutionId: 40305,
          assignmentId: 1,
          personId: 2,
          lastName: "Дорж",
          firstName: "Сараа",
          yearsOfService: "12",
          educationSectorYears: 7,
          primaryFlag: true,
          minor: "Багш",
        },
      ],
    });

    const response = await service.staff("40305");

    expect(response.data[0]).toMatchObject({
      yearsOfService: 12,
      educationSectorYears: 7,
      primaryFlag: "true",
      minor: "Багш",
    });
  });

  it("uses the documented v3 attendance payload", async () => {
    const { service, request } = serviceFor({ SUCCESS_CODE: 200 });

    await service.saveAttendance({
      institutionId: 40305,
      studentGroupId: 10001,
      dayDate: "2026-09-07",
      attendanceList: [
        {
          personId: 90001,
          attendReasonCode: "PRESENT",
          tardyMinutes: 0,
          attendReasonList: [],
        },
      ],
    });

    // ★ `demoFixture` was in this payload until 2026-09-14 — routing metadata
    // that told the client which built-in response to serve in MOCK mode. The
    // mock transport is gone, so the object below is now exactly what goes on
    // the wire, which is what this test's name always claimed.
    expect(request).toHaveBeenCalledWith({
      path: "/svc/api/hub/v2/group/school/attendance/save/v3",
      method: "POST",
      body: {
        institutionId: 40305,
        studentGroupId: 10001,
        dayDate: "2026-09-07",
        attendanceList: [
          {
            personId: 90001,
            attendReasonCode: "PRESENT",
            tardyMinutes: 0,
            attendReasonList: [],
          },
        ],
      },
    });
  });
});

/*
 * ★ The boundary, asserted rather than described.
 *
 * A hand-written schema is a promise about field names, and every promise of
 * that kind made without a live response has been wrong at least once
 * (`ESIS_API_READINESS.md` §1.1 — nine of thirty-six). So the list of readers
 * allowed to make one is closed, and it is exactly the readers whose named
 * properties some TypeScript file reads.
 *
 * Adding a reader here without a consumer re-opens the defect. Adding a
 * consumer without adding the reader here breaks the build, which is the
 * intended direction for that mistake to fail in.
 */
describe("the declared-schema boundary", () => {
  const DECLARED = [
    "organization",
    "groups",
    "students",
    "groupStudents",
    "foodDiscountStudents",
    "staff",
    "teachers",
    "groupAttendance",
  ] as const;

  it("hand-writes a schema for exactly the readers a domain consumer reads", () => {
    const handWritten = ESIS_READABLE_KEYS.filter(
      (key) => ESIS_READERS[key].schema !== esisDiscoveredSchema,
    ).sort();

    expect(handWritten).toEqual([...DECLARED].sort());
  });

  it("passes every other reader through unchanged", () => {
    for (const key of ESIS_READABLE_KEYS) {
      if ((DECLARED as readonly string[]).includes(key)) continue;
      expect({ key, passthrough: ESIS_READERS[key].schema === esisDiscoveredSchema }).toEqual({
        key,
        passthrough: true,
      });
    }
  });

  /*
   * ★★ The live regression this replaces. `student/info` types `dateOfBirth` as
   * a string in the portal's documentation and sends a number; the declared
   * schema failed the whole service with `invalid_union` for every child on
   * institution 42778.
   */
  it("keeps a numeric dateOfBirth that a declared schema rejected", () => {
    const parsed = ESIS_READERS.studentInfo.schema.parse({
      personId: 9425579614258,
      dateOfBirth: 1_419_000_000_000,
      firstName: "Болд",
    }) as Record<string, unknown>;

    expect(parsed).toMatchObject({ dateOfBirth: 1_419_000_000_000, firstName: "Болд" });
  });
});
