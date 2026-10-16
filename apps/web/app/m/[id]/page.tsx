import type { Metadata } from "next";
import { SharedMaterial } from "@/components/materials/shared-material";
import { PublicFooter, PublicHeader } from "@/components/public/public-info-shell";
import { apiFetch } from "@/lib/api/client";
import { materialPrice, publicMaterialSchema } from "@/lib/materials";
import { BRAND } from "@/lib/vocabulary";

/** A teaching material's shareable page — 2026-10-14, the user. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const material = await apiFetch(`/public/materials/${id}`, publicMaterialSchema);
    const price = materialPrice(material.price);
    const kind = material.fileType === "PPT" ? "PowerPoint" : "PDF";
    const description = `${price} · ${kind} · ${material.area}${
      material.level ? ` · ${material.level} түвшин` : ""
    }${material.description ? ` — ${material.description}` : ""}`;
    const cover = material.previewUrl ?? material.previewUrls[0];
    const images = cover ? [{ url: cover, alt: material.title }] : undefined;

    return {
      title: `${material.title} — ${BRAND}`,
      description,
      openGraph: {
        type: "article",
        title: material.title,
        description,
        images,
      },
      twitter: {
        card: images ? "summary_large_image" : "summary",
        title: material.title,
        description,
        images,
      },
    };
  } catch {
    return {
      title: `Сургалтын хэрэглэгдэхүүн — ${BRAND}`,
      description: "Багш нарт зориулсан бэлэн үзүүлэн, хичээл.",
    };
  }
}

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
