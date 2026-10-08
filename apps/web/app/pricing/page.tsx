import type { Metadata } from "next";
import { PublicFooter, PublicHeader } from "@/components/public/public-info-shell";
import { PricingContent } from "@/components/public/pricing";
import { BRAND } from "@/lib/vocabulary";

// `canonical` and the brand-free title, as the other public pages — see
// `app/faq/page.tsx`.
export const metadata: Metadata = {
  title: "Үнийн санал",
  description: `${BRAND} — хүүхэд, багш, цэцэрлэгийн багцын үнэ, улирлаар болон жилээр.`,
  alternates: { canonical: "/pricing" },
};

/** Үнийн санал — the client's price sheet, 2026-10-08 (`lib/pricing.ts`). */
export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-white">
      <PublicHeader />
      <PricingContent />
      <PublicFooter />
    </div>
  );
}
