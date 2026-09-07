import { join } from "node:path";
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

  /**
   * ★ A self-contained server bundle, for the VPS image.
   *
   * Without this, running Next in a container means copying the whole
   * `node_modules` — a workspace install of several hundred megabytes, most of
   * it build tooling the server never calls. `standalone` traces what the
   * server actually imports and writes a `server.js` beside it.
   *
   * Vercel supplies its own Next build adapter and does not use this bundle.
   * Next 16.3 also fails its `onBuildComplete` hook when an adapter and
   * `standalone` are enabled together because the adapter deliberately omits
   * `next-server.js.nft.json` while the standalone copier still reads it.
   * Keep standalone for Docker/VPS builds and let Vercel use its native output.
   */
  output: process.env.VERCEL ? undefined : "standalone",

  /**
   * ★★ The monorepo root, not `apps/web`.
   *
   * Tracing stops at the package root by default, and this app imports
   * `@kinder/contracts` from `packages/`. Without this the standalone bundle is
   * built successfully and then crashes on the first request with
   * `Cannot find module '@kinder/contracts'` — a failure that appears only in
   * the container, never in `next dev`.
   */
  outputFileTracingRoot: join(import.meta.dirname, "..", ".."),

  /**
   * ★★★ `@swc/helpers/esm/**` — files Next needs at runtime and the trace misses.
   *
   * The trace resolves `@swc/helpers` through its CJS entry, so only `cjs/` is
   * copied into the standalone bundle. At runtime Next's own `require-hook.js`
   * asks for `esm/_interop_require_default.js`, which is not there, and the
   * container dies on boot with a `MODULE_NOT_FOUND` naming a path deep inside
   * `.pnpm/` — an error that says nothing about tracing.
   *
   * The image **built successfully** with this missing. Only running it found
   * the fault, which is why `docs/VPS_DEPLOYMENT.md` §3.4 says to watch the
   * logs rather than trust a green build.
   *
   * The version is a wildcard on purpose: pinning `@swc+helpers@0.5.23` would
   * silently stop matching on the next `pnpm update`, and the failure would
   * come back looking new.
   */
  outputFileTracingIncludes: {
    "/**": ["../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/esm/**/*"],
  },

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
