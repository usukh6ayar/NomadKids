# Superadmin Kindergarten Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the seeded platform operator register a kindergarten together with its first director, and list, read and update kindergartens across the whole platform — without widening anyone's access to child data.

**Architecture:** A boolean `isSuperAdmin` on `User` (not a `Membership` role, which would force `Membership.kindergartenId` nullable and put a null case into every tenant filter). The flag is re-read into `Actor` on each request. A new `platform` feature module owns the endpoints; `TenantsService`, `TenantAccessService` and `ChildAccessService` are not modified, so the flag cannot leak into child data.

**Tech Stack:** NestJS 11, Prisma 7 (Postgres), Zod 4, Vitest + supertest against a real database.

**Spec:** `docs/superpowers/specs/2026-08-21-superadmin-kindergarten-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/api/prisma/schema.prisma` (modify) | `User.isSuperAdmin` column |
| `apps/api/prisma/migrations/<ts>_add_user_is_super_admin/migration.sql` (generated) | additive `ALTER TABLE` |
| `apps/api/prisma/seed.ts` (modify) | set the flag on the seeded operator |
| `apps/api/test/support/fixtures.ts` (modify) | `createUser({ isSuperAdmin })` |
| `apps/api/src/authz/actor.ts` (modify) | `Actor.isSuperAdmin` |
| `apps/api/src/auth/auth.repository.ts` (modify) | select the column in `findById` |
| `apps/api/src/auth/auth.service.ts` (modify) | populate it in `resolveActor` |
| `apps/api/src/authz/platform-access.service.ts` (create) | the only place that decides platform reach |
| `apps/api/src/authz/authz.module.ts` (modify) | provide/export it |
| `apps/api/src/auth/decorators/super-admin.decorator.ts` (create) | `@SuperAdmin()` metadata |
| `apps/api/src/auth/guards/super-admin.guard.ts` (create) | coarse gate, 404 |
| `apps/api/src/auth/auth.module.ts` (modify) | register the guard globally |
| `apps/api/src/platform/platform.dto.ts` (create) | request validation |
| `apps/api/src/platform/platform.repository.ts` (create) | the only Prisma access; the create transaction |
| `apps/api/src/platform/platform.service.ts` (create) | authorize, collision checks, audit |
| `apps/api/src/platform/platform.controller.ts` (create) | parse, delegate |
| `apps/api/src/platform/platform.module.ts` (create) | wiring |
| `apps/api/src/app.module.ts` (modify) | register the module |
| `apps/api/test/platform.test.ts` (create) | HTTP authorization + behaviour suite |
| `apps/api/test/schema.test.ts` (modify) | column default |
| `apps/api/src/authz/child-access.test.ts` (modify) | Actor literals gain the field |
| `apps/api/test/authz-consistency.test.ts` (modify) | same |
| `docs/API.md` (modify) | the four new routes |

**Before you start:** the integration tests need Postgres running. `docker compose up -d db` from the repo root, and `DATABASE_URL` set as `apps/api/.env` already does for the other suites.

---

### Task 1: The `isSuperAdmin` column

**Files:**

