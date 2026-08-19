import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { errorMessage, fieldErrors, isNotFound, isSessionExpired } from "./errors";

function problem(status: number, extra: Record<string, unknown> = {}) {
  return new ApiError(status, {
    type: "about:blank",
    title: "Алдаа",
    status,
    requestId: "test",
    ...extra,
  });
}

/**
 * The problem+json → UI mapping.
 *
 * Every screen routes its errors through here, so these cases are the ones a
 * user actually reads when something fails.
 */
describe("errorMessage", () => {
  it("prefers the server's own Mongolian detail", () => {
    // The API writes specific, actionable messages. A generic status map would
    // replace "Хүүхэд энэ бүлэгт бүртгэлгүй байна" with "Оруулсан мэдээлэл
    // буруу байна", which tells the teacher nothing.
    const message = errorMessage(problem(400, { detail: "Хүүхэд энэ бүлэгт бүртгэлгүй байна" }));
    expect(message).toBe("Хүүхэд энэ бүлэгт бүртгэлгүй байна");
  });

  it("falls back to a status message when there is no detail", () => {
    expect(errorMessage(problem(429))).toContain("Хэт олон удаа");
  });

  /**
   * ★ A 404 must never be described as a permissions failure.
   *
   * The API deliberately does not distinguish "absent" from "not yours"
   * (SECURITY.md §5.4). Writing "Танд эрх байхгүй" in the UI would hand back,
   * through the interface, exactly the fact the API spends effort hiding — it
   * would confirm the record exists.
   */
  it("describes a 404 as not-found, never as forbidden", () => {
    const message = errorMessage(problem(404));
    expect(message).toBe("Олдсонгүй.");
    expect(message).not.toMatch(/эрх/);
  });

  it("distinguishes a network failure, which the user can act on", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toContain("Сүлжээнд");
  });

  it("falls back for an unknown throw rather than rendering [object Object]", () => {
    expect(errorMessage({ weird: true })).toBe("Алдаа гарлаа. Дахин оролдоно уу.");
  });
});

describe("fieldErrors", () => {
  it("takes the first message per field", () => {
    const error = problem(400, {
      errors: { identifier: ["Заавал бөглөнө", "Хэт богино"], password: ["Заавал бөглөнө"] },
    });

    expect(fieldErrors(error)).toEqual({
      identifier: "Заавал бөглөнө",
      password: "Заавал бөглөнө",
    });
  });

  it("is empty for a non-400, so a caller can always spread it", () => {
    expect(fieldErrors(problem(500))).toEqual({});
    expect(fieldErrors(new Error("boom"))).toEqual({});
  });
});

describe("isSessionExpired", () => {
  it("is true only for 401", () => {
    expect(isSessionExpired(problem(401))).toBe(true);
  });

  /**
   * ★ A 404 is not a session problem.
   *
   * Treating it as one would bounce a teacher to the login page for opening a
   * child they cannot see — and they would sign back in to find the same 404.
   */
  it("is false for 404, which is an authorization outcome", () => {
    expect(isSessionExpired(problem(404))).toBe(false);
    expect(isNotFound(problem(404))).toBe(true);
  });
});
