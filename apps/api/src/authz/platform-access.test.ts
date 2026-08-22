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