- Modify: `apps/api/prisma/schema.prisma` (the `User` model, around line 167)
- Modify: `apps/api/test/schema.test.ts`
- Generated: `apps/api/prisma/migrations/<timestamp>_add_user_is_super_admin/migration.sql`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/schema.test.ts`, inside the top-level scope (it already has `beforeEach(resetData)` — check the existing structure and add this `describe` alongside the others):

```ts
describe("platform operator flag", () => {
  it("defaults to false", async () => {
    const user = await db.user.create({
      data: {
        username: uniq("plain"),
        passwordHash: "x",
        lastName: "Овог",
        firstName: "Нэр",
      },
    });

    expect(user.isSuperAdmin).toBe(false);
  });

  it("can be set", async () => {
    const user = await db.user.create({
      data: {
        username: uniq("super"),
        passwordHash: "x",
        lastName: "Систем",
        firstName: "Админ",
        isSuperAdmin: true,
      },
    });

    expect(user.isSuperAdmin).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @kinder/api test schema.test.ts
```

Expected: a TypeScript/Prisma error — `isSuperAdmin` does not exist on the `User` create input.

- [ ] **Step 3: Add the column**

In `apps/api/prisma/schema.prisma`, inside `model User`, immediately after the `isActive` / `lastLoginAt` pair:

```prisma
  /// Platform-level operator: registers kindergartens.
  ///
  /// ★ Deliberately NOT a Membership role. Every authorization primitive in
  /// this system is tenant-derived, and a system-wide membership row has no
  /// kindergarten to point at — the reference implementation made
  /// `kindergarten` nullable to model it, which would put a null case into
  /// every `kindergartenId: { in: [...] }` filter we have. CLAUDE.md §3.1.
  ///
  /// Grants platform routes and nothing else. It is not consulted by
  /// TenantAccessService or ChildAccessService, and test/platform.test.ts
  /// asserts that a superadmin still gets 404 on child data.
  isSuperAdmin Boolean @default(false)
```

- [ ] **Step 4: Generate the migration**

```bash
pnpm --filter @kinder/api prisma:migrate --name add_user_is_super_admin
```

- [ ] **Step 5: Read the generated SQL by hand (CLAUDE.md §3.3)**

```bash
cat apps/api/prisma/migrations/*_add_user_is_super_admin/migration.sql
```

Expected — exactly one statement, additive:

```sql
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
```

If anything else appears — especially a `DROP`, or a change to another table — stop and report it. Drift from an earlier hand-edited migration is the likely cause and it must not be swept into this one.

- [ ] **Step 6: Run the test again**

```bash
pnpm --filter @kinder/api test schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/schema.test.ts
git commit -m "feat(db): add User.isSuperAdmin"
```

---

### Task 2: Seed and fixtures set the flag

**Files:**

- Modify: `apps/api/prisma/seed.ts:42-56`
- Modify: `apps/api/test/support/fixtures.ts` (`createUser`, `UserInput`)

- [ ] **Step 1: Teach the fixture builder about the flag**

In `apps/api/test/support/fixtures.ts`, add the field to the `UserInput` interface near the bottom of the file:

```ts
interface UserInput {
  username: string;
  email: string | null;
  phone: string | null;
  lastName: string;
  firstName: string;
  isActive: boolean;
  isSuperAdmin: boolean;
}
```

and to the `data` object in `createUser`:

```ts
      isActive: overrides.isActive ?? true,
      isSuperAdmin: overrides.isSuperAdmin ?? false,
```

- [ ] **Step 2: Repair the flag in the seed**

Replace the `existing` branch in `seedSuperadmin()` (`apps/api/prisma/seed.ts`) with:

```ts
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    // A database seeded before the column existed has the account but not the
    // flag. Repairing it here keeps `seed` the one command that produces a
    // working system, rather than a command plus a remembered SQL statement.
    if (!existing.isSuperAdmin) {
      await prisma.user.update({ where: { id: existing.id }, data: { isSuperAdmin: true } });
      console.log(`  superadmin: flag repaired (${username})`);
    } else {
      console.log(`  superadmin: exists (${username})`);
    }
    return;
  }
```

and add the flag to the `prisma.user.create` call below it:

```ts
      lastName: "Систем",
      firstName: "Админ",
      isSuperAdmin: true,
```

- [ ] **Step 3: Prove the seed is still idempotent and now sets the flag**

```bash
SEED_ADMIN_PASSWORD=SeedPassword123 pnpm --filter @kinder/api seed
SEED_ADMIN_PASSWORD=SeedPassword123 pnpm --filter @kinder/api seed
```

Expected: the first run prints `superadmin: created (superadmin)` or `flag repaired`, the second prints `superadmin: exists (superadmin)`. No errors either time.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed.ts apps/api/test/support/fixtures.ts
git commit -m "feat(db): seed the platform operator flag"
```

---

### Task 3: `Actor.isSuperAdmin`

**Files:**

- Modify: `apps/api/src/authz/actor.ts:12-16`
- Modify: `apps/api/src/auth/auth.repository.ts:46-58`
- Modify: `apps/api/src/auth/auth.service.ts:203-212`
- Modify: `apps/api/src/authz/child-access.test.ts:27-52`
- Modify: `apps/api/test/authz-consistency.test.ts:91-97`

- [ ] **Step 1: Add the field to the interface**

In `apps/api/src/authz/actor.ts`:

```ts
export interface Actor {
  readonly userId: string;
  readonly sessionId: string;
  /**
   * Platform operator. Read from `User` on every request like everything else
   * here — never from the token, so clearing it takes effect immediately.
   * CLAUDE.md §1.3.
   */
  readonly isSuperAdmin: boolean;
  readonly memberships: readonly ActorMembership[];
}
```

Required rather than optional on purpose: the compiler now names every place an
`Actor` is constructed, and an optional field is one a future call site forgets.

- [ ] **Step 2: Run typecheck and watch it fail**

```bash
pnpm --filter @kinder/api typecheck
```

Expected: errors in `auth.service.ts:211`, `child-access.test.ts` (five literals) and `authz-consistency.test.ts:92`, each "Property 'isSuperAdmin' is missing".

- [ ] **Step 3: Select the column**

In `apps/api/src/auth/auth.repository.ts`, add to the `select` in `findById`:

```ts
        lastLoginAt: true,
        isSuperAdmin: true,
```

- [ ] **Step 4: Populate the Actor**

In `apps/api/src/auth/auth.service.ts`, the return of `resolveActor`:

```ts
    return {
      userId,
      sessionId,
      isSuperAdmin: user.isSuperAdmin,
      memberships: await this.authz.loadMemberships(userId),
    };
```

- [ ] **Step 5: Fix the test literals**

In `apps/api/src/authz/child-access.test.ts`, the helper at line 27 and the three role builders below it:

```ts
function actor(overrides: Partial<Actor> & { memberships: Actor["memberships"] }): Actor {
  return { userId: "user-1", sessionId: "session-1", isSuperAdmin: false, ...overrides };
}

function teacher(kindergartenId = KG_A, userId = "teacher-1"): Actor {
  return {
    userId,
    sessionId: "s",
    isSuperAdmin: false,
    memberships: [{ id: "m-teacher", kindergartenId, role: Role.TEACHER }],
  };
}

function parent(userId = "parent-1", kindergartenId = KG_A): Actor {
  return {
    userId,
    sessionId: "s",
    isSuperAdmin: false,
    memberships: [{ id: "m-parent", kindergartenId, role: Role.PARENT }],
  };
}

function admin(kindergartenId = KG_A, userId = "admin-1"): Actor {
  return {
    userId,
    sessionId: "s",
    isSuperAdmin: false,
    memberships: [{ id: "m-admin", kindergartenId, role: Role.ADMIN }],
  };
}
```

There is a fifth literal further down the same file (around line 242) inside a
test body — add `isSuperAdmin: false,` to it too; the typecheck in step 6 will
point at it if you miss it.

In `apps/api/test/authz-consistency.test.ts`:

```ts
async function actorFor(userId: string): Promise<Actor> {
  return {
    userId,
    sessionId: "test-session",
    isSuperAdmin: false,
    memberships: await authz.loadMemberships(userId),
  };
}
```

- [ ] **Step 6: Typecheck and run the affected suites**

```bash
pnpm --filter @kinder/api typecheck
pnpm --filter @kinder/api test child-access authz-consistency auth.test.ts
```

Expected: typecheck clean, all three suites pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/test
git commit -m "feat(auth): carry the platform-operator flag on the Actor"
```

---

### Task 4: `PlatformAccessService` and the `@SuperAdmin()` gate

**Files:**

- Create: `apps/api/src/authz/platform-access.service.ts`
- Create: `apps/api/src/authz/platform-access.test.ts`
- Modify: `apps/api/src/authz/authz.module.ts`
- Create: `apps/api/src/auth/decorators/super-admin.decorator.ts`
- Create: `apps/api/src/auth/guards/super-admin.guard.ts`
- Modify: `apps/api/src/auth/auth.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/authz/platform-access.test.ts`:

```ts
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { Actor } from "./actor";
import { PlatformAccessService } from "./platform-access.service";
import { Role } from "../domain/enums";

/**
 * Unit tests for the decision itself. They are not a substitute for
 * test/platform.test.ts, which proves the endpoints actually call it —
 * CLAUDE.md §4.1.
 */
const service = new PlatformAccessService();

function actor(overrides: Partial<Actor> = {}): Actor {
  return { userId: "u", sessionId: "s", isSuperAdmin: false, memberships: [], ...overrides };
}

describe("assertSuperAdmin", () => {
  it("allows a platform operator", () => {
    expect(() => service.assertSuperAdmin(actor({ isSuperAdmin: true }))).not.toThrow();
  });

  it("refuses a kindergarten admin with 404, not 403", () => {
    const admin = actor({
      memberships: [{ id: "m", kindergartenId: "kg-a", role: Role.ADMIN }],
    });

    expect(() => service.assertSuperAdmin(admin)).toThrow(NotFoundException);
  });

  it("refuses an actor with no memberships at all", () => {
    expect(() => service.assertSuperAdmin(actor())).toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @kinder/api test platform-access
```

Expected: FAIL — cannot resolve `./platform-access.service`.

- [ ] **Step 3: Write the service**

Create `apps/api/src/authz/platform-access.service.ts`:

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import type { Actor } from "./actor";

/**
 * Authorization for platform-level resources — registering a kindergarten,
 * which by definition has no tenant to be scoped by.
 *
 * ★ This is the ONLY thing `isSuperAdmin` grants. It deliberately does not
 * appear in `TenantAccessService` or `ChildAccessService`: a platform operator
 * registers kindergartens, they do not read children. Keeping the flag out of
 * those two services is what makes that structural rather than a promise —
 * test/platform.test.ts asserts a superadmin still gets 404 on a child, its
 * portfolio, its observations and its guardians.
 *
 * 404, never 403 — docs/SECURITY.md §5.4 · CLAUDE.md §1.7.
 */
@Injectable()
export class PlatformAccessService {
  assertSuperAdmin(actor: Actor): void {
    if (!actor.isSuperAdmin) throw new NotFoundException();
  }
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm --filter @kinder/api test platform-access
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Export it from the global authz module**

In `apps/api/src/authz/authz.module.ts`, import `PlatformAccessService` and add it to both `providers` and `exports`:

```ts
import { PlatformAccessService } from "./platform-access.service";

@Global()
@Module({
  providers: [AuthzRepository, ChildAccessService, TenantAccessService, PlatformAccessService],
  exports: [AuthzRepository, ChildAccessService, TenantAccessService, PlatformAccessService],
})
export class AuthzModule {}
```

- [ ] **Step 6: Add the decorator**

Create `apps/api/src/auth/decorators/super-admin.decorator.ts`:

```ts
import { SetMetadata } from "@nestjs/common";

export const REQUIRE_SUPER_ADMIN = "requireSuperAdmin";

/**
 * Requires a platform operator.
 *
 * ★ A coarse gate, like `@Roles(...)`. The service still calls
 * `PlatformAccessService.assertSuperAdmin` — a decorator is a filter in front
 * of the decision, never the decision. docs/SECURITY.md §4.
 */
export const SuperAdmin = () => SetMetadata(REQUIRE_SUPER_ADMIN, true);
```

- [ ] **Step 7: Add the guard**

Create `apps/api/src/auth/guards/super-admin.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Actor } from "../../authz/actor";
import { REQUIRE_SUPER_ADMIN } from "../decorators/super-admin.decorator";

/**
 * Enforces `@SuperAdmin()`.
 *
 * Returns **404** for the same reason `RolesGuard` does: one rule everywhere,
 * and the difference between 403 and 404 is exactly what an attacker probes
 * for. docs/SECURITY.md §5.4.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_SUPER_ADMIN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    if (!request.actor?.isSuperAdmin) throw new NotFoundException();

    return true;
  }
}
```

- [ ] **Step 8: Register it globally**

In `apps/api/src/auth/auth.module.ts`, import `SuperAdminGuard` and add it after `RolesGuard`, extending the ordering comment:

```ts
    //   4. SuperAdminGuard — same, for the platform routes.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
```

- [ ] **Step 9: Typecheck and run the API suite**

```bash
pnpm --filter @kinder/api typecheck && pnpm --filter @kinder/api test
```

Expected: typecheck clean; every existing suite still passes (the new guard is inert until a route carries the decorator).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src
git commit -m "feat(authz): platform-operator access service and guard"
```

---

### Task 5: `POST /platform/kindergartens`

**Files:**

- Create: `apps/api/test/platform.test.ts`
- Create: `apps/api/src/platform/platform.dto.ts`
- Create: `apps/api/src/platform/platform.repository.ts`
- Create: `apps/api/src/platform/platform.service.ts`
- Create: `apps/api/src/platform/platform.controller.ts`
- Create: `apps/api/src/platform/platform.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/platform.test.ts`:

```ts
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp } from "./support/app";
import { resetData, testDb, uniq } from "./support/db";
import {
  authed,
  createScenario,
  createUser,
  login,
  TEST_PASSWORD,
  type AuthSession,
  type Scenario,
} from "./support/fixtures";
import { RateLimitService } from "../src/common/rate-limit/rate-limit.service";

/**
 * Platform routes — through HTTP.
 *
 * Two things are under test and the second matters more than the first: that a
 * platform operator can register a kindergarten, and that being one grants
 * *nothing else*. CLAUDE.md §4.1.
 */

let app: INestApplication;
const db = testDb();

let a: Scenario;
let b: Scenario;
let superadmin: AuthSession;
let adminA: AuthSession;
let teacherA: AuthSession;
let parentA: AuthSession;

/** A valid create body, with unique identifiers so cases never collide. */
function createBody(overrides: Record<string, unknown> = {}) {
  return {
    name: `Цэцэрлэг ${uniq()}`,
    address: "Улаанбаатар, Сүхбаатар дүүрэг",
    phone: "99112233",
    email: null,
    description: null,
    admin: {
      username: uniq("director"),
      email: null,
      phone: null,
      lastName: "Дорж",
      firstName: "Болд",
    },
    ...overrides,
  };
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetData();
  app.get(RateLimitService).resetAll();

  a = await createScenario("a");
  b = await createScenario("b");

  const operator = await createUser({ username: uniq("super"), isSuperAdmin: true });
  superadmin = await login(app, operator.username);
  adminA = await login(app, a.adminUser.username);
  teacherA = await login(app, a.teacherUser.username);
  parentA = await login(app, a.parentUser.username);
});

describe("POST /platform/kindergartens", () => {
  it("registers a kindergarten with its first director", async () => {
    const body = createBody();

    const res = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      superadmin,
    ).send(body);

    expect(res.status).toBe(201);
    expect(res.body.kindergarten.name).toBe(body.name);
    expect(res.body.admin.username).toBe(body.admin.username);
    expect(typeof res.body.invitationToken).toBe("string");

    const membership = await db.membership.findFirst({
      where: { kindergartenId: res.body.kindergarten.id },
    });
    expect(membership?.role).toBe("ADMIN");
    expect(membership?.userId).toBe(res.body.admin.id);

    const token = await db.authToken.findFirst({ where: { userId: res.body.admin.id } });
    expect(token?.purpose).toBe("INVITATION");
  });

  it("lets the invited director set a password and log in as an ADMIN", async () => {
    const body = createBody();
    const created = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      superadmin,
    ).send(body);

    const accepted = await request(app.getHttpServer())
      .post("/v1/auth/invitation/accept")
      .send({ token: created.body.invitationToken, password: TEST_PASSWORD });
    expect(accepted.status).toBeLessThan(300);

    const director = await login(app, body.admin.username);
    const groups = await request(app.getHttpServer())
      .get(`/v1/groups?kindergartenId=${created.body.kindergarten.id}`)
      .set("Cookie", director.cookies);

    expect(groups.status).toBe(200);
  });

  it("refuses a duplicate username with 409 and creates no kindergarten", async () => {
    const body = createBody({ admin: { ...createBody().admin, username: a.adminUser.username } });

    const res = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      superadmin,
    ).send(body);

    expect(res.status).toBe(409);
    expect(await db.kindergarten.findFirst({ where: { name: body.name } })).toBeNull();
  });

  it.each([
    ["a kindergarten admin", () => adminA],
    ["a teacher", () => teacherA],
    ["a parent", () => parentA],
  ])("refuses %s with 404", async (_label, session) => {
    const res = await authed(
      request(app.getHttpServer()).post("/v1/platform/kindergartens"),
      session(),
    ).send(createBody());

    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated request", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/platform/kindergartens")
      .send(createBody());

    expect(res.status).toBe(401);
  });
});
```

Note: `b` is unused until Task 6 — leave it, that task asserts on it. If your
linter fails the build on an unused variable, write Task 6's list test now and
run both.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @kinder/api test platform.test.ts
```

