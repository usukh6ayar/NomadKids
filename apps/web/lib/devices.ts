import { z } from "zod";

/**
 * «Бүртгэлтэй төхөөрөмж» — every account signs in from at most two devices
 * (the user, 2026-10-12). The web side is built first; the API follows.
 *
 * ★ The contract the backend is asked for — nothing answers it yet:
 *
 *   GET    /auth/sessions        → { limit, sessions: DeviceSession[] }
 *   DELETE /auth/sessions/:id    → 204, signs that device out
 *   POST   /auth/login           → 409 { code: "DEVICE_LIMIT" } when `limit`
 *                                   devices are already signed in
 *   POST   /auth/login/devices   { identifier, password }
 *                                → { sessions: DeviceSession[] } — the
 *                                   password is checked again, so a stranger
 *                                   who only has a phone number sees nothing
 *   POST   /auth/login           { identifier, password, replaceSessionId }
 *                                → signs that device out and this one in
 *
 * ★★ The list does not ride on the 409 itself: `problemSchema` keeps only the
 * fields it knows, so anything extra on an error body is dropped before a
 * screen sees it. A second call is also where the password is checked again.
 */
export const DEVICE_LIMIT_CODE = "DEVICE_LIMIT";

export const deviceSessionSchema = z.object({
  id: z.string(),
  userAgent: z.string().nullish(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullish(),
  /** The device this request came from. Absent on the sign-in list. */
  current: z.boolean().optional(),
});
export type DeviceSession = z.infer<typeof deviceSessionSchema>;

export const deviceSessionsSchema = z.object({
  limit: z.number().int().positive(),
  sessions: z.array(deviceSessionSchema),
});

export const loginDevicesSchema = z.object({ sessions: z.array(deviceSessionSchema) });

export type DeviceKind = "phone" | "tablet" | "computer";

/**
 * «iPhone · Safari» from a User-Agent string — what a person recognises, not
 * what the browser says about itself. Unknown parts are left out rather than
 * guessed; nothing at all reads «Тодорхойгүй төхөөрөмж».
 */
export function describeDevice(userAgent: string | null | undefined): {
  label: string;
  kind: DeviceKind;
} {
  const ua = userAgent ?? "";

  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : null;

  // Order matters: Edge and Opera say «Chrome», and Chrome says «Safari».
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;

  const kind: DeviceKind =
    system === "iPad" || (system === "Android" && !/Mobile/.test(ua))
      ? "tablet"
      : system === "iPhone" || system === "Android"
        ? "phone"
        : "computer";

  const label = [system, browser].filter(Boolean).join(" · ") || "Тодорхойгүй төхөөрөмж";
  return { label, kind };
}
