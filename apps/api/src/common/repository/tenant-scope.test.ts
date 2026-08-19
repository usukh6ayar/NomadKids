import { describe, expect, it } from "vitest";
import { baseWhere, baseWhereUnscoped, scopedWhere } from "./tenant-scope";

describe("baseWhere", () => {
  it("always filters soft-deleted rows", () => {
    expect(baseWhere({ kindergartenIds: ["k1"] })).toMatchObject({ deletedAt: null });
  });

  it("restricts to the actor's kindergartens", () => {
    expect(baseWhere({ kindergartenIds: ["k1", "k2"] })).toMatchObject({
      kindergartenId: { in: ["k1", "k2"] },
    });
  });

  it("matches nothing for an actor with no memberships", () => {
    // `in: []` matches no row. This must never be "optimised" into omitting
    // the filter, which would show that user every kindergarten's data.
    expect(baseWhere({ kindergartenIds: [] })).toMatchObject({ kindergartenId: { in: [] } });
  });
});

describe("scopedWhere", () => {
  it("nests conditions under AND so the guards cannot be overwritten", () => {
    const where = scopedWhere({ kindergartenIds: ["k1"] }, { status: "ACTIVE" });
    expect(where).toEqual({
      AND: [{ deletedAt: null, kindergartenId: { in: ["k1"] } }, { status: "ACTIVE" }],
    });
  });

  it("a caller cannot disable the soft-delete filter", () => {
    // Top-level merging would let this replace `deletedAt: null` and expose
    // deleted records. Under AND the two conditions contradict and match none.
    const where = scopedWhere({ kindergartenIds: ["k1"] }, { deletedAt: { not: null } });
    const [guards, conditions] = (where as { AND: Record<string, unknown>[] }).AND;
    expect(guards).toMatchObject({ deletedAt: null });
    expect(conditions).toMatchObject({ deletedAt: { not: null } });
  });

  it("a caller cannot widen the tenant filter", () => {
    const where = scopedWhere(
      { kindergartenIds: ["k1"] },
      { kindergartenId: { in: ["k1", "k2"] } },
    );
    const [guards] = (where as { AND: Record<string, unknown>[] }).AND;
    expect(guards).toMatchObject({ kindergartenId: { in: ["k1"] } });
  });

  it("works with no extra conditions", () => {
    expect(scopedWhere({ kindergartenIds: ["k1"] })).toEqual({
      AND: [{ deletedAt: null, kindergartenId: { in: ["k1"] } }, {}],
    });
  });
});

describe("baseWhereUnscoped", () => {
  it("filters soft deletes without a tenant condition", () => {
    expect(baseWhereUnscoped()).toEqual({ deletedAt: null });
  });
});
