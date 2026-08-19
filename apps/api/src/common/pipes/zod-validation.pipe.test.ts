import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";

const schema = z.object({
  firstName: z.string().min(1),
  age: z.number().int().min(2).max(5),
});

describe("ZodValidationPipe", () => {
  it("returns the parsed value on success", () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ firstName: "Батбаяр", age: 4 })).toEqual({
      firstName: "Батбаяр",
      age: 4,
    });
  });

  it("throws BadRequest on failure", () => {
    const pipe = new ZodValidationPipe(schema);
    expect(() => pipe.transform({ firstName: "", age: 9 })).toThrow(BadRequestException);
  });

  it("groups messages by field so the form can attach them to inputs", () => {
    const pipe = new ZodValidationPipe(schema);
    try {
      pipe.transform({ firstName: "", age: 9 });
      expect.unreachable("should have thrown");
    } catch (e) {
      const body = (e as BadRequestException).getResponse() as {
        errors: Record<string, string[]>;
      };
      expect(Object.keys(body.errors).sort()).toEqual(["age", "firstName"]);
    }
  });

  it("does not echo the rejected value back", () => {
    // A rejected password must not reappear in the response body.
    const pw = z.object({ password: z.string().min(8) });
    const pipe = new ZodValidationPipe(pw);
    try {
      pipe.transform({ password: "hunter2" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(JSON.stringify((e as BadRequestException).getResponse())).not.toContain("hunter2");
    }
  });

  it("strips unknown properties rather than passing them through", () => {
    // A client sending kindergartenId in a body must not have it reach a
    // service — authorization inputs are derived server-side. CLAUDE.md §1.3.
    const pipe = new ZodValidationPipe(schema);
    const out = pipe.transform({ firstName: "Сараа", age: 3, kindergartenId: "attacker" });
    expect(out).not.toHaveProperty("kindergartenId");
  });
});
