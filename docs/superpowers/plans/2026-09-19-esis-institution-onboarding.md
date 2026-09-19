# ESIS institution onboarding — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A superadmin registers a kindergarten by entering its ESIS
institution id; the name, address and staff list arrive from the ministry, the
first Захирал/Эрхлэгч is chosen from that list, and the tenant is created
already mapped.

**Architecture:** One new platform-level read (`GET
/v1/platform/esis/institutions/:institutionId`) calls the existing catalogue
entries `organization` and `staff` through `EsisService.read`, and returns a
whitelisted projection. `POST /platform/kindergartens` gains two optional
fields and re-runs that lookup server-side before writing, so the mapping, the
staff roster and the ADMIN membership land in the transaction that creates the
tenant.

**Tech Stack:** NestJS · Prisma · Zod (`@kinder/contracts`) · Vitest +
supertest · Next.js App Router + TanStack Query

**Spec:** `docs/superpowers/specs/2026-09-19-esis-institution-onboarding-design.md`

---

## One line of the spec this plan does not implement

The spec's step 3 says a **registration code** is issued when the kindergarten
is created. It is not, and deliberately: `Kindergarten.staffRegistrationCodeHash`
is issued by the director from their own screen, and that flow shipped in #106.
Minting one at creation would mean the platform operator holds a code that lets
strangers register against a kindergarten whose director has not started work
yet, and it would expire unused.

The created admin still receives their invitation token exactly as today, signs
in, and issues the staff code themselves. Nothing is missing from the flow; the
spec sentence describes a step that already has an owner.

## Rules this plan is bound by

- `PrismaClient` only inside `*.repository.ts` (CLAUDE.md §2.2)
- 404, never 403, for anything an actor may not reach (§1.7)
- Audit rows appended **after** the commit (§3.5)
- Every new endpoint touching a tenant gets HTTP authorization tests (§4.1)
- UI text Mongolian, code and identifiers English

## File structure

| File                                                                     | Responsibility                                                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `packages/contracts/src/domain.ts`                                       | `ROLE_LABEL`, `esisInstitutionLookupSchema`, `createKindergartenSchema`             |
| `apps/api/src/integrations/esis/esis-institution-lookup.service.ts`      | **new** — reads `organization` + `staff` for an institutionId, projects a whitelist |
| `apps/api/src/integrations/esis/esis-institution-lookup.service.test.ts` | **new** — unit tests for the projection and the error mapping                       |
| `apps/api/src/integrations/esis/esis.controller.ts`                      | **new** `PlatformEsisInstitutionController`                                         |
| `apps/api/src/integrations/esis/esis.module.ts`                          | wiring                                                                              |
| `apps/api/src/integrations/esis/esis.config.ts`                          | `environment` getter derived from `baseUrl`                                         |
| `apps/api/src/platform/platform.service.ts`                              | re-verify the id, choose the admin from the roster                                  |
| `apps/api/src/platform/platform.repository.ts`                           | write mapping + roster inside `createWithAdmin`                                     |
| `apps/api/test/platform-esis-institution.test.ts`                        | **new** — HTTP authorization + behaviour                                            |
| `apps/web/app/(app)/platform/page.tsx`                                   | the create dialog's new first step                                                  |
| `apps/web/test/platform-create-kindergarten.test.tsx`                    | **new** — the dialog's behaviour                                                    |

---

### Task 1: The role label

Independent of everything else and shippable alone.

**Files:**

- Modify: `packages/contracts/src/domain.ts:38`
- Test: `apps/web/test/roles.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/roles.test.tsx`:

```tsx
import { ROLE_LABEL } from "@kinder/contracts";

it("calls the administrator захирал/эрхлэгч, the client's own term", () => {
  // "Админ" is a transliteration of a job nobody in a kindergarten holds by
  // that name. ESIS's own occupation code 1341 is эрхлэгч.
  expect(ROLE_LABEL.ADMIN).toBe("Захирал/Эрхлэгч");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter web exec vitest run test/roles.test.tsx -t "захирал"`
Expected: FAIL — `expected 'Админ' to be 'Захирал/Эрхлэгч'`

- [ ] **Step 3: Change the label**

`packages/contracts/src/domain.ts`:

```ts
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Захирал/Эрхлэгч",
  TEACHER: "Багш",
  PARENT: "Эцэг эх",
  COOK: "Тогооч",
  ACCOUNTANT: "Нягтлан",
};
```

- [ ] **Step 4: Rebuild contracts, then run the test**

Run: `pnpm --filter @kinder/contracts build && pnpm --filter web exec vitest run test/roles.test.tsx`
Expected: PASS

A stale `packages/contracts/dist` is why a changed schema appears not to have
changed; rebuild before believing any failure here.

- [ ] **Step 5: Check nothing pinned the old string**

Run: `grep -rn '"Админ"' apps packages --include=*.ts --include=*.tsx | grep -v dist | grep -v .next`
Expected: no matches. If a test pins it, update that test — the map exists so
there is one spelling.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/domain.ts apps/web/test/roles.test.tsx
git commit -m "feat(roles): the administrator is захирал/эрхлэгч, not админ"
```

---

### Task 2: The lookup contract

**Files:**

- Modify: `packages/contracts/src/domain.ts` (beside `esisOverviewSchema`)
- Test: `packages/contracts/src/domain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { esisInstitutionLookupSchema } from "./domain";