Expected: FAIL — every case returns 404, because the route does not exist.

- [ ] **Step 3: Write the DTOs**

Create `apps/api/src/platform/platform.dto.ts`:

```ts
import { z } from "zod";
import { paginationQuerySchema } from "@kinder/contracts";
import { createUserSchema } from "../users/users.dto";

/**
 * The first director, created with the kindergarten.
 *
 * ★ `role` is omitted rather than accepted. Registering a kindergarten always
 * creates an ADMIN; a body-supplied role would let the operator produce a
 * kindergarten whose only member is a parent — a tenant nobody can administer.
 */
const firstAdminSchema = createUserSchema.omit({ role: true });

export const createKindergartenSchema = z.object({
  name: z.string().min(1, "Цэцэрлэгийн нэрийг оруулна уу").max(200),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  admin: firstAdminSchema,
});
export type CreateKindergartenDto = z.infer<typeof createKindergartenSchema>;

export const listPlatformKindergartensQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(100).optional(),
  /**
   * ★ `z.stringbool()`, NOT `z.coerce.boolean()`.
   *
   * `Boolean("false")` is `true`, so a coerced boolean turns `?isActive=false`
   * into a filter for *active* rows — the opposite of what was asked, silently.
   * `listUsersQuerySchema` has that bug today; do not copy it here.
   */
  isActive: z.stringbool().optional(),
});
export type ListPlatformKindergartensQuery = z.infer<
  typeof listPlatformKindergartensQuerySchema
>;
```

