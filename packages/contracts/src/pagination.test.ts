import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_PAGE_SIZE, paginated, paginationQuerySchema } from "./pagination";

describe("paginationQuerySchema", () => {
  it("applies defaults when nothing is supplied", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });

  it("coerces the string values a query string actually delivers", () => {
    expect(paginationQuerySchema.parse({ page: "3", pageSize: "50" })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it("refuses a pageSize above the ceiling", () => {
    // Without this, ?pageSize=100000 is a bulk export of a kindergarten.
    expect(() => paginationQuerySchema.parse({ pageSize: MAX_PAGE_SIZE + 1 })).toThrow();
  });

  it("refuses a page below 1", () => {
    expect(() => paginationQuerySchema.parse({ page: 0 })).toThrow();
  });
});

describe("paginated", () => {
  it("validates the envelope around the item schema", () => {
    const schema = paginated(z.object({ id: z.string() }));
    const value = { items: [{ id: "a" }], page: 1, pageSize: 25, total: 1, totalPages: 1 };
    expect(schema.parse(value)).toEqual(value);
  });

  it("rejects items that do not match the item schema", () => {
    const schema = paginated(z.object({ id: z.string() }));
    expect(() =>
      schema.parse({ items: [{ id: 1 }], page: 1, pageSize: 25, total: 1, totalPages: 1 }),
    ).toThrow();
  });
});
