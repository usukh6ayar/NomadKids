import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * ★ CSP is NOT set here — it lives in `middleware.ts`.
 *
 * A static header cannot carry a nonce, and a nonce is what lets Next's own
 * inline bootstrap script run under a policy that still refuses everything an
 * XSS might inject. Setting a second CSP here would not soften that one either:
 * when two Content-Security-Policy headers are present, a browser enforces both,
 * so the strictest wins and the nonce would be defeated.
 */
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
