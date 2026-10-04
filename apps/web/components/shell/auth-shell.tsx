import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, LockKeyhole, ShieldCheck } from "lucide-react";
import { BrandWordmark } from "@/components/ui/brand-wordmark";
import { BRAND } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type AuthShellProps = {
  children: ReactNode;
  /** Longer application forms get a little more horizontal breathing room. */
  wide?: boolean;
};

/**
 * Shared signed-out shell for registration, invitations and token resets.
 *
 * The public login owns a full marketing page, while these task-focused routes
 * need a calm place to finish one job. They still share the same classroom,
 * clouds, colour and wordmark so following a link never feels like leaving the
 * product. The illustration is part of the background on desktop; on a phone
 * it is deliberately omitted so a long form never pays a screenful of art
 * before reaching its submit button.
 */
export function AuthShell({ children, wide = false }: AuthShellProps) {
  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-[#eef8ff] text-ink">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 hidden bg-[url('/background/login-desktop.png')] bg-cover bg-center bg-no-repeat lg:block"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_8%_8%,rgba(255,255,255,.95),transparent_34%),radial-gradient(circle_at_88%_12%,rgba(208,231,255,.65),transparent_30%)] lg:bg-[linear-gradient(90deg,rgba(238,248,255,.98)_0%,rgba(238,248,255,.92)_46%,rgba(238,248,255,.12)_70%)]"
      />

      <header className="mx-auto flex w-full max-w-[1320px] items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-10 lg:py-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2.5"
          aria-label={`${BRAND} нүүр`}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-control bg-white/90 p-0.5 shadow-sm ring-1 ring-white">
            <Image
              src="/brand-logo.png"
              alt=""
              width={44}
              height={44}
              className="size-full object-contain"
              priority
            />
          </span>
          <BrandWordmark className="hidden text-title sm:block" />
        </Link>

        <Link
          href="/login"
          className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-white/80 px-4 text-body font-bold text-primary-strong shadow-sm ring-1 ring-white/90 backdrop-blur hover:bg-white"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Нэвтрэх
        </Link>
      </header>

      <div
        className={cn(
          "mx-auto grid w-full max-w-[1320px] items-start gap-10 px-5 pb-10 pt-2 sm:px-8 sm:pb-14 lg:grid-cols-[minmax(0,560px)_minmax(320px,1fr)] lg:px-10 lg:pb-16 lg:pt-4",
          wide && "lg:grid-cols-[minmax(0,680px)_minmax(300px,1fr)]",
        )}
      >
        <main
          className={cn(
            "w-full rounded-card border border-white/90 bg-white/95 p-5 shadow-[0_28px_80px_rgba(42,93,132,.16)] backdrop-blur-xl [overflow-wrap:anywhere] sm:p-8 lg:p-9",
            wide ? "max-w-[680px]" : "max-w-[560px]",
          )}
        >
          {children}

          <div className="mt-7 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-border pt-5 text-caption text-muted">
            <span className="inline-flex items-center gap-1.5">
              <LockKeyhole className="size-3.5 text-primary" aria-hidden="true" />
              Аюулгүй нэвтрэлт
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
              Мэдээлэл хамгаалагдсан
            </span>
          </div>
          <nav
            aria-label="Нууцлал ба тусламж"
            className="mt-2 flex flex-wrap justify-center gap-x-4 text-caption font-semibold text-primary"
          >
            <Link href="/privacy" className="min-h-10 content-center hover:underline">
              Нууцлал
            </Link>
            <Link href="/terms" className="min-h-10 content-center hover:underline">
              Үйлчилгээний нөхцөл
            </Link>
            <Link href="/faq" className="min-h-10 content-center hover:underline">
              Тусламж
            </Link>
          </nav>
        </main>

        <aside
          className="hidden min-h-[560px] flex-col items-center pt-10 text-center lg:flex"
          aria-hidden="true"
        >
          <div className="rounded-card border border-white/70 bg-white/52 px-8 py-7 shadow-[0_20px_60px_rgba(42,93,132,.09)] backdrop-blur-md">
            <span className="mx-auto grid size-16 place-items-center rounded-control bg-white shadow-sm">
              <Image
                src="/brand-logo.png"
                alt=""
                width={64}
                height={64}
                className="size-full object-contain"
              />
            </span>
            <p className="mt-5 text-heading font-extrabold leading-tight text-[#173e70]">
              Хүүхэд бүрийн хөгжлийн түүх
            </p>
            <p className="mx-auto mt-2 max-w-[34ch] text-body leading-6 text-slate-600">
              Багш, эцэг эх, цэцэрлэгийн багийг нэг аюулгүй орчинд холбоно.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-caption font-semibold text-[#3f6f9f]">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/85 px-3 py-2">
                <CheckCircle2 className="size-4 text-[#31a875]" /> Бүх дэлгэцэд тохирно
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/85 px-3 py-2">
                <CheckCircle2 className="size-4 text-[#31a875]" /> Хэрэглэхэд хялбар
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
