import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request CSP nonce.
 *
 * ★ Next injects inline `<script>` tags of its own — the bootstrap and the
 * hydration payload. A policy of `script-src 'self'` blocks them, and the
 * symptom is not an obviously broken page: the HTML renders, then hydration
 * fails with React error #412 and nothing on the page responds to a click.
 * Found on the first real browser load of the deployed app.
 *
 * The fix is a nonce rather than `'unsafe-inline'`. `'unsafe-inline'` on
 * `script-src` would re-admit every injected `<script>` an XSS could plant,
 * which for a product holding children's records is the wrong trade. A nonce
 * admits exactly the scripts this server emitted, and Next applies it to its
 * own tags automatically when it sees one in the CSP header.
 *
 * ★★ The cost, stated plainly: a nonce must be unique per request, so pages
 * that carry one cannot be statically cached — every route becomes
 * server-rendered. That is acceptable here because all but the login and
 * password-reset screens are authenticated and personalised anyway, so they
 * were never going to be cached.
 *
 * `'strict-dynamic'` lets the nonced bootstrap load the rest of the chunks
 * without listing each one; browsers that do not support it fall back to
 * `'self'`, which is why both are present.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isProduction = process.env.NODE_ENV === "production";
  const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  const csp = [
    "default-src 'self'",
    // `unsafe-eval` in development only — Next's fast refresh needs it, and
    // shipping it would defeat most of the point of a script policy.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    // Styles keep `unsafe-inline`: Next inlines critical CSS and React sets
    // inline `style` attributes. A real, scoped weakening — styles only.
    "style-src 'self' 'unsafe-inline'",
    // `blob:` covers a locally previewed upload before it is sent.
    `img-src 'self' data: blob: ${apiOrigin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}${isProduction ? "" : " ws: http://localhost:*"}`,
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // A form posting elsewhere is either a bug or an exfiltration attempt.
    "form-action 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  // Next reads the nonce from the *request* headers to stamp its own script
  // tags, so it has to be set on the request as well as the response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own static output and image optimiser. Those are
     * served as assets, carry no inline script, and adding a per-request header
     * to them would defeat their caching for no benefit.
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