- [ ] **Step 4: Write the repository**

Create `apps/api/src/platform/platform.repository.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toSkipTake, type PageParams } from "../common/pagination";

/**
 * Platform-level kindergarten queries.
 *
 * ★ The one repository in the system with no tenant filter, because its caller
 * is not a member of anything. `deletedAt: null` still applies everywhere; it
 * is the *tenant* scope that is absent, and it is absent by design rather than
 * by omission. `PlatformService.assertSuperAdmin` is the only thing standing in
 * front of it — which is why nothing outside this module may inject it.
 */
@Injectable()
export class PlatformRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Kindergarten, director, membership and invitation — atomically.
   *
   * All four or none. A kindergarten with no membership is unreachable, and a
   * user with no invitation token can never set a password, so a partial
   * success here is worse than a failure.
   *
   * The password hash and the token hash are computed by the service: hashing
   * is expensive and belongs outside the transaction, and the token's plaintext
   * must never reach a repository.
   */
  async createWithAdmin(input: CreateWithAdminInput) {
    return this.prisma.$transaction(async (tx) => {
      const kindergarten = await tx.kindergarten.create({
        data: {
          name: input.kindergarten.name,
          address: input.kindergarten.address ?? null,
          phone: input.kindergarten.phone ?? null,
          email: input.kindergarten.email ?? null,
          description: input.kindergarten.description ?? null,
        },
      });

      const admin = await tx.user.create({
        data: {
          username: input.admin.username,
          email: input.admin.email,
          phone: input.admin.phone,
          lastName: input.admin.lastName,
          firstName: input.admin.firstName,
          passwordHash: input.admin.passwordHash,
        },
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          lastName: true,
          firstName: true,
        },
      });

      await tx.membership.create({
        data: { userId: admin.id, kindergartenId: kindergarten.id, role: "ADMIN" },
      });

      await tx.authToken.create({
        data: {
          userId: admin.id,
          purpose: "INVITATION",
          tokenHash: input.admin.invitationTokenHash,
          expiresAt: input.admin.invitationExpiresAt,
          requestedIp: null,
        },
      });

      return { kindergarten, admin };
    });
  }

  async list(filters: KindergartenFilters, page: PageParams) {
    const { skip, take } = toSkipTake(page);
    const where = {
      deletedAt: null,
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
      ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" as const } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.kindergarten.findMany({
        where,
        orderBy: { name: "asc" },
        skip,
        take,
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          email: true,
          isActive: true,
          createdAt: true,
        },
      }),
      this.prisma.kindergarten.count({ where }),
    ]);

    return { items, total };
  }

  /** Counts are filtered relation counts — one query, no N+1. §3.4 */
  async findById(id: string) {
    return this.prisma.kindergarten.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            groups: { where: { deletedAt: null, status: "ACTIVE" } },
            enrollments: { where: { deletedAt: null, status: "ACTIVE" } },
            memberships: { where: { deletedAt: null, isActive: true } },
          },
        },
      },
    });
  }

  async update(id: string, data: KindergartenUpdate) {
    return this.prisma.kindergarten.update({ where: { id }, data });
  }
}

export interface CreateWithAdminInput {
  kindergarten: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    description?: string | null;
  };
  admin: {
    username: string;
    email: string | null;
    phone: string | null;
    lastName: string;
    firstName: string;
    passwordHash: string;
    invitationTokenHash: string;
    invitationExpiresAt: Date;
  };
}

export interface KindergartenFilters {
  q?: string;
  isActive?: boolean;
}

export interface KindergartenUpdate {
  name?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  description?: string | null;
  isActive?: boolean;
}
```

