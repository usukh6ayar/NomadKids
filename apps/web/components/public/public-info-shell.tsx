import { ChevronLeft, Mail, Phone } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND_LATIN } from "@/lib/vocabulary";
import { CONTACT } from "@/lib/contact";
import { FacebookIcon } from "@/components/ui/facebook-icon";
import { BrandWordmark } from "@/components/ui/brand-wordmark";

const PUBLIC_LINKS = [
  { href: "/privacy", label: "Нууцлал" },
  { href: "/terms", label: "Үйлчилгээний нөхцөл" },
  { href: "/faq", label: "Түгээмэл асуулт" },
] as const;

export function PublicInfoShell({
  eyebrow,
  title,
  description,
  updatedAt,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-white text-[#173e70]">
      <PublicHeader />

      <main>
        <section className="border-b border-[#dceaf5] bg-[#eef9ff] px-5 py-12 sm:px-8 sm:py-16">
          <div className="mx-auto max-w-[880px]">
            <p className="text-caption font-bold uppercase text-[#1686f5]">{eyebrow}</p>
            <h1 className="mt-2 max-w-[22ch] text-display font-extrabold leading-tight text-[#102f5d] sm:text-figure">
              {title}
            </h1>
            <p className="mt-4 max-w-[70ch] text-body leading-7 text-slate-600 sm:text-lead">
              {description}
            </p>
            <p className="mt-5 text-caption font-medium text-slate-500">Шинэчилсэн: {updatedAt}</p>
          </div>
        </section>

        <div className="mx-auto max-w-[880px] px-5 py-10 sm:px-8 sm:py-14">
          <div className="public-copy">{children}</div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

export function PublicNotice({ children }: { children: ReactNode }) {
  return (
    <aside className="mb-2 border-l-4 border-[#2588ed] bg-[#eef7ff] px-5 py-4 text-body leading-7 text-slate-700 [&_a]:font-semibold [&_a]:text-[#1679d8] [&_a]:underline">
      {children}
    </aside>
  );
}

export function PublicSection({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[#e8eff6] py-8 last:border-b-0">
      <h2 className="text-title font-extrabold text-[#173e70]">
        <span className="mr-2 text-[#2588ed]">{number}.</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-body leading-7 text-slate-600 [&_a]:font-semibold [&_a]:text-[#1679d8] [&_a]:underline [&_a]:underline-offset-2 [&_li]:pl-1 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  );
}

/** ‹ and the logo — every public information page's header, `/pricing` too. */
export function PublicHeader() {
  return (
    <header className="border-b border-[#e5edf6] bg-white px-4 sm:px-6">
      {/*
      ‹ and the logo, nothing else — 2026-10-08, the client: the row of
      Нууцлал · Үйлчилгээний нөхцөл · Түгээмэл асуулт · Нэвтрэх went, and
      an arrow back to the home page took its place. The same links stay
      in the footer.
    */}
      <div className="mx-auto flex min-h-[68px] max-w-[1080px] items-center gap-1 py-3">
        <Link
          href="/"
          aria-label="Нүүр хуудас руу буцах"
          className="-ml-2 grid size-11 shrink-0 place-items-center rounded-control text-[#173e70] hover:bg-[#eef7ff]"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2.5"
          aria-label={`${BRAND_LATIN} нүүр`}
        >
          {/* The whole artwork, lettering included — see `app-shell.tsx`. */}
          <span className="grid size-[52px] shrink-0 place-items-center">
            <Image
              src="/brand-logo.png"
              alt=""
              width={52}
              height={52}
              className="size-full object-contain"
            />
          </span>
          <BrandWordmark className="text-lead" />
        </Link>
      </div>
    </header>
  );
}

/** Contact, the public links and the copyright — shared like the header. */
export function PublicFooter() {
  return (
    <footer className="border-t border-[#e8eff6] bg-[#fbfdff] px-5 py-8 sm:px-8">
      <div className="mx-auto flex max-w-[1080px] flex-col justify-between gap-5 sm:flex-row sm:items-center">
        <div>
          <BrandWordmark className="text-lead" />
          {/* Холбоо барих — 2026-10-08, the client (`lib/contact.ts`). */}
          <address className="mt-2 flex flex-col text-caption not-italic text-slate-600">
            <a
              href={CONTACT.phoneHref}
              className="inline-flex min-h-10 items-center gap-2 hover:text-[#1686f5]"
            >
              <Phone size={16} aria-hidden /> {CONTACT.phone}
            </a>
            <a
              href={CONTACT.emailHref}
              className="inline-flex min-h-10 items-center gap-2 hover:text-[#1686f5]"
            >
              <Mail size={16} aria-hidden /> {CONTACT.email}
            </a>
            <a
              href={CONTACT.facebook}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-2 hover:text-[#1686f5]"
            >
              <FacebookIcon className="size-4" /> Facebook
            </a>
          </address>
        </div>
        <nav
          aria-label="Доод цэс"
          className="flex flex-wrap gap-x-5 gap-y-2 text-caption font-semibold text-slate-600"
        >
          {PUBLIC_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="min-h-10 content-center hover:text-[#1686f5]"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <p className="mx-auto mt-5 max-w-[1080px] border-t border-[#e8eff6] pt-5 text-caption text-slate-400">
        © 2026 {BRAND_LATIN}. Бүх эрх хуулиар хамгаалагдсан.
      </p>
    </footer>
  );
}
