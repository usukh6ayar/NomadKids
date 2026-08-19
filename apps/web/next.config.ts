import type { NextConfig } from "next";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const isProduction = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 *
 * ★ `connect-src` and `img-src` must include the API origin.
 *
 * Every authenticated request goes to `api.nomadkids.mn`, and every photo is an
 * `<img src>` pointing at `/v1/media/:id` on that same host. A policy that
 * omitted it would block the entire application — and would do so only in
 * production, where the origins actually differ, which is the worst possible
 * time to discover it.
 *
 * `'unsafe-inline'` for styles is required by Next: it inlines critical CSS and
 * React sets inline `style` attributes. It is a real, accepted weakening —
 * style injection can exfiltrate data through selectors — and it is scoped to
 * styles only. **Scripts get no such allowance.**
 *
 * `'unsafe-eval'` appears in development only, where Next's fast refresh needs
 * it. Shipping it to production would defeat most of the point of a script
 * policy.
 */
function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    `script-src 'self'${isProduction ? "" : " 'unsafe-eval' 'unsafe-inline'"}`,
    "style-src 'self' 'unsafe-inline'",
    // `blob:` covers a locally previewed upload before it is sent.
    `img-src 'self' data: blob: ${API_ORIGIN}`,
    "font-src 'self' data:",
    `connect-src 'self' ${API_ORIGIN}${isProduction ? "" : " ws: http://localhost:*"}`,
    // The product embeds nothing and is embedded nowhere.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // A form posting anywhere else is either a bug or an exfiltration attempt.
    "form-action 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

const config: NextConfig = {
  reactStrictMode: true,

  // Names the framework on every response, which narrows the set of CVEs worth
  // trying against it. It buys nothing.
  poweredByHeader: false,

  // The shared contracts package ships TypeScript-compiled CJS from the
  // workspace; Next needs to be told to transpile it rather than treat it as a
  // prebuilt external.
  transpilePackages: ["@kinder/contracts"],

  // Sent on every response. The API sets its own; these cover the pages.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          // A kindergarten portfolio needs none of these.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // ★ HSTS in production only. On plain-http localhost it would pin the
          // developer's browser to HTTPS for two years and nothing on :3000
          // would load again until they cleared the HSTS store.
          ...(isProduction
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default config;