describe("esisInstitutionLookupSchema", () => {
  const valid = {
    institutionId: "42778",
    name: "Дэгдээхий үрс цэцэрлэг",
    longName: "Улаанбаатар.Баянзүрх.Дэгдээхий үрс цэцэрлэг",
    address: "Улаанбаатар, Баянзүрх, 16-р хороо",
    classification: "Цэцэрлэг",
    propertyType: "Хувийн",
    isKindergarten: true,
    alreadyUsed: false,
    staff: [
      {
        personId: "1000048746697",
        registerNumber: "УБ12345678",
        lastName: "Батсайхан",
        firstName: "Оюунаа",
        positionName: "эрхлэгч",
        jobCode: "1341-11",
        suggestedRole: null,
      },
    ],
  };

  it("accepts a live-shaped payload", () => {
    expect(esisInstitutionLookupSchema.safeParse(valid).success).toBe(true);
  });

  it("keeps a staff row whose job code maps to no role", () => {
    // 1341 (эрхлэгч) and 5153 (жижүүр) both map to null, and the эрхлэгч is
    // the person this screen exists to pick. `suggestedRole` is advice, not a
    // filter.
    const parsed = esisInstitutionLookupSchema.parse(valid);
    expect(parsed.staff[0]!.suggestedRole).toBeNull();
  });

  it("refuses a numeric personId, because the roster stores text", () => {
    const wrong = { ...valid, staff: [{ ...valid.staff[0], personId: 1000048746697 }] };
    expect(esisInstitutionLookupSchema.safeParse(wrong).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kinder/contracts exec vitest run src/domain.test.ts -t "esisInstitutionLookupSchema"`
Expected: FAIL — `esisInstitutionLookupSchema is not exported`

- [ ] **Step 3: Add the schema**

In `packages/contracts/src/domain.ts`, after `esisOverviewSchema`:

```ts
/**
 * What `GET /platform/esis/institutions/:institutionId` answers.
 *
 * ★ `personId` is a **string** here and arrives from ESIS as a `number`
 * (13 digits; `civilId` is 12 and `assignmentId` 15). `Child.esisPersonId` and
 * the staff roster both store text, and the last time a numeric ESIS id was
 * declared to be a string the roster died on it — so the conversion happens in
 * the parser, once.
 *
 * ★★ The staff row is a **whitelist**, never a passthrough. The live
 * `school/staff` payload carries `microsoftEmailPass` and `googleEmailPass` —
 * real credentials — and naming the seven fields that may leave is a stronger
 * guarantee than removing the two that may not.
 */
export const esisInstitutionStaffSchema = z.object({
  personId: z.string(),
  registerNumber: z.string(),
  lastName: z.string(),
  firstName: z.string(),
  positionName: z.string().nullable(),
  jobCode: z.string().nullable(),
  /** `roleForJobCode(jobCode)` — advice for the operator, not a filter. */
  suggestedRole: roleSchema.nullable(),
});

export const esisInstitutionLookupSchema = z.object({
  institutionId: z.string(),
  name: z.string(),
  longName: z.string(),
  address: z.string().nullable(),
  classification: z.string().nullable(),
  propertyType: z.string().nullable(),
  isKindergarten: z.boolean(),
  /** A kindergarten already holds this id — `esisInstitutionId` is `@unique`. */
  alreadyUsed: z.boolean(),
  staff: z.array(esisInstitutionStaffSchema),
});
export type EsisInstitutionLookup = z.infer<typeof esisInstitutionLookupSchema>;
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kinder/contracts exec vitest run src/domain.test.ts -t "esisInstitutionLookupSchema"`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(esis): the institution lookup's contract, with staff as a whitelist"
```

---

### Task 3: The lookup service

**Files:**

- Create: `apps/api/src/integrations/esis/esis-institution-lookup.service.ts`
- Create: `apps/api/src/integrations/esis/esis-institution-lookup.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { EsisInstitutionLookupService } from "./esis-institution-lookup.service";
import type { EsisService } from "./esis.service";
import type { EsisRepository } from "./esis.repository";

const organizationRow = {
  institutionId: 42778,
  institutionName: "Дэгдээхий үрс цэцэрлэг",
  longName: "Улаанбаатар.Баянзүрх.Дэгдээхий үрс цэцэрлэг",
  institutionAddress: "Улаанбаатар, Баянзүрх, 16-р хороо",
  institutionClassificationName: "Цэцэрлэг",
  propertyTypeName: "Хувийн",
};

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

function build(overrides: { staff?: unknown[]; organization?: unknown[] } = {}) {
  const read = vi.fn(async (key: string) => ({
    data:
      key === "staff"
        ? (overrides.staff ?? [staffRow])
        : (overrides.organization ?? [organizationRow]),
    status: 200,
    durationMs: 9,
  }));
  const esis = { isConfigured: true, read } as unknown as EsisService;
  const repo = {
    findKindergartenByInstitutionId: vi.fn(async () => null),
  } as unknown as EsisRepository;
  return { service: new EsisInstitutionLookupService(esis, repo), read, repo };
}

describe("EsisInstitutionLookupService", () => {
  it("projects the ministry's row onto the contract", async () => {
    const { service } = build();
    const result = await service.lookup("42778");
    expect(result.name).toBe("Дэгдээхий үрс цэцэрлэг");
    expect(result.address).toBe("Улаанбаатар, Баянзүрх, 16-р хороо");
    expect(result.isKindergarten).toBe(true);
    expect(result.alreadyUsed).toBe(false);
  });

  it("upper-cases the register number, which school/staff sends in lower case", async () => {
    const { service } = build();
    const result = await service.lookup("42778");
    expect(result.staff[0]!.registerNumber).toBe("УБ12345678");
  });

  it("turns the numeric personId into text", async () => {
    const { service } = build();
    const result = await service.lookup("42778");
    expect(result.staff[0]!.personId).toBe("1000048746697");
  });

  it("never carries a credential out of the staff payload", async () => {
    const { service } = build();
    const result = await service.lookup("42778");
    // Asserted on the serialised body: an intermediate object can hold a field
    // that a projection drops, and it is the body that reaches an operator.
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("hunter3");
    expect(JSON.stringify(result)).not.toContain("EmailPass");
  });

  it("keeps the эрхлэгч, whose job code maps to no role", async () => {
    const { service } = build();
    const result = await service.lookup("42778");
    expect(result.staff).toHaveLength(1);
    expect(result.staff[0]!.suggestedRole).toBeNull();
  });

  it("suggests TEACHER for occupation group 2342", async () => {
    const { service } = build({ staff: [{ ...staffRow, jobCode: "2342-01" }] });
    const result = await service.lookup("42778");
    expect(result.staff[0]!.suggestedRole).toBe("TEACHER");
  });

  it("drops a staff row with no register number, which cannot self-register", async () => {
    const { service } = build({ staff: [{ ...staffRow, personRegNumber: null }] });
    const result = await service.lookup("42778");
    expect(result.staff).toEqual([]);
  });

  it("reports an institution already registered", async () => {
    const { service, repo } = build();
    (repo.findKindergartenByInstitutionId as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "kg-1",
      name: "Дэгдээхий үрс цэцэрлэг",
    });
    const result = await service.lookup("42778");
    expect(result.alreadyUsed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis-institution-lookup.service.test.ts`
Expected: FAIL — cannot find module `./esis-institution-lookup.service`

- [ ] **Step 3: Write the service**

`apps/api/src/integrations/esis/esis-institution-lookup.service.ts`:

```ts
import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { EsisInstitutionLookup } from "@kinder/contracts";
import { EsisRepository } from "./esis.repository";
import { EsisService } from "./esis.service";
import { normalizeRegisterNumber, roleForJobCode } from "./esis.roster";

/**
 * Everything the create-a-kindergarten screen needs about an institution,
 * before any kindergarten exists to scope the question to.
 *
 * ★ Both reads go through `EsisService.read`, so they inherit the catalogue's
 * path, its response schema, its logging and its error classification. A
 * hand-written `fetch` here would reach the ministry and bypass all four.
 *
 * ★★ The staff projection is a **whitelist**. `school/staff` carries
 * `microsoftEmailPass` and `googleEmailPass`, and naming the six fields that
 * may leave cannot be got wrong the way removing the two that may not can.
 */
@Injectable()
export class EsisInstitutionLookupService {
  constructor(
    private readonly esis: EsisService,
    private readonly repo: EsisRepository,
  ) {}

  async lookup(institutionId: string): Promise<EsisInstitutionLookup> {
    if (!this.esis.isConfigured) {
      throw new ServiceUnavailableException("ESIS холболт тохируулагдаагүй байна.");
    }

    const [organizationResponse, staffResponse] = await Promise.all([
      this.esis.read("organization", {}, institutionId),
      this.esis.read("staff", {}, institutionId),
    ]);

    const row = (organizationResponse.data as Record<string, unknown>[])[0];
    // An institution the ministry does not have answers 200 with no rows.
    if (!row) throw new NotFoundException("Ийм institutionId олдсонгүй.");

    const existing = await this.repo.findKindergartenByInstitutionId(institutionId);
    const classification = (row.institutionClassificationName as string | null) ?? null;

    return {
      institutionId: String(row.institutionId ?? institutionId),
      name: String(row.institutionName ?? ""),
      longName: String(row.longName ?? row.institutionName ?? ""),
      address: (row.institutionAddress as string | null) ?? null,
      classification,
      propertyType: (row.propertyTypeName as string | null) ?? null,
      isKindergarten: classification === "Цэцэрлэг",
      alreadyUsed: existing !== null,
      staff: this.projectStaff(staffResponse.data as Record<string, unknown>[]),
    };
  }

  /**
   * ★ A row with no register number is dropped rather than shown. The register
   * number is how a member of staff proves who they are at self-registration,
   * so a row without one is a person this screen cannot make an account for —
   * the same reason `refreshStaffRosterCore` counts it as `skipped`.
   */
  private projectStaff(rows: Record<string, unknown>[]): EsisInstitutionLookup["staff"] {
    const projected: EsisInstitutionLookup["staff"] = [];
    for (const raw of rows) {
      const registerNumber = normalizeRegisterNumber(raw.personRegNumber as string | null);
      if (!registerNumber) continue;
      const jobCode = (raw.jobCode as string | null | undefined) ?? null;
      projected.push({
        personId: String(raw.personId),
        registerNumber,
        lastName: String(raw.lastName ?? ""),
        firstName: String(raw.firstName ?? ""),
        positionName: (raw.positionName as string | null | undefined) ?? null,
        jobCode,
        suggestedRole: roleForJobCode(jobCode),
      });
    }
    return projected;
  }
}
```

- [ ] **Step 4: Add the repository lookup**

`apps/api/src/integrations/esis/esis.repository.ts`:

```ts
  /**
   * The kindergarten holding this institution id, if any.
   *
   * `Kindergarten.esisInstitutionId` is `@unique`, so this is the check that
   * turns a would-be 500 from the unique index into a sentence an operator can
   * act on.
   */
  findKindergartenByInstitutionId(institutionId: string) {
    return this.prisma.kindergarten.findFirst({
      where: { deletedAt: null, esisInstitutionId: institutionId },
      select: { id: true, name: true },
    });
  }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis-institution-lookup.service.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/esis
git commit -m "feat(esis): an institution lookup that exists before the kindergarten does"
```

---

### Task 4: The route, and who may reach it

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.controller.ts`
- Modify: `apps/api/src/integrations/esis/esis.module.ts`
- Create: `apps/api/test/platform-esis-institution.test.ts`

- [ ] **Step 1: Write the failing authorization tests**

`apps/api/test/platform-esis-institution.test.ts`. Copy the ESIS stub shape
from `apps/api/test/esis-admin.test.ts` — that file mocks `EsisService` as an
object literal whose `read` is a single `vi.fn`, which is the form the service
under test calls.

```ts
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "./support/app";
import { EsisService } from "../src/integrations/esis/esis.service";

const organizationRow = {
  institutionId: 42778,
  institutionName: "Дэгдээхий үрс цэцэрлэг",
  longName: "Улаанбаатар.Баянзүрх.Дэгдээхий үрс цэцэрлэг",
  institutionAddress: "Улаанбаатар, Баянзүрх, 16-р хороо",
  institutionClassificationName: "Цэцэрлэг",
  propertyTypeName: "Хувийн",
};

const staffRow = {
  personId: 1000048746697,
  personRegNumber: "уб12345678",
  lastName: "Батсайхан",
  firstName: "Оюунаа",
  positionName: "эрхлэгч",
  jobCode: "1341-11",
  microsoftEmailPass: "hunter2",
};

const read = vi.fn(async (key: string) => ({
  data: key === "staff" ? [staffRow] : [organizationRow],
  status: 200,
  durationMs: 9,
}));

const esis = { isConfigured: true, read } as unknown as Partial<EsisService>;

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp({ overrides: [{ token: EsisService, useValue: esis }] });
});
afterAll(async () => {
  await app.close();
});

const url = "/v1/platform/esis/institutions/42778";

describe("GET /platform/esis/institutions/:institutionId", () => {
  it("answers a superadmin", async () => {
    const session = await app.loginSuperAdmin();
    const res = await app.authed(request(app.server()).get(url), session);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Дэгдээхий үрс цэцэрлэг");
  });

  it("gives an admin 404, not 403", async () => {
    const session = await app.loginAdmin();
    const res = await app.authed(request(app.server()).get(url), session);
    expect(res.status).toBe(404);
  });

  it("gives a teacher 404", async () => {
    const session = await app.loginTeacher();
    const res = await app.authed(request(app.server()).get(url), session);
    expect(res.status).toBe(404);
  });

  it("gives an accountant 404", async () => {
    const session = await app.loginAccountant();
    const res = await app.authed(request(app.server()).get(url), session);
    expect(res.status).toBe(404);
  });

  it("gives an anonymous caller 401", async () => {
    const res = await request(app.server()).get(url);
    expect(res.status).toBe(401);
  });

  it("never serves a credential from the staff payload", async () => {
    const session = await app.loginSuperAdmin();
    const res = await app.authed(request(app.server()).get(url), session);
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(JSON.stringify(res.body)).not.toContain("EmailPass");
  });
});
```

The helper names (`createTestApp`, `loginSuperAdmin`, `authed`) must match this
repository's existing helpers — read `apps/api/test/esis-admin.test.ts` and copy
its imports and login helpers verbatim rather than inventing names.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @kinder/api exec vitest run test/platform-esis-institution.test.ts`
Expected: FAIL — every case 404, including the superadmin's, because the route
does not exist.

- [ ] **Step 3: Add the controller**

At the foot of `apps/api/src/integrations/esis/esis.controller.ts`:

```ts
/**
 * An institution, before a kindergarten exists to scope the question to.
 *
 * ★ Not under `platform/kindergartens/:id/esis`: at the moment this is asked
 * there is no `:id`. `@SuperAdmin()` throws `NotFoundException`, so everyone
 * else gets 404 and this route cannot become a way of asking which
 * institutions the platform's token can reach.
 */
@Controller("platform/esis/institutions")
@SuperAdmin()
export class PlatformEsisInstitutionController {
  constructor(private readonly service: EsisInstitutionLookupService) {}

  @Get(":institutionId")
  lookup(@Param("institutionId") institutionId: string) {
    return this.service.lookup(institutionId);
  }
}
```

- [ ] **Step 4: Wire the module**

`apps/api/src/integrations/esis/esis.module.ts`:

```ts
  controllers: [
    KindergartenEsisController,
    PlatformEsisController,
    PlatformEsisInstitutionController,
  ],
```

and add `EsisInstitutionLookupService` to `providers`, plus to `exports` — Task
6 injects it from `PlatformModule`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @kinder/api exec vitest run test/platform-esis-institution.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integrations/esis apps/api/test/platform-esis-institution.test.ts
git commit -m "feat(esis): the institution lookup route, 404 for everyone but the operator"
```

---

### Task 5: What the three failures look like

**Files:**

- Modify: `apps/api/src/integrations/esis/esis-institution-lookup.service.ts`
- Modify: `apps/api/test/platform-esis-institution.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/platform-esis-institution.test.ts`:

```ts
import { EsisError } from "../src/integrations/esis/esis.errors";

describe("when the ministry refuses", () => {
  it("answers 409 for an institution the token has no grant on", async () => {
    read.mockRejectedValueOnce(
      new EsisError({
        kind: "http",
        detail: { status: 403, body: "Таны компанид энэ institutionId дээр эрх байхгүй байна." },
      }),
    );
    const session = await app.loginSuperAdmin();
    const res = await app.authed(request(app.server()).get(url), session);
    // 409, not 403. The refusal is a fact about the ministry's grant, not
    // about this actor — and 403 is the status §1.7 keeps out of this product.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SCOPE_DENIED");
  });

  it("answers 404 when the institution does not exist", async () => {
    read.mockResolvedValueOnce({ data: [], status: 200, durationMs: 4 });
    const session = await app.loginSuperAdmin();
    const res = await app.authed(request(app.server()).get(url), session);
    expect(res.status).toBe(404);
  });

  it("answers 502 when ESIS does not answer", async () => {
    read.mockRejectedValueOnce(new EsisError({ kind: "timeout" }));
    const session = await app.loginSuperAdmin();
    const res = await app.authed(request(app.server()).get(url), session);
    expect(res.status).toBe(502);
  });
});
```

Check `EsisError`'s real constructor in
`apps/api/src/integrations/esis/esis.errors.ts` and match it — the shape above
follows the `error.kind === "http" && error.detail.status === 403` reads in
`esis-sync.service.ts:436` and `funding.service.ts:825`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @kinder/api exec vitest run test/platform-esis-institution.test.ts -t "refuses"`
Expected: FAIL — a 500 for the two rejections.

- [ ] **Step 3: Map the errors**

In `EsisInstitutionLookupService`, wrap the two reads:

```ts
let organizationResponse;
let staffResponse;
try {
  [organizationResponse, staffResponse] = await Promise.all([
    this.esis.read("organization", {}, institutionId),
    this.esis.read("staff", {}, institutionId),
  ]);
} catch (error) {
  throw this.translate(error);
}
```

and add:

```ts
  /**
   * ESIS's failures, as statuses this product already means something by.
   *
   * ★ A ministry 403 becomes **409**. It is not this actor being refused —
   * they are a superadmin and authorization has already passed — it is the
   * ministry saying the institution is not attached to this company account.
   * Passing 403 through would give §1.7's one reserved status a second
   * meaning.
   */
  private translate(error: unknown): Error {
    if (error instanceof EsisError) {
      if (error.kind === "http" && error.detail.status === 403) {
        return new ConflictException({
          code: "SCOPE_DENIED",
          message: "Яам энэ институцид эрх олгоогүй байна. Гэрээний дараа яамнаас нэмүүлнэ үү.",
        });
      }
      return new BadGatewayException({
        code: error.kind === "timeout" ? "TIMEOUT" : "NETWORK",
        message: "ESIS хариу өгсөнгүй.",
      });
    }
    return error instanceof Error ? error : new Error(String(error));
  }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kinder/api exec vitest run test/platform-esis-institution.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/integrations/esis apps/api/test/platform-esis-institution.test.ts
git commit -m "feat(esis): a ministry refusal is 409, not the 403 this product reserves"
```

---

### Task 6: The environment, derived rather than chosen

**Files:**

- Modify: `apps/api/src/integrations/esis/esis.config.ts`
- Modify: `apps/api/src/integrations/esis/esis.config.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { EsisConfig } from "./esis.config";

const env = (base: string) => ({ ESIS_BASE_URL: base, ESIS_TOKEN: "t" }) as never;

describe("EsisConfig.environment", () => {
  it("is PRODUCTION for the ministry's own hub", () => {
    expect(new EsisConfig(env("https://hubv2.esis.edu.mn")).environment).toBe("PRODUCTION");
  });

  it("is PRODUCTION when the operator set nothing, because the default is the hub", () => {
    expect(new EsisConfig(env("")).environment).toBe("PRODUCTION");
  });

  it("is TEST for anything else", () => {
    expect(new EsisConfig(env("https://sandbox.example.mn")).environment).toBe("TEST");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.config.test.ts`
Expected: FAIL — `environment` is not a property.

- [ ] **Step 3: Add the getter**

```ts
  /**
   * Which ESIS a mapping made now points at.
   *
   * ★ There is no deployment-level setting for this and there never was: no
   * `ESIS_ENVIRONMENT` variable exists, and `mappingMatchesDeployment` is
   * literally `mapped`. Deriving it from the base URL gives
   * `Kindergarten.esisEnvironment` a meaning, and removes a choice an operator
   * could only get wrong — nothing about a kindergarten decides which ESIS the
   * deployment's single token talks to.
   */
  get environment(): "TEST" | "PRODUCTION" {
    return this.baseUrl === DEFAULT_ESIS_BASE_URL ? "PRODUCTION" : "TEST";
  }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kinder/api exec vitest run src/integrations/esis/esis.config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/integrations/esis
git commit -m "feat(esis): the mapping's environment follows the base URL, not a picker"
```

---

### Task 7: Creating a kindergarten already mapped

**Files:**

- Modify: `packages/contracts/src/domain.ts` (`createKindergartenSchema`)
- Modify: `apps/api/src/platform/platform.service.ts:37-94`
- Modify: `apps/api/src/platform/platform.repository.ts:30`
- Modify: `apps/api/src/platform/platform.module.ts`
- Test: `apps/api/test/platform.test.ts`

- [ ] **Step 1: Extend the contract**

```ts
export const createKindergartenSchema = z.object({
  name: z.string().min(1, "Цэцэрлэгийн нэрийг оруулна уу").max(200),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  /**
   * ★ Optional, deliberately. A deployment with no ESIS presence must still be
   * able to create a kindergarten, and leaving this blank is exactly today's
   * behaviour.
   */
  esisInstitutionId: z.string().trim().min(1).max(64).optional(),
  /** Which staff row becomes the Захирал/Эрхлэгч. Requires the id above. */
  adminEsisPersonId: z.string().trim().min(1).max(64).optional(),
  admin: firstAdminSchema,
});
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/test/platform.test.ts`, using the same ESIS stub shape as
Task 4:

```ts
describe("creating a kindergarten from an institution id", () => {
  it("stores the mapping, the roster and the chosen admin in one go", async () => {
    const session = await app.loginSuperAdmin();
    const res = await app
      .authed(request(app.server()).post("/v1/platform/kindergartens"), session)
      .send({
        name: "Дэгдээхий үрс цэцэрлэг",
        esisInstitutionId: "42778",
        adminEsisPersonId: "1000048746697",
        admin: { username: "erhlegch", lastName: "Батсайхан", firstName: "Оюунаа" },
      });
    expect(res.status).toBe(201);
    expect(res.body.kindergarten.esisInstitutionId).toBe("42778");
    expect(res.body.kindergarten.esisEnvironment).toBe("PRODUCTION");
    expect(res.body.admin.lastName).toBe("Батсайхан");
  });

  it("refuses an id the ministry has no grant on, and writes no kindergarten", async () => {
    read.mockRejectedValueOnce(
      new EsisError({ kind: "http", detail: { status: 403, body: "эрх байхгүй" } }),
    );
    const session = await app.loginSuperAdmin();
    const before = await app.countKindergartens();
    const res = await app
      .authed(request(app.server()).post("/v1/platform/kindergartens"), session)
      .send({
        name: "Батлагдаагүй",
        esisInstitutionId: "40284",
        admin: { username: "nobody", lastName: "А", firstName: "Б" },
      });
    expect(res.status).toBe(409);
    expect(await app.countKindergartens()).toBe(before);
  });

  it("refuses an institution another kindergarten already holds", async () => {
    const session = await app.loginSuperAdmin();
    const body = {
      name: "Хоёр дахь",
      esisInstitutionId: "42778",
      admin: { username: "second", lastName: "А", firstName: "Б" },
    };
    await app.authed(request(app.server()).post("/v1/platform/kindergartens"), session).send({
      ...body,
      admin: { username: "first", lastName: "А", firstName: "Б" },
    });
    const res = await app
      .authed(request(app.server()).post("/v1/platform/kindergartens"), session)
      .send(body);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("аль хэдийн бүртгэлтэй");
  });

  it("still creates a kindergarten with no institution id at all", async () => {
    const session = await app.loginSuperAdmin();
    const res = await app
      .authed(request(app.server()).post("/v1/platform/kindergartens"), session)
      .send({ name: "ESIS-гүй", admin: { username: "plain", lastName: "А", firstName: "Б" } });
    expect(res.status).toBe(201);
    expect(res.body.kindergarten.esisInstitutionId).toBeNull();
  });
});
```

`app.countKindergartens()` may not exist — if not, count through the same
Prisma test client the file already uses for assertions, and do not add a
helper only one test needs.

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @kinder/api exec vitest run test/platform.test.ts -t "institution id"`
Expected: FAIL — the mapping fields come back undefined.

- [ ] **Step 4: Re-verify in the service**

In `PlatformService.create`, before hashing:

```ts
/*
 * ★ The lookup runs again here, server-side.
 *
 * The name and address the client sent are just text — editable, and
 * nothing's authorization depends on them. The institution id is
 * different: it decides a mapping, and `Kindergarten.esisInstitutionId` is
 * what `canAccessChild`'s tenant scope is eventually read against. So it
 * is verified where it is stored, not where it was typed, and a
 * hand-made request cannot save an id the ministry never granted.
 */
let institution: EsisInstitutionLookup | null = null;
if (dto.esisInstitutionId) {
  institution = await this.lookup.lookup(dto.esisInstitutionId);
  if (institution.alreadyUsed) {
    throw new ConflictException(`Энэ институц аль хэдийн бүртгэлтэй: ${institution.name}`);
  }
}

const rosterRow = dto.adminEsisPersonId
  ? (institution?.staff.find((s) => s.personId === dto.adminEsisPersonId) ?? null)
  : null;
if (dto.adminEsisPersonId && !rosterRow) {
  throw new ConflictException("Сонгосон ажилтан ESIS-ийн жагсаалтад алга байна.");
}
```

Pass to the repository:

```ts
created = await this.repo.createWithAdmin({
  kindergarten: dto,
  esis: institution
    ? {
        institutionId: institution.institutionId,
        environment: this.esisConfig.environment,
        staff: institution.staff,
      }
    : null,
  admin: {
    username: dto.admin.username,
    email: dto.admin.email ?? null,
    phone: dto.admin.phone ?? null,
    // The roster's spelling wins when a row was chosen: it is the
    // ministry's, and the roster is what self-registration matches on.
    lastName: rosterRow?.lastName ?? dto.admin.lastName,
    firstName: rosterRow?.firstName ?? dto.admin.firstName,
    esisPersonId: rosterRow?.personId ?? null,
    passwordHash,
    invitationTokenHash: hash,
    invitationExpiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  },
});
```

- [ ] **Step 5: Write the mapping and roster in the same transaction**

`platform.repository.ts`, inside `createWithAdmin`'s `$transaction`:

```ts
const kindergarten = await tx.kindergarten.create({
  data: {
    name: input.kindergarten.name,
    address: input.kindergarten.address ?? null,
    phone: input.kindergarten.phone ?? null,
    email: input.kindergarten.email ?? null,
    description: input.kindergarten.description ?? null,
    esisInstitutionId: input.esis?.institutionId ?? null,
    esisEnvironment: input.esis?.environment ?? null,
    esisMappedAt: input.esis ? new Date() : null,
  },
});

if (input.esis && input.esis.staff.length > 0) {
  // The roster lands with the tenant so a registration code works the
  // moment the kindergarten exists, rather than after a separate refresh.
  await tx.esisStaffRoster.createMany({
    data: input.esis.staff.map((row) => ({
      kindergartenId: kindergarten.id,
      esisPersonId: row.personId,
      registerNumber: row.registerNumber,
      lastName: row.lastName,
      firstName: row.firstName,
      jobCode: row.jobCode,
      positionName: row.positionName,
      isInstructor: row.suggestedRole === "TEACHER",
    })),
  });
}
```

Check the real model name and columns against
`apps/api/prisma/schema.prisma` and `EsisRepository.replaceStaffRoster` before
writing this — the field list must match what that method already inserts.

- [ ] **Step 6: Audit the mapping after the commit**

In `PlatformService.create`, beside the existing two `audit.append` calls:

```ts
if (institution) {
  await this.audit.append({
    action: "UPDATE",
    kindergartenId: created.kindergarten.id,
    actorUserId: actor.userId,
    objectType: "EsisMapping",
    objectId: created.kindergarten.id,
    metadata: {
      mapped: true,
      environment: this.esisConfig.environment,
      fields: ["esisInstitutionId", "esisEnvironment"],
      // ★ No register number, ever. `refreshStaffRosterCore` records a
      // count and not who, and a creation row must not be the exception.
      rosterCount: institution.staff.length,
      adminChosenFromRoster: Boolean(dto.adminEsisPersonId),
    },
  });
}
```

- [ ] **Step 7: Wire the module and the injection**

`PlatformService`'s constructor gains two dependencies:

```ts
    private readonly lookup: EsisInstitutionLookupService,
    private readonly esisConfig: EsisConfig,
```

`apps/api/src/platform/platform.module.ts` imports `EsisModule` so
`EsisInstitutionLookupService` and `EsisConfig` can be injected. If that
introduces a circular import, export the lookup service from a small module of
its own rather than making `EsisModule` depend back on `PlatformModule`.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @kinder/api exec vitest run test/platform.test.ts`
Expected: PASS, including the four new cases.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src apps/api/src/platform apps/api/test/platform.test.ts
git commit -m "feat(platform): a kindergarten is created already mapped to its institution"
```

---

### Task 8: The create dialog

**Files:**

- Modify: `apps/web/app/(app)/platform/page.tsx:181-370` (`CreateKindergartenDialog`)
- Create: `apps/web/test/platform-create-kindergarten.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "./support/render";
import userEvent from "@testing-library/user-event";

describe("creating a kindergarten from an institution id", () => {
  it("fills the name and address from the ministry's answer", async () => {
    // Stub GET /platform/esis/institutions/42778 with the fixture this
    // repository's msw setup uses — see test/support for the existing pattern.
    render(<PlatformPage />);
    await userEvent.click(screen.getByRole("button", { name: "Цэцэрлэг нэмэх" }));
    await userEvent.type(screen.getByLabelText("ESIS institution ID"), "42778");
    await userEvent.click(screen.getByRole("button", { name: "ESIS-ээс татах" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Цэцэрлэгийн нэр")).toHaveValue("Дэгдээхий үрс цэцэрлэг"),
    );
    expect(screen.getByText(/Цэцэрлэг · Хувийн/)).toBeInTheDocument();
  });

  it("offers the эрхлэгч as a choice even though the job code maps to no role", async () => {
    render(<PlatformPage />);
    await userEvent.click(screen.getByRole("button", { name: "Цэцэрлэг нэмэх" }));
    await userEvent.type(screen.getByLabelText("ESIS institution ID"), "42778");
    await userEvent.click(screen.getByRole("button", { name: "ESIS-ээс татах" }));

    await waitFor(() => expect(screen.getByText("Батсайхан Оюунаа")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /Батсайхан Оюунаа/ })).toBeEnabled();
  });

  it("says what to do when the ministry has not granted the institution", async () => {
    // Stub the route with 409 { code: "SCOPE_DENIED" }.
    render(<PlatformPage />);
    await userEvent.click(screen.getByRole("button", { name: "Цэцэрлэг нэмэх" }));
    await userEvent.type(screen.getByLabelText("ESIS institution ID"), "40284");
    await userEvent.click(screen.getByRole("button", { name: "ESIS-ээс татах" }));

    await waitFor(() =>
      expect(screen.getByText(/Яам энэ институцид эрх олгоогүй байна/)).toBeInTheDocument(),
    );
  });

  it("still allows creating with the id left blank", async () => {
    render(<PlatformPage />);
    await userEvent.click(screen.getByRole("button", { name: "Цэцэрлэг нэмэх" }));
    await userEvent.type(screen.getByLabelText("Цэцэрлэгийн нэр"), "ESIS-гүй");
    expect(screen.getByRole("button", { name: "Үүсгэх" })).toBeEnabled();
  });
});
```

Radix `Select` triggers report no value — if the staff picker ends up a
`Select` rather than radios, assert `toHaveTextContent`, never `toHaveValue`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter web exec vitest run test/platform-create-kindergarten.test.tsx`
Expected: FAIL — no "ESIS institution ID" field.

- [ ] **Step 3: Add the lookup step to the dialog**

In `CreateKindergartenDialog`, above the name field:

```tsx
const [institutionId, setInstitutionId] = useState("");
const [institution, setInstitution] = useState<EsisInstitutionLookup | null>(null);
const [adminPersonId, setAdminPersonId] = useState<string | null>(null);

const lookup = useMutation({
  mutationFn: () =>
    get(`/platform/esis/institutions/${institutionId.trim()}`, esisInstitutionLookupSchema),
  onSuccess: (result) => {
    setInstitution(result);
    setName(result.name);
    setAddress(result.address ?? "");
    const suggested = result.staff.find((s) => s.jobCode?.startsWith("1341"));
    setAdminPersonId(suggested?.personId ?? null);
  },
  onError: (error) => toast.error(errorMessage(error)),
});
```

and render the field, the button, the confirmation line and the staff radio
group. Every field keeps its `<label>`; the confirmation line reads
`{institution.name} · {institution.classification} · {institution.propertyType}`.

Disable the create button while `lookup.isPending`. Show the four failure
messages from the spec's table, keyed on the response's `code`.

- [ ] **Step 4: Send the two new fields**

```tsx
      body: {
        name,
        address: address || null,
        phone: phone || null,
        email: email || null,
        ...(institution ? { esisInstitutionId: institution.institutionId } : {}),
        ...(adminPersonId ? { adminEsisPersonId: adminPersonId } : {}),
        admin: { username, lastName, firstName, email: adminEmail || null },
      },
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter web exec vitest run test/platform-create-kindergarten.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/platform/page.tsx" apps/web/test/platform-create-kindergarten.test.tsx
git commit -m "feat(platform): the create dialog starts with the institution id"
```

---

### Task 9: The whole suite, and the live check

- [ ] **Step 1: Run the api suite**

Run: `pnpm --filter api test 2>&1 | tee /tmp/api.log`
Expected: green. It takes about 21 minutes — run it in the background and read
the file rather than watching it.

- [ ] **Step 2: Run the web suite, after the api suite has finished**

Run: `pnpm --filter web test --reporter=verbose 2>&1 | tee /tmp/web.log`

**Never run the two suites at the same time.** Concurrently they starve
Postgres and produce `beforeEach` hook timeouts that impersonate a
cross-kindergarten leak — CLAUDE.md §4.4.

- [ ] **Step 3: Typecheck, lint and format**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
```

`format:check` is the step that failed CI on the last two branches. Run
`pnpm format` if it complains.

- [ ] **Step 4: Check the live institution by hand**

With `ESIS_TOKEN` set locally, open the create dialog and enter `42778`.

Expected: the confirmation line reads «Дэгдээхий үрс цэцэрлэг · Цэцэрлэг ·
Хувийн», the staff list shows 13 people, and creation stops with «Энэ институц
аль хэдийн бүртгэлтэй».

**That is the whole live check available today.** The ministry has granted one
institution and it is already registered, so the success path ends at the
duplicate guard. The first thing to re-run when a second grant arrives is
creating a kindergarten from it end to end.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin esis/institution-onboarding
gh pr create --base main --title "ESIS: register a kindergarten by its institution id"
```
