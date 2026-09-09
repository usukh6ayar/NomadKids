import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import type { EsisClient } from "./esis.client";
import { EsisConfig } from "./esis.config";
import { ESIS_ENDPOINTS, esisPath } from "./esis.endpoints";
import { EsisService } from "./esis.service";
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
    ESIS_INSTITUTION_ID: "40305",
    ESIS_TIMEOUT_MS: 15_000,
  } as Env);
  return { service: new EsisService({ request } as unknown as EsisClient, config), request };
}

describe("ESIS v2 endpoint registry", () => {
  it("contains only the selected services, each with a distinct API id", () => {
    const endpoints = Object.values(ESIS_ENDPOINTS);
    const withId = endpoints.filter((item) => item.apiId !== null);

    expect(endpoints).toHaveLength(21);
    expect(new Set(withId.map((item) => item.apiId)).size).toBe(withId.length);
    expect(endpoints.every((item) => item.path.startsWith("/svc/api/hub/v2/"))).toBe(true);
  });

  /*
   * ★ A null id is a service whose portal entry has not been read, not a
   * service without one. It cannot be named in a token scope request, so the
   * list of them is pinned: it shrinks when somebody reads the portal, and any
   * growth is a service that was added without checking the catalog.
   */
  it("names every service still missing its portal id", () => {
    const missing = Object.entries(ESIS_ENDPOINTS)
      .filter(([, item]) => item.apiId === null)
      .map(([key]) => key);

    expect(missing).toEqual(["studentByRegister"]);
  });

  it("pins the official API ids and encodes path parameters", () => {
    expect(ESIS_ENDPOINTS.organization.apiId).toBe(59);
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

    // ★ `demoFixture` names which built-in response answers this call when the
    // deployment is in MOCK mode — added 2026-09-09. It is routing metadata for
    // our own client, never sent upstream, so the path, the method and the body
    // below are still the whole of what ESIS receives, which is what the test's
    // name is about.
    expect(request).toHaveBeenCalledWith({
      path: "/svc/api/hub/v2/group/school/attendance/save/v3",
      method: "POST",
      demoFixture: "saveAttendanceV3",
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
