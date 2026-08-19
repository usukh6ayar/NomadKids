import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "NomadKids",
  description: "Хүүхдийн хөгжлийн цахим хавтас",
};

/**
 * ★ Every page is rendered per request.
 *
 * The CSP in `middleware.ts` carries a per-request nonce, and a nonce only
 * reaches the HTML if that HTML is generated per request. A statically
 * pre-rendered page was built before any nonce existed, so Next's inline
 * bootstrap script ships without one — the browser then blocks it and
 * hydration dies with React error #412: the page paints, and nothing responds
 * to a click.
 *
 * That is exactly what the first deployed build did. Setting it here rather
 * than page by page means a new route cannot quietly reintroduce it.
 *
 * The cost is nil in practice: every screen but login and password-reset is
 * authenticated and personalised, so none of them were cacheable anyway.
 */
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout. The three audience shells — (teacher), (parent), (admin) — are
 * route groups nested under this and arrive with their features.
 * docs/UI_UX_MAP.md §2.
 *
 * `lang="mn"`: all user-facing text is Mongolian, and screen readers need to
 * know which language to pronounce.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="mn">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
