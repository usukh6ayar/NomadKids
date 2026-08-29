import { problemSchema, type Problem } from "@kinder/contracts";

/**
 * The single way this application talks to the API.
 *
 * Two defaults here are load-bearing, and both exist because forgetting them at
 * a call site is silent:
 *
 *   credentials: "include"  — without it the auth cookie is not sent and every
 *                             authenticated request 401s.
 *   cache: "no-store"       — Next.js caches per URL, not per user. A cached
 *                             response holding one child's data would be served
 *                             to another parent. CLAUDE.md §2.4.
 *
 * Neither is overridable through this function's options, deliberately. If a
 * genuinely public, cacheable endpoint appears, it gets its own explicit
 * helper rather than a flag that can be set by accident.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const API_PREFIX = "/v1";

/**
 * The `<img src>` for a stored image.
 *
 * ★ Not a bucket URL, and not a URL this app constructs from a storage key —
 * it is the API's own route. `GET /v1/media/:id` runs `canAccessChild`, checks
 * the observation's visibility for a guardian, and only then **302s** to a
 * presigned URL with a five-minute lifetime.
 *
 * Used as a plain `<img>` rather than fetched, for two reasons:
 *
 *  - The response is a redirect to an image, not JSON. `fetch` would follow it
 *    and then fail trying to parse a JPEG.
 *  - The auth cookie is `SameSite=Lax` and the web app and API share a
 *    registrable domain, so the browser attaches it to the image request by
 *    itself. No token is handled here at all.
 *
 * The private bucket is never reachable: the presigned URL is minted per
 * request, after the check, and expires.
 */
export function mediaUrl(mediaId: string): string {
  return `${BASE_URL}${API_PREFIX}/media/${mediaId}`;
}

/**
 * A URL for a file the browser should download rather than fetch.
 *
 * ★ Navigated to, not `fetch`ed. The session cookie rides along on a
 * navigation, and the browser handles `Content-Disposition` itself — reading
 * the bytes into JavaScript to rebuild them as a blob would hold a whole
 * spreadsheet in memory to achieve the same thing.
 */
export function downloadUrl(path: string): string {
  return `${BASE_URL}${API_PREFIX}${path}`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.title);
    this.name = "ApiError";
  }

  /**
   * True when the resource is absent OR the user may not see it. The API
   * deliberately does not distinguish the two, so neither does this.
   * docs/SECURITY.md §5.4.
   */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * JSON-serialised — unless it is `FormData`, which is passed through
   * untouched. The browser must set the multipart Content-Type itself, because
   * it carries the boundary; setting the header by hand produces a body the
   * server cannot parse, and the error surfaces as a validation failure rather
   * than as anything about encoding.
   */
  body?: unknown;
  /** Forwarded to fetch; use for React Server Component cancellation. */
  signal?: AbortSignal;
  /** Cookie header, required when calling from a server component. */
  cookie?: string;
  /** CSRF token, required on every unsafe method. */
  csrfToken?: string;
}

export async function apiFetch<T>(
  path: string,
  schema: { parse: (data: unknown) => T },
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, signal, cookie, csrfToken } = options;

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const headers: Record<string, string> = { Accept: "application/json" };
  // Never set for FormData — see the note on `body`.
  if (body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const response = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    method,
    headers,
    credentials: "include",
    cache: "no-store",
    ...(body !== undefined ? { body: isFormData ? body : JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });

  if (response.status === 204) {
    return schema.parse(undefined);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = problemSchema.safeParse(payload);
    throw new ApiError(
      response.status,
      parsed.success
        ? parsed.data
        : {
            type: "about:blank",
            title: "Алдаа гарлаа",
            status: response.status,
            requestId: "unknown",
          },
    );
  }

  // Responses are validated, not trusted. A schema mismatch is a bug worth
  // surfacing in development rather than a runtime crash three components deep.
  return schema.parse(payload);
}
