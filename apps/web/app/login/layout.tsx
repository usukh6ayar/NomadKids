import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND, BRAND_LATIN } from "@/lib/vocabulary";

/**
 * Metadata for `/login`, which cannot declare its own.
 *
 * ★ `login/page.tsx` is a `"use client"` component, and Next only reads a
 * `metadata` export from a server one. A layout is the ordinary way round it,
 * and it is worth the file: this is the page a search for the product should
 * land on. `/` renders a redirect stub with nothing in it, so `/login` is the
 * only public URL that both describes the system and lets somebody in.
 *
 * ★★ The title says what the page is *for*, not what it is. "Нэвтрэх" alone is
 * the word on a thousand pages; naming the audience is what makes a result
 * worth clicking when it sits under a query for the brand.
 *
 * ★★★ The description opens with the verbs, not with "Хүүхдийн хөгжлийн" —
 * that spelling is a retired brand and `vocabulary.test.tsx` fails on it in
 * markup. It caught this sentence, which is what that test is for: a
 * description is markup a search engine prints, so a retired name here would
 * outlive every screen it was removed from.
 */
export const metadata: Metadata = {
  title: "Нэвтрэх",
  description:
    `${BRAND_LATIN} (${BRAND}) системд багш, эцэг эх, цэцэрлэгийн удирдлага нэвтрэх хуудас. ` +
    "Ажиглалт, явцын үнэлгээ, ирц, хоолны цэс, тайланг нэг дороос.",
  /*
   * ★ Canonical to `/`, not to itself — 2026-09-10.
   *
   * The root renders the same `PublicLanding` component now, so these two URLs
   * serve identical content. Two self-canonicals would ask Google to rank the
   * same page twice and let it pick; pointing both at `/` consolidates the
   * signal on the URL people actually link to and type, which is the one a
   * brand search should land on.
   *
   * `/login` keeps existing and keeps working — every invitation e-mail and
   * saved bookmark points here. It simply is not the canonical spelling of it.
   */
  alternates: { canonical: "/" },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
