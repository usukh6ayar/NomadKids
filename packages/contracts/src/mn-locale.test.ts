import { describe, expect, it } from "vitest";
import { z } from "zod";
// The entry point is what installs the locale — importing `./mn-locale`
// directly would test a function nothing calls. This is the wiring under test.
import "./index";

/**
 * Every validation message a user can read is Mongolian — CLAUDE.md §5.
 *
 * ★ These assert **"no Latin letters"** rather than exact sentences. The
 * wording is allowed to improve without a test failing; the language is not.
 * Pinning the copy would make this file a second place to edit every time a
 * message is reworded, which is how a test stops being run.
 */

/** Latin letters that are not part of a value the caller themselves supplied. */
function hasLatin(message: string): boolean {
  // The format names this product keeps in Latin on purpose — an IPv4 address
  // is called that in Mongolian too.
  return /[A-Za-z]/.test(message.replace(/IPv[46]|JSON|base64/g, ""));
}

function firstMessage(schema: z.ZodType, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected this input to be refused");
  return result.error.issues[0]!.message;
}

describe("Zod speaks Mongolian", () => {
  /**
   * ★ The list is not a sample. It is every `expected` value Zod 4.4 can put
   * in an `invalid_type` issue, collected by parsing a wrong value against
   * every schema constructor. `int` escaped the first version of `TYPES` and
   * reached a response as "int оруулна уу" — this is what stops the next one.
   */
  it.each([
    ["string", z.string(), 1],
    ["number", z.number(), "x"],
    ["int", z.number().int(), 1.5],
    ["bigint", z.bigint(), "x"],
    ["boolean", z.boolean(), "x"],
    ["date", z.coerce.date(), "огноо биш"],
    ["array", z.array(z.string()), "x"],
    ["tuple", z.tuple([z.string()]), "x"],
    ["set", z.set(z.string()), "x"],
    ["object", z.object({}), "x"],
    ["record", z.record(z.string(), z.string()), "x"],
    ["map", z.map(z.string(), z.string()), "x"],
    ["symbol", z.symbol(), "x"],
    ["never", z.never(), "x"],
    ["void", z.void(), "x"],
    ["null", z.null(), "x"],
    ["undefined", z.undefined(), "x"],
    ["nan", z.number(), Number.NaN],
  ])("names the %s type in Mongolian", (_label, schema, input) => {
    expect(hasLatin(firstMessage(schema, input))).toBe(false);
  });

  it.each([
    ["a missing field", z.object({ a: z.string() }), {}],
    ["a short string", z.string().min(5), "ab"],
    ["a long string", z.string().max(3), "abcdef"],
    ["a small number", z.number().min(10), 3],
    ["a large number", z.number().max(10), 99],
    ["a short array", z.array(z.string()).min(2), ["one"]],
    ["a long array", z.array(z.string()).max(1), ["1", "2", "3"]],
    ["a bad e-mail", z.email(), "nope"],
    ["a bad id", z.uuid(), "nope"],
    ["a bad URL", z.url(), "nope"],
    ["a failed pattern", z.string().regex(/^\d+$/), "abc"],
    ["a wrong prefix", z.string().startsWith("УБ"), "XX"],
    ["a wrong multiple", z.number().multipleOf(5), 7],
    ["an option off the list", z.enum(["X", "Y"]), "Z"],
  ])("refuses %s in Mongolian", (_label, schema, input) => {
    expect(hasLatin(firstMessage(schema, input))).toBe(false);
  });

  /*
   * ★★ `min(1)` is the product's most common constraint and it is not a
   * length rule to the person reading it — it is an empty required field.
   * Worth pinning because the literal translation is both correct and useless,
   * so a future refactor could reintroduce it without anything objecting.
   */
  it("treats an empty required string as unfilled, not as too short", () => {
    expect(firstMessage(z.string().min(1), "")).toBe("Энэ талбарыг бөглөнө үү.");
    expect(firstMessage(z.object({ a: z.string() }), {})).toBe("Энэ талбарыг бөглөнө үү.");
  });

  /*
   * ★★★ A field-specific message still wins. Everywhere the product can say
   * something better than a generic sentence, it must keep being able to.
   */
  it("does not override a message the schema supplies itself", () => {
    expect(firstMessage(z.string().min(1, "Бүлгийн нэрийг оруулна уу"), "")).toBe(
      "Бүлгийн нэрийг оруулна уу",
    );
  });

  /*
   * ★★★★ The counted unit declines with what is being counted. A single
   * `${n} тэмдэгт` template would print "2 зүйлээс" as "2 тэмдэгтээс" for an
   * array, which is the kind of wrong that reads as machine translation.
   */
  it("counts characters and items with their own words", () => {
    expect(firstMessage(z.string().min(5), "ab")).toContain("тэмдэгт");
    expect(firstMessage(z.array(z.string()).min(2), ["one"])).toContain("зүйл");
  });
});