- [ ] **Step 5: Write the service**

Create `apps/api/src/platform/platform.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { AuditRepository } from "../audit/audit.repository";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { PlatformAccessService } from "../authz/platform-access.service";
import type { Actor } from "../authz/actor";
import { paginate, type PageParams } from "../common/pagination";
import { UsersRepository } from "../users/users.repository";
import type { UpdateKindergartenDto } from "../tenants/tenants.dto";
import { PlatformRepository } from "./platform.repository";
import type { CreateKindergartenDto, ListPlatformKindergartensQuery } from "./platform.dto";

/** Matches UsersService — an invitation is an invitation wherever it is issued. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Registering and administering kindergartens as the platform operator.
 *
 * Every method opens with `assertSuperAdmin`. The guard on the controller says
 * the same thing, and both are kept: the guard makes a forgotten decorator
 * fail closed, this makes a forgotten guard fail closed.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly repo: PlatformRepository,
    private readonly platform: PlatformAccessService,
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditRepository,
  ) {}

  async create(actor: Actor, dto: CreateKindergartenDto) {
    this.platform.assertSuperAdmin(actor);

    await this.assertIdentifiersFree(dto.admin);

    // Hashing is deliberately outside the transaction: argon2 takes hundreds of
    // milliseconds and a transaction held open for it is a transaction holding
    // locks for it.
    const passwordHash = await this.passwords.hash(randomBytes(32).toString("hex"));
    const { token, hash } = this.tokens.createOneTimeToken();

    let created;
    try {
      created = await this.repo.createWithAdmin({
        kindergarten: dto,
        admin: {
          username: dto.admin.username,
          email: dto.admin.email ?? null,
          phone: dto.admin.phone ?? null,
          lastName: dto.admin.lastName,
          firstName: dto.admin.firstName,
          passwordHash,
          invitationTokenHash: hash,
          invitationExpiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
      });
    } catch (error) {
      // The pre-check above closes the common case; this closes the race
      // between it and the insert. Without it a concurrent duplicate surfaces
      // as a 500.
      if (isUniqueViolation(error)) {
        throw new ConflictException("Энэ нэвтрэх нэр, и-мэйл эсвэл утас аль хэдийн бүртгэлтэй");
      }
      throw error;
    }

    // After the commit. A log row written inside the transaction would describe
    // a kindergarten that can still roll back. CLAUDE.md §3.5.
    await this.audit.append({
      action: "CREATE",
      kindergartenId: created.kindergarten.id,
      actorUserId: actor.userId,
      objectType: "Kindergarten",
      objectId: created.kindergarten.id,
    });
    await this.audit.append({
      action: "INVITE",
      kindergartenId: created.kindergarten.id,
      actorUserId: actor.userId,
      objectType: "User",
      objectId: created.admin.id,
      metadata: { role: "ADMIN" },
    });

    // The token is returned so the operator can hand it over, exactly as the
    // teacher-invites-a-family flow does. Never logged.
    return { ...created, invitationToken: token };
  }

  async list(actor: Actor, query: ListPlatformKindergartensQuery) {
    this.platform.assertSuperAdmin(actor);

    const page: PageParams = { page: query.page, pageSize: query.pageSize };
    const { items, total } = await this.repo.list({ q: query.q, isActive: query.isActive }, page);
    return paginate(items, total, page);
  }

  async get(actor: Actor, id: string) {
    this.platform.assertSuperAdmin(actor);

    const kindergarten = await this.repo.findById(id);
    if (!kindergarten) throw new NotFoundException();
    return kindergarten;
  }

  async update(actor: Actor, id: string, dto: UpdateKindergartenDto) {
    this.platform.assertSuperAdmin(actor);

    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException();

    const updated = await this.repo.update(id, dto);
    await this.audit.append({
      action: "UPDATE",
      kindergartenId: id,
      actorUserId: actor.userId,
      objectType: "Kindergarten",
      objectId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return updated;
  }

  /**
   * Checked explicitly so a collision is a readable 409 rather than a raw
   * unique-constraint error surfacing as a 500. Mirrors UsersService.
   */
  private async assertIdentifiersFree(admin: CreateKindergartenDto["admin"]): Promise<void> {
    if (await this.users.findByUsername(admin.username)) {
      throw new ConflictException("Энэ нэвтрэх нэр аль хэдийн бүртгэлтэй байна");
    }
    if (admin.email && (await this.users.findByEmail(admin.email))) {
      throw new ConflictException("Энэ и-мэйл аль хэдийн бүртгэлтэй байна");
    }
    if (admin.phone && (await this.users.findByPhone(admin.phone))) {
      throw new ConflictException("Энэ утасны дугаар аль хэдийн бүртгэлтэй байна");
    }
  }
}

/** Prisma's unique-constraint code. Narrowed without importing the client. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
```

