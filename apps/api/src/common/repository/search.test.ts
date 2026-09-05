import { describe, expect, it } from "vitest";
import { anyOf, searchRelation, searchTermSchema, searchWhere } from "./search";

/**
 * The shared search definition — Order А/261, kindergarten criterion 21.
 *
 * ★ These are unit tests beside the module, which is unusual in this project:
 * almost everything is asserted through HTTP because a check that never runs
 * against the real route proves nothing (CLAUDE.md §4.1).
 *
 * The exception earns itself. What this file has to guarantee is not "search
 * works on the children list" — that has its own integration test — but that
 * every list in the product answers the *same* term the *same* way. The
 * failures that matter here are shape failures: a fragment that matches
 * everything when it should match nothing, an `OR` lifted out of its relation,
 * an untrimmed term. `tenant-scope.test.ts` sits beside its module for exactly
 * this reason.
 */

describe("searchTermSchema", () => {
  it("trims, because a pasted trailing space is invisible and matches nothing", () => {
    expect(searchTermSchema.parse("  Дорж  ")).toBe("Дорж");
  });

  /**
   * ★ `undefined`, not `""`.
   *
   * A repository spreads `...(fragment ?? {})`, and `searchWhere` returns
   * `null` only for a falsy term. An empty string surviving this far would
   * produce `contains: ""`, which matches every row — the right answer here by
   * luck, and the wrong one the moment a list searches with `startsWith`.
   */
  it("turns an all-whitespace term into no term at all", () => {
    expect(searchTermSchema.parse("   ")).toBeUndefined();
    expect(searchTermSchema.parse("")).toBeUndefined();
    expect(searchTermSchema.parse(undefined)).toBeUndefined();
  });

  it("refuses a term longer than the column can usefully match", () => {
    expect(() => searchTermSchema.parse("а".repeat(101))).toThrow();
  });
});

describe("searchWhere", () => {
  it("matches any of the named fields, case-insensitively", () => {
    expect(searchWhere("дор", ["lastName", "firstName"])).toEqual({
      OR: [
        { lastName: { contains: "дор", mode: "insensitive" } },
        { firstName: { contains: "дор", mode: "insensitive" } },
      ],
    });
  });

  /**
   * ★ `null`, never `{}`.
   *
   * An empty object spread into a `where` is a no-op, so both would work — but
   * `null` makes a call site that forgets the `?? {}` fail to compile instead
   * of silently building a query with a stray `undefined` in it.
   */
  it("returns null when there is nothing to search for", () => {
    expect(searchWhere(undefined, ["lastName"])).toBeNull();
    expect(searchWhere("", ["lastName"])).toBeNull();
    expect(searchWhere("дор", [])).toBeNull();
  });
});

describe("searchRelation", () => {
  /**
   * ★ The `OR` stays *inside* the relation.
   *
   * `{ OR: [{ child: { lastName } }, { child: { firstName } }] }` returns the
   * same rows and is a different query plan: Postgres cannot use the relation's
   * index once the alternatives are lifted above the join. On a list of a
   * kindergarten's invoices that is the difference between an index lookup and
   * a scan of every child.
   */
  it("nests the alternatives under the relation, not above it", () => {
    expect(searchRelation("дор", "child", ["lastName", "firstName"])).toEqual({
      child: {
        OR: [
          { lastName: { contains: "дор", mode: "insensitive" } },
          { firstName: { contains: "дор", mode: "insensitive" } },
        ],
      },
    });
  });

  it("returns null when there is nothing to search for", () => {
    expect(searchRelation(undefined, "child", ["lastName"])).toBeNull();
  });
});

describe("anyOf", () => {
  /**
   * ★ Alternatives, not requirements.
   *
   * These fragments are different places the *same* term might appear, so a
   * term matching either one is a hit. `AND` here would mean a search only
   * finds an invoice whose number *and* whose child's name both contain
   * "Дорж" — which is essentially never, and reads as "search is broken".
   */
  it("joins fragments with OR", () => {
    const number = searchWhere("дор", ["number"]);
    const child = searchRelation("дор", "child", ["lastName"]);

    expect(anyOf(number, child)).toEqual({ OR: [number, child] });
  });

  it("unwraps a single fragment rather than wrapping it in a pointless OR", () => {
    const one = searchWhere("дор", ["number"]);
    expect(anyOf(one, null)).toEqual(one);
  });

  it("returns null when every fragment is empty", () => {
    expect(anyOf(null, null)).toBeNull();
  });
});
