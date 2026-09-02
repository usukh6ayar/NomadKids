import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/vocabulary";

/**
 * The web app manifest — what Android and Chrome read when someone adds the
 * site to their home screen.
 *
 * ★ **`display: "standalone"`, not `"fullscreen"`.** A teacher marking
 * attendance on a phone needs the clock and the battery indicator; a register
 * is filled in at the door, in a hurry, and hiding the status bar to gain
 * 24 pixels is the wrong trade. CLAUDE.md §5 — mobile-first.
 *
 * ★★ **Two icon purposes, two different files.** Android crops a `maskable`
 * icon to whatever shape the launcher uses — a circle on most devices — and it
 * only guarantees the inner 80%. `pwa-512.png` fills its square, so a circular
 * crop would cut the arc off at both ends; `pwa-maskable-512.png` is the same
 * mark drawn smaller inside the safe zone. Declaring one file as both is the
 * common mistake and it shows up only on a real handset.
 *
 * The icons are opaque. A transparent PNG here is composited onto black by
 * some launchers, which turns the two faces into a floating sticker.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND,
    short_name: BRAND,
    description: "Цэцэрлэгийн хүүхдийн хөгжлийн цахим бүртгэл.",
    lang: "mn",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    /*
     * ★ No `orientation`. Declaring `"portrait"` would lock an installed app to
     * portrait, and the attendance journal is a wide table with a sticky name
     * column — a teacher with a tablet in a stand is the case it was drawn for.
     * Leaving the field out lets the device decide, which is what every screen
     * in the product already assumes: `display: "standalone"` and CLAUDE.md §5's
     * mobile-first rule are unaffected either way.
     */
    background_color: "#ffffff",
    // --color-primary. The same blue the shell uses, so the splash screen and
    // the Android task-switcher bar do not announce a different product.
    theme_color: "#1d4ed8",
    icons: [
      { src: "/icons/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
