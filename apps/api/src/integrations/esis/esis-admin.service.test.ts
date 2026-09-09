import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../../authz/actor";
import { EsisAdminService } from "./esis-admin.service";

const actor: Actor = {
  userId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  isSuperAdmin: false,
  memberships: [
    {
      id: "00000000-0000-4000-8000-000000000003",
      kindergartenId: "00000000-0000-4000-8000-000000000004",
      role: "ADMIN" as never,
    },
  ],
};

function setup(overrides: { configured?: boolean; mappedId?: string | null } = {}) {
  const institutionId = "40305";
  const configured = overrides.configured ?? true;
  const esis = {
    isConfigured: configured,
    status: vi.fn(() => ({
      configured,
      baseUrl: configured ? "https://hubv2.esis.edu.mn" : "",
      institutionId: configured ? institutionId : "",
      hasToken: configured,
    })),
    organization: vi.fn(async () => ({
      data: [{ institutionId, institutionName: "Бяцхан нүүдэлчид" }],
      durationMs: 12,
    })),
    academicYearStatuses: vi.fn(async () => ({ data: [], durationMs: 8 })),
  };
  const repo = {
    findKindergarten: vi.fn(async () => ({
      id: actor.memberships[0]!.kindergartenId,
      name: "Бяцхан нүүдэлчид",
      esisInstitutionId: overrides.mappedId === undefined ? institutionId : overrides.mappedId,
      esisEnvironment: "TEST",
      esisMappedAt: new Date("2026-09-07T00:00:00Z"),
    })),
    listRecentRuns: vi.fn(async () => []),
    expireStaleRuns: vi.fn(async () => ({ count: 0 })),
    findRunning: vi.fn(async () => null),
    createRun: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000005",
      status: "RUNNING",
      startedAt: new Date(),
    })),
    finishRun: vi.fn(async () => undefined),
  };
  // `assertMember` since 2026-09-09: a read now asks whether *this* actor may
  // reach *this* service, and an admin's own list is still every one of them.
  const tenants = { assertAdmin: vi.fn(), assertMember: vi.fn() };
  const platform = { assertSuperAdmin: vi.fn() };
  const audit = { append: vi.fn(async () => undefined) };
  const service = new EsisAdminService(
    esis as never,
    repo as never,
    tenants as never,
    platform as never,
    audit as never,
  );
  return { service, esis, repo, tenants, audit };
}

describe("ESIS admin workflow", () => {
  it("reports C1-C2 ready but blocks preview when the tenant is not mapped", async () => {
    const { service } = setup({ mappedId: null });

    const overview = await service.overview(actor, actor.memberships[0]!.kindergartenId);

    expect(overview.canPreview).toBe(false);
    expect(overview.stages.slice(0, 2).map((stage) => stage.status)).toEqual(["READY", "READY"]);
    expect(overview.stages[2]!.status).toBe("WAITING");
    expect(JSON.stringify(overview)).not.toContain("secret");
  });

  it("uses the tenant mapping instead of a deployment-wide institution id", async () => {
    const { service, esis, repo } = setup({ mappedId: "99999" });

    await service.preview(actor, actor.memberships[0]!.kindergartenId, {
      resources: ["organization"],
    });

    expect(esis.organization).toHaveBeenCalledWith("99999");
    expect(repo.createRun).toHaveBeenCalled();
  });

  it("records a read-only preview with counts and every catalog field", async () => {
    const { service, repo, audit } = setup();

    const result = await service.preview(actor, actor.memberships[0]!.kindergartenId, {
      resources: ["organization", "academicYearStatuses"],
    });

    expect(result.dryRun).toBe(true);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.results[0]).toMatchObject({
      resource: "organization",
      count: 1,
    });

    /*
     * ★ A field ESIS did not send is still a column, holding null. Dropping it
     * would make "they stopped sending this" indistinguishable from "it was
     * empty this time", and only one of those is a contract change.
     */
    const row = result.results[0]!.preview[0]!;
    expect(row.institutionName).toBe("Бяцхан нүүдэлчид");
    expect(row.institutionId).toBe("40305");
    expect(row.regionName).toBeNull();
    expect(Object.keys(row)).toHaveLength(16);
    expect(repo.expireStaleRuns).toHaveBeenCalledWith(
      actor.memberships[0]!.kindergartenId,
      expect.any(Date),
    );
    expect(repo.finishRun).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000005",
      expect.objectContaining({ status: "SUCCEEDED", errorCode: null }),
    );
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        objectType: "EsisSyncRun",
        metadata: expect.objectContaining({ dryRun: true }),
      }),
    );
  });
});
