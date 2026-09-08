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
  it("contains only the 17 reviewed services with unique API ids", () => {
    const endpoints = Object.values(ESIS_ENDPOINTS);

    expect(endpoints).toHaveLength(17);
    expect(new Set(endpoints.map((item) => item.apiId)).size).toBe(17);
    expect(endpoints.every((item) => item.path.startsWith("/svc/api/hub/v2/"))).toBe(true);
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
