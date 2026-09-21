import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData } from "./support/db";
import { createScenario, type Scenario } from "./support/fixtures";
import { GroupReportsService } from "../src/group-reports/group-reports.service";

describe("teacher group report", () => {
  let app: INestApplication;
  let scenario: Scenario;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetData();
    scenario = await createScenario("group-report");
  });

  it("returns the teacher's group aggregates", async () => {
    const response = await app.get(GroupReportsService).summary(
      {
        userId: scenario.teacherUser.id,
        sessionId: "test",
        isSuperAdmin: false,
        memberships: [
          {
            id: scenario.teacherMembership.id,
            kindergartenId: scenario.kindergarten.id,
            role: "TEACHER",
          },
        ],
      },
      scenario.group.id,
      new Date("2026-09-01"),
      new Date("2026-09-30"),
    );

    expect(response.group).toEqual({ id: scenario.group.id, name: scenario.group.name });
    expect(response.children).toBe(1);
    expect(response.attendance.recorded).toBe(0);
  });
});
