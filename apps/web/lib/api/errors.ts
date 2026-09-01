import { ApiError } from "./client";

/**
 * The portal access fee is unpaid — the one refusal a user can act on.
 *
 * ★ Every other refusal this file maps is a dead end by design: a 404 says
 * "absent or not yours" and offers nothing, because offering something would
 * leak which of the two it is. 402 is the deliberate exception — the caller is
 * already known to be this child's guardian, so the screen can and must show
 * the way out. `AccessGate` is what does that.
 */
export function isPaymentRequired(error: unknown): boolean {
  return error instanceof ApiError && error.isPaymentRequired;
}

/**
 * problem+json → what the user reads.
 *
 * One mapping, used by every screen. Two things it deliberately does:
 *
 *  1. **Prefers the server's `detail`.** The API already writes user-facing
 *     Mongolian ("Хүүхэд энэ бүлэгт бүртгэлгүй байна"), and that message is
 *     more specific than anything a generic status map can produce.
 *  2. **Never invents a distinction the API refuses to make.** A 404 is
 *     "resource absent OR you may not see it", and the copy here says exactly
 *     that — "Олдсонгүй". Writing "Танд эрх байхгүй" would leak, in the UI,
 *     precisely what docs/SECURITY.md §5.4 spends effort hiding in the API.
 */

const STATUS_MESSAGES: Record<number, string> = {
  400: "Оруулсан мэдээлэл буруу байна. Шалгаад дахин оролдоно уу.",
  401: "Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.",
  402: "Энэ хүүхдийн мэдээллийг үзэхийн тулд хандалтын төлбөрөө төлнө үү.",
  403: "Хүсэлт хүчингүй байна. Хуудсыг сэргээгээд дахин оролдоно уу.",
  404: "Олдсонгүй.",
  409: "Энэ мэдээлэл аль хэдийн бүртгэгдсэн байна.",
  413: "Файл хэт том байна.",
  429: "Хэт олон удаа хүсэлт илгээлээ. Түр хүлээгээд дахин оролдоно уу.",
  500: "Серверт алдаа гарлаа. Түр хүлээгээд дахин оролдоно уу.",
  503: "Үйлчилгээ түр боломжгүй байна.",
};

const FALLBACK = "Алдаа гарлаа. Дахин оролдоно уу.";

/** The sentence to show for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // 403 is CSRF/origin only — never an authorization outcome — so the
    // server's detail there is about a malformed request, not permissions.
    return error.problem.detail ?? STATUS_MESSAGES[error.status] ?? FALLBACK;
  }

  if (error instanceof TypeError) {
    // fetch rejects with TypeError when the network is unreachable. The user
    // can act on this one, so it is worth distinguishing.
    return "Сүлжээнд холбогдож чадсангүй. Холболтоо шалгана уу.";
  }

  return FALLBACK;
}

/**
 * Field errors from a 400, keyed by field name.
 *
 * Empty for every other status, so a caller can always spread it into form
 * state without checking first.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.problem.errors) return {};

  return Object.fromEntries(
    Object.entries(error.problem.errors)
      .map(([field, messages]) => [field, messages[0]])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

/**
 * True when the session is gone and the user must log in again.
 *
 * Only 401. A 404 is not a session problem — treating it as one would bounce a
 * teacher to the login page for opening a child they cannot see, and they would
 * log back in to find the same 404.
 */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