- [ ] **Step 6: Write the controller**

Create `apps/api/src/platform/platform.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { idParamSchema } from "@kinder/contracts";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentActor } from "../auth/decorators/actor.decorator";
import { SuperAdmin } from "../auth/decorators/super-admin.decorator";
import type { Actor } from "../authz/actor";
import { updateKindergartenSchema, type UpdateKindergartenDto } from "../tenants/tenants.dto";
import { PlatformService } from "./platform.service";
import {
  createKindergartenSchema,
  listPlatformKindergartensQuerySchema,
  type CreateKindergartenDto,
  type ListPlatformKindergartensQuery,
} from "./platform.dto";

/**
 * Platform routes.
 *
 * Under their own prefix rather than folded into `/kindergartens`, so that
 * `TenantsService.memberScope()` — the tenant isolation every teacher and
 * parent request passes through — stays free of "…unless the actor is a
 * superadmin" branches. CLAUDE.md §1.1.
 *
 * No DELETE: deactivation is `PATCH { isActive: false }`. §3.2.
 */
@Controller("platform")
@SuperAdmin()
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @Post("kindergartens")
  async create(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createKindergartenSchema)) body: CreateKindergartenDto,
  ) {
    return this.service.create(actor, body);
  }

  @Get("kindergartens")
  async list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listPlatformKindergartensQuerySchema))
    query: ListPlatformKindergartensQuery,
  ) {
    return this.service.list(actor, query);
  }

  @Get("kindergartens/:id")
  async get(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return this.service.get(actor, params.id);
  }

  @Patch("kindergartens/:id")
  async update(
    @CurrentActor() actor: Actor,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateKindergartenSchema)) body: UpdateKindergartenDto,
  ) {
    return this.service.update(actor, params.id, body);
  }
}
```

