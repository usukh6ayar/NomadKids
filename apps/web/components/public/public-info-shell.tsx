import { ArrowLeft, Mail } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/vocabulary";

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
      <header className="border-b border-[#e5edf6] bg-white px-4 sm:px-6">
        <div className="mx-auto flex min-h-[68px] max-w-[1080px] flex-wrap items-center justify-between gap-3 py-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-2.5"
            aria-label={`${BRAND} нүүр`}
          >
            <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-control border border-[#e5edf6] bg-white p-0.5">
              <Image
                src="/mark.png"
                alt=""
                width={40}
                height={29}
                className="w-full object-contain"
              />
            </span>
            <span className="text-lead font-extrabold text-[#123d73]">{BRAND}</span>
          </Link>

          <nav
            aria-label="Нийтийн мэдээлэл"
            className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-caption font-semibold text-slate-600"
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
            <Link
              href="/login"
              className="inline-flex min-h-10 items-center rounded-control bg-[#2588ed] px-4 text-white hover:bg-[#1477da]"
            >
              Нэвтрэх
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b border-[#dceaf5] bg-[#eef9ff] px-5 py-12 sm:px-8 sm:py-16">
          <div className="mx-auto max-w-[880px]">
            <Link
              href="/login"
              className="inline-flex min-h-10 items-center gap-2 text-body font-semibold text-[#2588ed] hover:underline"
            >
              <ArrowLeft size={17} aria-hidden /> Нэвтрэх хуудас
            </Link>
            <p className="mt-5 text-caption font-bold uppercase text-[#1686f5]">{eyebrow}</p>
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

      <footer className="border-t border-[#e8eff6] bg-[#fbfdff] px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-[1080px] flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <p className="font-bold text-[#173e70]">{BRAND}</p>
            <a
              href="mailto:Nomadkidsmn@gmail.com"
              className="mt-2 inline-flex min-h-10 items-center gap-2 text-caption text-slate-600 hover:text-[#1686f5]"
            >
              <Mail size={16} aria-hidden /> Nomadkidsmn@gmail.com
            </a>
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
          © 2026 {BRAND}. Бүх эрх хуулиар хамгаалагдсан.
        </p>
      </footer>
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
