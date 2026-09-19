import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { esisInstitutionLookupSchema } from "@kinder/contracts";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../../authz/actor";
import { PlatformAccessService } from "../../authz/platform-access.service";
import { EsisInstitutionLookupService } from "./esis-institution-lookup.service";
import type { EsisService } from "./esis.service";
import type { EsisRepository } from "./esis.repository";

/*
 * ★ The real `PlatformAccessService`, not a stub. It has no dependencies of its
 * own, so wiring the real one costs nothing and makes every case below run
 * through the assert the route relies on rather than past it.
 */
const operator: Actor = {
  userId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  isSuperAdmin: true,
  memberships: [],
};

const organizationRow = {
  institutionId: 42778,
  institutionName: "Дэгдээхий үрс цэцэрлэг",
  longName: "Улаанбаатар.Баянзүрх.Дэгдээхий үрс цэцэрлэг",
  institutionAddress: "Улаанбаатар, Баянзүрх, 16-р хороо",
  institutionClassificationName: "Цэцэрлэг",
  propertyTypeName: "Хувийн",
};

/*
 * ★ Shaped after a live `school/staff` row, credentials included. The parse
 * boundary destroys `microsoftEmailPass`/`googleEmailPass` before a real
 * caller sees them (`ESIS_DESTROYED_FIELDS`), and this file mocks `read`
 * precisely so that protection is out of the way: what is under test here is
 * the projection's own whitelist, which is the layer that has to hold if the
 * schema ever stops refusing.
 */
const staffRow = {
  personId: 1000048746697,
  personRegNumber: "уб12345678",
  lastName: "Батсайхан",
  firstName: "Оюунаа",
  positionName: "эрхлэгч",
  jobCode: "1341-11",
  microsoftEmailPass: "hunter2",
  googleEmailPass: "hunter3",
};

function build(
  overrides: { staff?: unknown[]; organization?: unknown[]; configured?: boolean } = {},
) {
  const read = vi.fn(async (key: string) => ({
    data:
      key === "staff"
        ? (overrides.staff ?? [staffRow])
        : (overrides.organization ?? [organizationRow]),
    status: 200,
    durationMs: 9,
  }));
  const esis = {
    isConfigured: overrides.configured ?? true,
    read,
  } as unknown as EsisService;
  const repo = {
    findKindergartenByInstitutionId: vi.fn(async () => null),
  } as unknown as EsisRepository;
  return {
    service: new EsisInstitutionLookupService(esis, repo, new PlatformAccessService()),
    read,
    repo,
  };
}

describe("EsisInstitutionLookupService", () => {
  it("projects the ministry's row onto the contract", async () => {
    const { service } = build();
    const result = await service.lookup(operator, "42778");
    expect(result.name).toBe("Дэгдээхий үрс цэцэрлэг");
    expect(result.address).toBe("Улаанбаатар, Баянзүрх, 16-р хороо");
    expect(result.isKindergarten).toBe(true);
    expect(result.alreadyUsed).toBe(false);
  });

  it("upper-cases the register number, which school/staff sends in lower case", async () => {
    const { service } = build();
    const result = await service.lookup(operator, "42778");
    expect(result.staff[0]!.registerNumber).toBe("УБ12345678");
  });

  it("turns the numeric personId into text", async () => {
    const { service } = build();
    const result = await service.lookup(operator, "42778");
    expect(result.staff[0]!.personId).toBe("1000048746697");
  });

  it("never carries a credential out of the staff payload", async () => {
    const { service } = build();
    const result = await service.lookup(operator, "42778");
    // Asserted on the serialised body: an intermediate object can hold a field
    // a projection drops, and it is the body that reaches an operator.
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("hunter3");
    expect(JSON.stringify(result)).not.toContain("EmailPass");
  });

  it("keeps the эрхлэгч, whose job code maps to no role", async () => {
    const { service } = build();
    const result = await service.lookup(operator, "42778");
    expect(result.staff).toHaveLength(1);
    expect(result.staff[0]!.suggestedRole).toBeNull();
  });

  it("suggests TEACHER for occupation group 2342", async () => {
    const { service } = build({ staff: [{ ...staffRow, jobCode: "2342-01" }] });
    const result = await service.lookup(operator, "42778");
    expect(result.staff[0]!.suggestedRole).toBe("TEACHER");
  });

  it("drops a staff row with no register number, which cannot self-register", async () => {
    const { service } = build({ staff: [{ ...staffRow, personRegNumber: null }] });
    const result = await service.lookup(operator, "42778");
    expect(result.staff).toEqual([]);
  });

  it("answers 404 when the ministry returns no institution", async () => {
    const { service } = build({ organization: [] });
    await expect(service.lookup(operator, "99999")).rejects.toThrow(NotFoundException);
  });

  it("reports an institution already registered", async () => {
    const { service, repo } = build();
    (repo.findKindergartenByInstitutionId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "kg-1",
      name: "Дэгдээхий үрс цэцэрлэг",
    });
    const result = await service.lookup(operator, "42778");
    expect(result.alreadyUsed).toBe(true);
  });

  it("returns a payload the contract accepts", async () => {
    // The whitelist and the schema must not drift apart.
    const { service } = build();
    const result = await service.lookup(operator, "42778");
    expect(esisInstitutionLookupSchema.safeParse(result).success).toBe(true);
  });

  /*
   * ★ The service refuses on its own, with no controller and no `@SuperAdmin()`
   * anywhere near it. `read` is asserted un-called because that is what
   * separates "the assert is the first statement" from "an assert exists
   * somewhere below the ministry call".
   */
  it("refuses a caller who is not a platform operator, before reaching ESIS", async () => {
    const { service, read } = build();
    await expect(service.lookup({ ...operator, isSuperAdmin: false }, "42778")).rejects.toThrow(
      NotFoundException,
    );
    expect(read).not.toHaveBeenCalled();
  });

  /*
   * ★★ The *other* half of "first statement", and the half the assert's
   * placement is actually argued from: an unconfigured deployment answers 503
   * «ESIS холболт тохируулагдаагүй байна.», which tells the reader whether this
   * deployment holds an ESIS token. That is an answer, and a caller who may not
   * ask must not have it — so the 404 has to come first (CLAUDE.md §1.7).
   *
   * The two cases below are the same request differing only in who sends it.
   * Without the second one the first proves nothing: 404 everywhere would pass
   * it too.
   */
  it("refuses before revealing whether the deployment has an ESIS token", async () => {
    const { service } = build({ configured: false });

    await expect(service.lookup({ ...operator, isSuperAdmin: false }, "42778")).rejects.toThrow(
      NotFoundException,
    );
    // …and the operator does reach the 503, so the 404 above is the assert and
    // not the whole method having gone quiet.
    await expect(service.lookup(operator, "42778")).rejects.toThrow(ServiceUnavailableException);
  });
});