The decorator sits on the class, so a route added later is gated by default.

- [ ] **Step 7: Write the module and register it**

Create `apps/api/src/platform/platform.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { PlatformController } from "./platform.controller";
import { PlatformRepository } from "./platform.repository";
import { PlatformService } from "./platform.service";

@Module({
  // AuthModule supplies PasswordService and TokenService; UsersModule supplies
  // UsersRepository for the identifier collision checks.
  imports: [AuthModule, UsersModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformRepository],
})
export class PlatformModule {}
```

`PlatformRepository` is deliberately not exported — it has no tenant filter, so
nothing outside this module may reach it.

In `apps/api/src/app.module.ts`, import `PlatformModule` and add it to `imports`
directly after `TenantsModule`.

- [ ] **Step 8: Run the test**

```bash
pnpm --filter @kinder/api test platform.test.ts
```

Expected: PASS — 6 cases in the POST describe block.

- [ ] **Step 9: Check the ESLint Prisma boundary still holds**

```bash
pnpm lint
```

Expected: 0 errors. `PlatformRepository` is the only new file importing `PrismaService`, and it is a `*.repository.ts`.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/platform apps/api/src/app.module.ts apps/api/test/platform.test.ts
git commit -m "feat(api): register a kindergarten with its first director"
```

---

### Task 6: List, read and update

**Files:**

- Modify: `apps/api/test/platform.test.ts`
- No source changes expected — Task 5 wrote all four handlers. If a case fails, fix the source it points at.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/platform.test.ts`:

```ts
describe("GET /platform/kindergartens", () => {
  it("lists every kindergarten, not just the operator's", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((k: { id: string }) => k.id);
    expect(ids).toContain(a.kindergarten.id);
    expect(ids).toContain(b.kindergarten.id);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by name", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/platform/kindergartens?q=${encodeURIComponent(a.kindergarten.name)}`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(a.kindergarten.id);
  });

  it("filters by isActive, and ?isActive=false means inactive", async () => {
    await db.kindergarten.update({
      where: { id: b.kindergarten.id },
      data: { isActive: false },
    });

    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens?isActive=false")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body.items.map((k: { id: string }) => k.id)).toEqual([b.kindergarten.id]);
  });

  it.each([
    ["a kindergarten admin", () => adminA],
    ["a teacher", () => teacherA],
    ["a parent", () => parentA],
  ])("refuses %s with 404", async (_label, session) => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens")
      .set("Cookie", session().cookies);

    expect(res.status).toBe(404);
  });
});

describe("GET /platform/kindergartens/:id", () => {
  it("returns the kindergarten with its live counts", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/platform/kindergartens/${a.kindergarten.id}`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a.kindergarten.id);
    // createScenario builds one group, one active enrollment and three
    // memberships (admin, teacher, parent).
    expect(res.body._count).toEqual({ groups: 1, enrollments: 1, memberships: 3 });
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/platform/kindergartens/00000000-0000-4000-8000-000000000000")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("refuses a kindergarten admin with 404 — even for their own kindergarten", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/platform/kindergartens/${a.kindergarten.id}`)
      .set("Cookie", adminA.cookies);

    expect(res.status).toBe(404);
  });
});

describe("PATCH /platform/kindergartens/:id", () => {
  it("deactivates a kindergarten without deleting it", async () => {
    const res = await authed(
      request(app.getHttpServer()).patch(`/v1/platform/kindergartens/${b.kindergarten.id}`),
      superadmin,
    ).send({ isActive: false });

    expect(res.status).toBe(200);

    const row = await db.kindergarten.findUnique({ where: { id: b.kindergarten.id } });
    expect(row?.isActive).toBe(false);
    expect(row?.deletedAt).toBeNull();
  });

  it("refuses a kindergarten admin with 404", async () => {
    const res = await authed(
      request(app.getHttpServer()).patch(`/v1/platform/kindergartens/${a.kindergarten.id}`),
      adminA,
    ).send({ name: "Дур мэдэн өөрчилсөн" });

    expect(res.status).toBe(404);

    const row = await db.kindergarten.findUnique({ where: { id: a.kindergarten.id } });
    expect(row?.name).toBe(a.kindergarten.name);
  });
});

