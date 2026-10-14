import type { Metadata } from "next";
import { SharedMaterial } from "@/components/materials/shared-material";
import { PublicFooter, PublicHeader } from "@/components/public/public-info-shell";
import { BRAND } from "@/lib/vocabulary";

/** A teaching material's shareable page — 2026-10-14, the user. */
export const metadata: Metadata = {
  title: `Сургалтын хэрэглэгдэхүүн — ${BRAND}`,
  description: "Багш нарт зориулсан бэлэн үзүүлэн, хичээл.",
};

export default function SharedMaterialPage() {
  return (
    <div className="min-h-dvh bg-white">
      <PublicHeader />
      <main className="mx-auto w-full max-w-[720px] px-4 py-6">
        <SharedMaterial />
      </main>
      <PublicFooter />
    </div>
  );
}
