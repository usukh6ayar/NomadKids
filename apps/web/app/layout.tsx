import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "NomadKids",
  description: "Хүүхдийн хөгжлийн цахим хавтас",
};

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