describe("unauthenticated access", () => {
  it("refuses every platform route with 401", async () => {
    const server = request(app.getHttpServer());
    const id = a.kindergarten.id;

    const responses = await Promise.all([
      server.get("/v1/platform/kindergartens"),
      server.get(`/v1/platform/kindergartens/${id}`),
      request(app.getHttpServer()).patch(`/v1/platform/kindergartens/${id}`).send({ name: "X" }),
    ]);

    expect(responses.map((r) => r.status)).toEqual([401, 401, 401]);
  });
});
```

- [ ] **Step 2: Run them**

```bash
pnpm --filter @kinder/api test platform.test.ts
```

Expected: PASS. If `_count` fails, compare the numbers against `createScenario`
in `test/support/fixtures.ts` — it creates one group, one active enrollment and
three memberships, and those are the numbers asserted.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/platform.test.ts
git commit -m "test(api): platform list, read and deactivate"
```

---

### Task 7: Prove the flag did not widen child access

This is the task the whole design exists to make possible. It must not be skipped.

**Files:**

- Modify: `apps/api/test/platform.test.ts`

- [ ] **Step 1: Write the tests**

Append to `apps/api/test/platform.test.ts`:

```ts
describe("a platform operator is not an admin of anything", () => {
  it("gets 404 on a child", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/children/${a.child.id}`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("gets 404 on a child's portfolio", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/children/${a.child.id}/portfolio`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("gets 404 on a child's observations", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/children/${a.child.id}/observations`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("gets 404 on a child's guardians", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/children/${a.child.id}/guardians`)
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });

  it("sees an empty list from the membership-scoped kindergarten route", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/kindergartens")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("gets 404 from the admin dashboard", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/dashboard/admin")
      .set("Cookie", superadmin.cookies);

    expect(res.status).toBe(404);
  });
});
```

These go through list and detail routes rather than creating an `Observation`
row, because `Observation` requires an `enrollmentId` and a `typeId` and the
setup would obscure what is being asserted. The routes reach
`ChildAccessService` either way, which is the thing under test.

- [ ] **Step 2: Run them**

```bash
pnpm --filter @kinder/api test platform.test.ts
```

Expected: PASS. A failure here means the flag reached `TenantAccessService` or
`ChildAccessService` — revert that, do not relax the test.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/platform.test.ts
git commit -m "test(authz): a platform operator still gets 404 on child data"
```

---

### Task 8: Documentation and full verification

**Files:**

- Modify: `docs/API.md` (section 4, the kindergarten table around line 111)

- [ ] **Step 1: Document the routes**

In `docs/API.md`, add a subsection immediately after the section 4 table:

```markdown
### 4.1 Platform routes

Reachable only by a user with `User.isSuperAdmin`. The `sa` scope below means
exactly that and nothing more — a platform operator holds no membership, so
every membership-scoped route in this document still answers them with 404.

| Method | Path                          | Role | Scope | Body / query                                    | Returns                              |
| ------ | ----------------------------- | ---- | ----- | ----------------------------------------------- | ------------------------------------ |
| POST   | `/platform/kindergartens`     | —    | `sa`  | name, address, phone, email, description, admin | kindergarten, admin, invitationToken |
| GET    | `/platform/kindergartens`     | —    | `sa`  | `?q&isActive&page&pageSize`                     | paginated, every kindergarten        |
| GET    | `/platform/kindergartens/:id` | —    | `sa`  | —                                               | detail with group/enrollment/membership counts |
| PATCH  | `/platform/kindergartens/:id` | —    | `sa`  | name, address, contact, isActive                | updated                              |

There is no DELETE. Deactivation is `PATCH { isActive: false }` — CLAUDE.md §3.2.

`admin` is `{ username, lastName, firstName, email?, phone? }` and always
becomes an ADMIN membership in the new kindergarten; the role is not accepted
from the body. The response's `invitationToken` is the director's one-time link
and is never logged.
```

- [ ] **Step 2: Run the whole verification set**

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm --filter @kinder/api test
```

Expected: typecheck clean across all projects, 0 lint errors, formatting clean,
and the full API suite green — the pre-existing count plus the new platform
cases. If `format:check` fails, run `pnpm format` and include the result in the
commit.

- [ ] **Step 3: Report the real numbers**

Record the actual test output in the commit body — not "tests pass". CLAUDE.md
§4.2.

- [ ] **Step 4: Commit**

```bash
git add docs/API.md apps/api
git commit -m "docs(api): document the platform kindergarten routes"
```

---

## Not in this plan

- **Web UI.** No superadmin screens. Deliberate — see the spec, §8.
- **ESIS integration.** The portal is behind a login and its API surface could not be inspected.
- **Widening superadmin reach** to backups, all-users administration or cross-tenant child access.
- **Login gating on `Kindergarten.isActive`.** The column is stored and edited; what an inactive kindergarten does to its users' sessions is unchanged.
