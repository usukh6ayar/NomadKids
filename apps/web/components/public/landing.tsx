"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { primaryDashboardSchema, sessionSchema } from "@kinder/contracts";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Heart,
  LockKeyhole,
  Mail,
  Menu,
  Phone,
  Sparkles,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { get, mutate } from "@/lib/api/browser";
import { rememberCsrfToken } from "@/lib/api/csrf";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { BRAND_LATIN } from "@/lib/vocabulary";
import { CONTACT } from "@/lib/contact";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { FacebookIcon } from "@/components/ui/facebook-icon";
import { BrandWordmark } from "@/components/ui/brand-wordmark";
import { InstallAppCard } from "@/components/public/install-app";

const navigationItems = [
  { label: "Эхлэл", href: "#home" },
  { label: "Бүтээгдэхүүн", href: "#features" },
  { label: "Хэнд зориулагдсан", href: "#audiences" },
  { label: "Давуу тал", href: "#benefits" },
  { label: "Түгээмэл асуулт", href: "#faq" },
] as const;

/**
 * The menu above the login card — 2026-10-08, the client: "нэвтрэх хэсгийн
 * дээр 3 зураас … Байгууллагын бүртгэл, Үнийн санал, Түгээмэл асуулт,
 * Нууцлалын бодлого, Үйлчилгээний нөхцөл, Холбоо барих".
 *
 * ★ «Үнийн санал» is `/pricing`; «Холбоо барих» opens a small window with
 * the phone, e-mail and Facebook (`lib/contact.ts`) — 2026-10-08, the client.
 */
const loginMenuItems = [
  { label: "Байгууллагын бүртгэл", href: "/register" },
  // The price sheet's own page since 2026-10-08.
  { label: "Үнийн санал", href: "/pricing" },
  { label: "Түгээмэл асуулт", href: "/faq" },
  { label: "Нууцлалын бодлого", href: "/privacy" },
  { label: "Үйлчилгээний нөхцөл", href: "/terms" },
  // Opens `ContactDialog` rather than going anywhere.
  { label: "Холбоо барих", href: null },
] as const;

/**
 * ★ In the preschool curriculum's own words (СӨБ: суралцагч, цахим хувийн
 * хавтас, явцын ба үр дүнгийн үнэлгээ, сургалтын 7 чиглэл, А/79 шалгуур) and
 * only what the system does — 2026-10-08, the client.
 */
const featureItems = [
  {
    icon: BookOpenCheck,
    title: "Хөгжлийн явцын мэдээлэл",
    copy: "Суралцагчийн ажиглалт, ярилцлага, бүтээл, ирц, хоолыг цахим хувийн хавтсаар эцэг эхтэй хуваалцана.",
    tone: "bg-[#eaf6ff]",
    iconTone: "bg-[#d7efff] text-[#1686f5]",
  },
  {
    icon: Zap,
    title: "Хялбар явцын үнэлгээ",
    copy: "Багш сургалтын 7 чиглэлээр тэмдэглэлээ хөтөлж, А/79 шалгууртай цөөн даралтаар холбоно.",
    tone: "bg-[#eafaf2]",
    iconTone: "bg-[#d8f5e6] text-[#26ad70]",
  },
  {
    icon: BarChart3,
    title: "Үр дүнд суурилсан удирдлага",
    copy: "Явцын ба үр дүнгийн үнэлгээ, ирц, санхүүжилтийн нэгдсэн тайлангаар цэцэрлэгээ удирдана.",
    tone: "bg-[#fff3e9]",
    iconTone: "bg-[#ffe5d0] text-[#f37d35]",
  },
] as const;

const audienceItems = [
  {
    imageSrc: "/illustrations/audience-teacher.png",
    imageAlt: "Багш",
    title: "Багшийн веб",
    copy: "Өдрийн тайлан, ирц, хүүхдийн хөгжил, эцэг эхтэй харилцах ажлыг хялбарчилна.",
  },
  {
    imageSrc: "/illustrations/audience-parent.png",
    imageAlt: "Эцэг эх хүүхдийн хамт",
    title: "Эцэг эхийн веб",
    copy: "Хүүхдийн ирц, хоол, хөгжлийн мэдээлэл болон цэцэрлэгийн мэдэгдлийг нэг дороос харна.",
  },
  {
    imageSrc: "/illustrations/audience-management.png",
    imageAlt: "Удирдлагын ажилтан",
    title: "Удирдлагын самбар",
    copy: "Бүх бүлгийн нэгтгэл, тайлан, гүйцэтгэлийг бодит хугацаанд хянана.",
  },
  {
    imageSrc: "/illustrations/audience-cook.png",
    imageAlt: "Тогооч",
    title: "Гал тогооны веб",
    copy: "Өдрийн цэс, порц, харшлын анхааруулга, зарцуулалтыг хөтөлнө.",
  },
  {
    imageSrc: "/illustrations/audience-accountant.png",
    imageAlt: "Нягтлан бодогч",
    title: "Нягтлангийн веб",
    copy: "Нэхэмжлэл, төлбөр, санхүүжилт, тайлангаа нэг дор удирдана.",
  },
] as const;

const benefitItems = [
  {
    icon: Heart,
    title: "Аюулгүй орчин",
    copy: "Хүүхдийн мэдээлэл эрхийн хяналттай, найдвартай хамгаалагдана.",
    tone: "bg-[#ffe9ec] text-[#ef6674]",
  },
  {
    icon: Sparkles,
    title: "Хүүхэд бүрийн хөгжил",
    copy: "Хүүхэд бүрийн ахиц, хэрэгцээг өдөр бүр анзаарч дэмжинэ.",
    tone: "bg-[#fff4d5] text-[#e6ae28]",
  },
  {
    icon: Users,
    title: "Бүтээмжтэй хамт олон",
    copy: "Бичиг цаасны ажлыг багасгаж, хамтын ажиллагааг дэмжинэ.",
    tone: "bg-[#e8f3ff] text-[#3c8de8]",
  },
  {
    icon: BarChart3,
    title: "Өгөгдөлд суурилсан удирдлага",
    copy: "Бодит мэдээлэлд тулгуурлан оновчтой шийдвэр гаргана.",
    tone: "bg-[#fff0df] text-[#ee9631]",
  },
] as const;

const landingFaqItems = [
  {
    question: "Эцэг эх ямар мэдээлэл харах вэ?",
    answer:
      "Зөвхөн өөртэй нь баталгаажуулан холбосон хүүхдийн ирц, хоол, хөгжлийн мэдээлэл болон цэцэрлэгийн мэдэгдлийг харна.",
  },
  {
    question: "Хүүхдийн мэдээлэл хэрхэн хамгаалагдах вэ?",
    answer:
      "Байгууллага, үүрэг, бүлэг, хүүхдийн хамаарлаар эрхийг хязгаарлаж, чухал үйлдлийг аудитын мөрөөр бүртгэнэ.",
  },
  {
    question: "ESIS-тэй мэдээлэл солилцох уу?",
    answer:
      "Тийм. Зөвшөөрөгдсөн цэцэрлэг ESIS-ээс өөрт олгогдсон эрхийн хүрээнд мэдээлэл татаж, ирц зэрэг мэдээллийг шалгасны дараа илгээнэ.",
  },
] as const;

function Brand(_props: { compact?: boolean }) {
  return (
    <Link
      href="#home"
      className="inline-flex items-center gap-2"
      aria-label={`${BRAND_LATIN} нүүр`}
    >
      {/* The whole artwork, lettering included — see `app-shell.tsx`. The box is
          square because the supplied file is, and `object-contain` keeps the
          lettering under the drawing rather than cropping it away. */}
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-control bg-white p-0.5 shadow-sm">
        <Image
          src="/brand-logo.png"
          alt=""
          width={44}
          height={44}
          className="size-full object-contain"
        />
      </span>
      {/* ★ No tagline under it since 2026-10-02 — the client removed
          "Хүүхдийн хөгжил, жаргалтай мөч бүр" from the front door. */}
      <span className="min-w-0">
        <BrandWordmark className="block text-title" />
      </span>
    </Link>
  );
}

/**
 * The logo and the product's name, beside the login card.
 *
 * ★ 2026-10-02, to the client's drawing: the logo, then «Цэцэрлэгийн ухаалаг
 * цахим систем» above a large NomadKids and «Цахимжуулах цогц шийдэл» under
 * its right edge. The headline and the line beneath it
 * ("Хүүхдийн хөгжил, жаргалтай мөч бүр", "Багш, эцэг эх, цэцэрлэгийн багийг
 * нэг орчинд холбосон NomadKids.") were removed at their request.
 */
function HeroBrand() {
  return (
    <div className="flex w-full max-w-[560px] flex-col items-center text-center">
      <Image
        src="/brand-logo.png"
        alt="Бяцхан нүүдэлчид"
        width={1400}
        height={1400}
        priority
        sizes="(max-width: 1023px) 116px, 148px"
        className="size-[116px] object-contain lg:size-[148px]"
      />
      <div className="mt-6 inline-flex flex-col">
        {/* ★ Colours measured off the client's drawing, 2026-10-02. */}
        <p className="self-start text-body font-bold text-[#5b9cf0] lg:text-lead">
          Цэцэрлэгийн ухаалаг цахим систем
        </p>
        <h1 className="-mt-1">
          <BrandWordmark className="from-[#1f45a6] via-[#5a58c4] to-[#a35fd8] text-figure-lg leading-none sm:text-hero" />
        </h1>
        <p className="self-end text-body font-extrabold uppercase tracking-wide text-[#5b63c8] lg:text-lead">
          Цахимжуулах цогц шийдэл
        </p>
      </div>
      <InstallAppCard className="mt-6 max-w-[420px]" />
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  copy,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  /** Smaller type — the «Яагаад» section since 2026-10-08 ("жижиг бич"). */
  compact?: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-caption font-bold uppercase text-[#1686f5]">{eyebrow}</p>
      <h2
        className={
          compact
            ? "mt-2 text-lead font-extrabold leading-tight text-[#102f5d] sm:text-title"
            : "mt-2 text-heading font-extrabold leading-tight text-[#102f5d] sm:text-display"
        }
      >
        {title}
      </h2>
      <p
        className={
          compact
            ? "mx-auto mt-2 max-w-2xl text-caption leading-5 text-slate-500 sm:text-body"
            : "mx-auto mt-3 max-w-2xl text-body leading-6 text-slate-500 sm:text-lead"
        }
      >
        {copy}
      </p>
    </div>
  );
}

function LoginCard() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: async () => {
      const session = await mutate("/auth/login", sessionSchema, {
        method: "POST",
        body: { identifier, password },
      });
      rememberCsrfToken(session.csrfToken);
      return get("/dashboard/primary", primaryDashboardSchema);
    },
    onSuccess: async (primary) => {
      await queryClient.invalidateQueries({ queryKey: qk.session() });
      const from = params.get("from");
      const safeFrom = from && from.startsWith("/") && !from.startsWith("//") ? from : null;

      if (safeFrom) {
        router.replace(safeFrom);
        return;
      }

      router.replace(
        primary.dashboard === "platform"
          ? "/platform"
          : primary.dashboard === "admin"
            ? "/admin"
            : primary.dashboard === "teacher"
              ? "/dashboard"
              : // The screen each support role exists for. Neither can open
                // `/dashboard` — every widget on it is about children — so
                // sending them there would meet a permission wall on the first
                // screen after signing in. The cook has its own `/kitchen/dashboard`
                // instead (`app/(app)/layout.tsx`'s `supportNav`), not `/dashboard`.
                primary.dashboard === "cook"
                ? "/kitchen/dashboard"
                : // ★ `/finance/dashboard` since 2026-09-09, not `/finance`.
                  // The accountant's own board — what came in, what is unpaid,
                  // and what needs a decision today. `/finance` is the
                  // state-funding register beneath it.
                  primary.dashboard === "accountant"
                  ? "/finance/dashboard"
                  : primary.dashboard === "parent"
                    ? "/home"
                    : "/no-access",
      );
    },
  });

  const errors = fieldErrors(login.error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!login.isPending) login.mutate();
  }

  return (
    <div
      id="login-card"
      className="w-full max-w-[400px] scroll-mt-24 overflow-hidden rounded-card border border-white/80 bg-white/95 p-5 text-left shadow-[0_24px_70px_rgba(25,72,111,.16)] backdrop-blur-xl sm:p-6"
    >
      <h2 className="text-lead font-bold leading-tight tracking-tight text-[#2f6fd6]">
        Системд нэвтрэх
      </h2>
      <p className="mt-0.5 text-caption leading-4 text-[#8a93a3]">
        Өөрийн эрхээр нэвтэрч, ажлаа үргэлжлүүлнэ үү.
      </p>

      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3" noValidate>
        <FormError
          message={
            login.isError && Object.keys(errors).length === 0 ? errorMessage(login.error) : null
          }
        />

        <Field
          label="Утасны дугаар эсвэл нэвтрэх нэр"
          labelHidden
          error={errors.identifier}
          required
        >
          {({ id, describedBy, invalid }) => (
            <div className="relative">
              <UserRound
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[17px] -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                name="identifier"
                autoComplete="username"
                autoCapitalize="none"
                placeholder="Утас эсвэл нэвтрэх нэр"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                className="h-12 rounded-control border-border bg-canvas pl-11 text-body transition-colors focus:bg-white"
              />
            </div>
          )}
        </Field>

        <Field label="Нууц үг" labelHidden error={errors.password} required>
          {({ id, describedBy, invalid }) => (
            <div className="relative">
              <LockKeyhole
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[17px] -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                name="password"
                autoComplete="current-password"
                placeholder="Нууц үг"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 rounded-control border-border bg-canvas pl-11 text-body transition-colors focus:bg-white"
              />
            </div>
          )}
        </Field>

        {/*
          ★ **The button's own colour, 2026-09-22.**

          It was `bg-[#176ac2]` hovering to `#115aa8` — a blue the rest of the
          product does not have. `--color-primary` is `#1d4ed8`, the E-Mongolia
          blue the palette was repainted to on 2026-08-23 precisely so that one
          file decides it, and this was the front door disagreeing with every
          screen behind it. Dropping the override is the fix; `Button` already
          paints primary, and its hover comes from `--color-primary-hover`.

          The lift and the shadow stay — they are this card's elevation, not its
          hue, and `globals.css` deliberately keeps no shadow token.
        */}
        <Button
          type="submit"
          block
          disabled={login.isPending}
          className="mt-1 h-12 rounded-control bg-[#4585e6] text-body font-bold shadow-[0_10px_24px_rgba(69,133,230,.28)] transition-all hover:-translate-y-0.5 hover:bg-[#3a78d8] hover:shadow-[0_14px_26px_rgba(69,133,230,.32)]"
        >
          {login.isPending ? "Нэвтэрч байна…" : "Нэвтрэх"}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center text-caption font-semibold text-[#4a8ae8] hover:underline"
        >
          Нууц үгээ мартсан?
        </Link>
        {/*
          ★ "Байгууллагын бүртгэл" above is a director applying to onboard a
          whole kindergarten (`/register`, `docs/CONTRACT_ONBOARDING.md`). This
          is a teacher who already has a kindergarten and a code to enter
          (`/staff-register`). Both land near the login card, so the label
          names who it is for — a director and a teacher pressing
          same-looking links here would each land on the other's form.
        */}
        <Link
          href="/staff-register"
          className="inline-flex min-h-11 items-center text-caption font-semibold text-[#4a8ae8] hover:underline"
        >
          Багш, ажилтан бүртгүүлэх
        </Link>
      </div>

      <p className="mt-3 hidden border-t border-border pt-4 text-center text-caption leading-5 text-muted lg:block">
        Нэвтрэхдээ{" "}
        <Link href="/terms" className="font-semibold text-[#4a8ae8] hover:underline">
          Үйлчилгээний нөхцөл
        </Link>{" "}
        болон{" "}
        <Link href="/privacy" className="font-semibold text-[#4a8ae8] hover:underline">
          Нууцлалын бодлоготой
        </Link>{" "}
        танилцана уу.
      </p>
    </div>
  );
}

/**
 * The public landing page — the marketing shell *and* the login card.
 *
 * ★ Moved out of `app/login/page.tsx` on 2026-09-10 so that `/` can render it
 * too, and the reason is a sentence from Google Search Console: the root URL
 * came back **"Crawled – currently not indexed"**. It was a client-side
 * redirect stub, so a crawler fetched it, found a loading spinner and nothing
 * else, and declined. Meanwhile this — nav, hero, features, audiences,
 * benefits, FAQ, 66 KB of it — was sitting one route away.
 *
 * ★★ One component, two routes, rather than a copy. The alternative was a
 * second marketing page written for search engines, which is the arrangement
 * where the two drift and the public one stops matching the product.
 */
export function PublicLanding() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <main className="min-h-dvh overflow-hidden bg-white text-[#173e70]">
      <header className="sticky top-0 z-50 hidden border-b border-[#e8f0f7] bg-white/95 px-4 backdrop-blur sm:px-6 lg:block">
        <div className="mx-auto flex h-[70px] max-w-[1180px] items-center justify-between gap-4">
          <Brand />

          <nav
            aria-label="Үндсэн цэс"
            className="hidden items-center gap-6 text-body font-semibold lg:flex"
          >
            {navigationItems.map(({ label, href }) => (
              <a key={label} href={href} className="transition-colors hover:text-[#1686f5]">
                {label}
              </a>
            ))}
          </nav>

          {/* «Нэвтрэх», then ☰ in the corner — 2026-10-08. */}
          <div className="hidden items-center gap-2 lg:flex">
            <a
              href="#login-card"
              className="hidden min-h-11 items-center rounded-control bg-[#4585e6] px-6 text-body font-bold text-white shadow-sm transition-colors hover:bg-[#3a78d8] lg:inline-flex"
            >
              Нэвтрэх
            </a>
            <LoginMenu />
          </div>

          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="grid size-11 place-items-center rounded-control text-[#173e70] transition-colors hover:bg-[#eef7ff] lg:hidden"
            aria-label={isMenuOpen ? "Цэс хаах" : "Цэс нээх"}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-navigation"
          >
            {isMenuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>

        {isMenuOpen ? (
          <nav
            id="mobile-navigation"
            aria-label="Гар утасны үндсэн цэс"
            className="mx-auto mb-4 flex max-w-[1180px] flex-col gap-1 rounded-control border border-[#e5edf7] bg-white p-2 text-body font-semibold shadow-lg lg:hidden"
          >
            {navigationItems.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                onClick={() => setIsMenuOpen(false)}
                className="rounded-control px-4 py-3 hover:bg-[#edf6ff] hover:text-[#1686f5]"
              >
                {label}
              </a>
            ))}
            <a
              href="#login-card"
              onClick={() => setIsMenuOpen(false)}
              className="mt-1 inline-flex min-h-11 items-center justify-center rounded-control bg-[#4585e6] px-5 text-white"
            >
              Нэвтрэх
            </a>
          </nav>
        ) : null}
      </header>

      <section
        id="home"
        data-testid="login-hero"
        className="relative isolate min-h-dvh bg-[#f1f9ff] bg-[url('/background/login-mobile.png')] bg-cover bg-top bg-no-repeat px-5 pb-[45vw] pt-20 sm:px-8 lg:min-h-[calc(100dvh-70px)] lg:bg-[url('/background/login-desktop.png')] lg:px-[7vw] lg:pb-8 lg:pt-20"
      >
        {/*
          ☰ in the screen's top-right corner — 2026-10-08, the client: "бүр
          баруун дээд буланд". On a phone the page header is hidden, so it sits
          here; on a desktop it is the header's last item instead.
        */}
        <div className="absolute right-2 top-2 z-20 lg:hidden">
          <LoginMenu />
        </div>
        {/* «Боловсролын яамны системтэй холбогдсон» — 2026-10-08, the client. */}
        <div className="absolute left-3 top-3 z-20">
          <EsisBadge />
        </div>
        <div className="relative mx-auto grid w-full max-w-[1320px] items-start gap-y-7 lg:grid-cols-[minmax(380px,420px)_minmax(0,1fr)] lg:gap-x-[7vw]">
          <div className="order-1 flex justify-center lg:order-2 lg:pt-4">
            <HeroBrand />
          </div>

          <div className="order-2 mx-auto w-full max-w-[400px] lg:order-1 lg:mx-0">
            <LoginCard />
          </div>
        </div>
      </section>

      <section id="features" className="px-5 py-16 sm:px-8 sm:py-20">
        <SectionHeading
          eyebrow="Бүтээгдэхүүн"
          title={`${BRAND_LATIN} гэж юу вэ?`}
          copy="Цэцэрлэг, сургуулийн өдөр тутмын үйл ажиллагааг хялбар, ил тод, үр дүнтэй болгох цогц веб систем."
        />
        <div className="mx-auto mt-9 grid max-w-[1100px] gap-4 md:grid-cols-3">
          {featureItems.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className={`rounded-control p-6 ${item.tone}`}>
                {/* The icon on the title's row — 2026-10-08, the client. */}
                <div className="flex items-center gap-3">
                  <span
                    className={`grid size-12 shrink-0 place-items-center rounded-control ${item.iconTone}`}
                  >
                    <Icon className="size-6" aria-hidden="true" />
                  </span>
                  <h3 className="text-lead font-extrabold leading-tight text-[#173e70]">
                    {item.title}
                  </h3>
                </div>
                <p className="mt-2 text-body leading-6 text-slate-600">{item.copy}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="audiences" className="bg-[#fbfdff] px-5 py-16 sm:px-8 sm:py-20">
        <SectionHeading
          eyebrow="Бүх хэрэглэгчид"
          title="Бүх оролцогчдод зориулсан шийдэл"
          copy="Тус бүрийн хэрэгцээнд тохирсон, хэрэглэхэд хялбар бөгөөд үр дүнтэй ажлын орчин."
        />

        <div className="mx-auto mt-9 grid max-w-[1180px] grid-cols-2 items-stretch gap-x-3 gap-y-7 sm:gap-x-5 sm:gap-y-9 lg:grid-cols-5">
          {audienceItems.map((item) => (
            <article
              key={item.title}
              className="flex w-full min-w-0 flex-col text-center last:col-span-2 last:max-w-[190px] last:justify-self-center lg:last:col-span-1 lg:last:max-w-none"
            >
              <div className="relative z-10 mx-auto aspect-square w-[78%] max-w-[190px]">
                <Image
                  src={item.imageSrc}
                  alt={item.imageAlt}
                  fill
                  sizes="(max-width: 639px) 38vw, (max-width: 1023px) 190px, 180px"
                  className={
                    item.imageAlt === "Багш"
                      ? "origin-bottom scale-[.94] object-contain object-bottom"
                      : "object-contain object-bottom"
                  }
                />
              </div>
              <div className="flex flex-1 flex-col rounded-card border border-[#e8eef5] bg-white px-3 pb-5 pt-7 shadow-sm sm:px-5 sm:pb-6 sm:pt-8">
                <h3 className="text-body font-extrabold leading-5 text-[#173e70] sm:text-lead">
                  {item.title}
                </h3>
                <p className="mt-2 text-caption leading-5 text-slate-500 sm:text-body">
                  {item.copy}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="benefits" className="bg-[#fbfdff] px-5 py-16 sm:px-8 sm:py-20">
        <SectionHeading
          eyebrow={`Яагаад ${BRAND_LATIN}`}
          // The client's wording, small — 2026-10-08.
          title="Хүүхдийн хөгжилд хүн бүрийн оролцоо чухал"
          copy="Хүүхэд, багшид ээлтэй, аюулгүй цахим сувагт тавтай морил"
          compact
        />
        <div className="mx-auto mt-9 grid max-w-[1050px] gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {benefitItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="flex gap-3 lg:block lg:text-center">
                <span
                  className={`grid size-11 shrink-0 place-items-center rounded-pill ${item.tone} lg:mx-auto`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-body font-extrabold text-[#173e70] lg:mt-3">{item.title}</h3>
                  <p className="mt-1 text-caption leading-5 text-slate-500">{item.copy}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section id="faq" className="border-t border-[#edf2f7] px-5 py-16 sm:px-8 sm:py-20">
        <SectionHeading
          eyebrow="Тусламж"
          title="Түгээмэл асуулт"
          copy="Нэвтрэлт, мэдээллийн хамгаалалт болон ESIS холболтын үндсэн хариултууд."
        />
        <div className="mx-auto mt-9 grid max-w-[1050px] gap-x-8 gap-y-7 md:grid-cols-3">
          {landingFaqItems.map((item) => (
            <article key={item.question} className="border-t-2 border-[#8fcaff] pt-4">
              <h3 className="text-lead font-extrabold leading-6 text-[#173e70]">{item.question}</h3>
              <p className="mt-2 text-body leading-6 text-slate-600">{item.answer}</p>
            </article>
          ))}
        </div>
        <div className="mt-9 text-center">
          <Link
            href="/faq"
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-[#cfe1f1] px-5 text-body font-bold text-[#1677d2] hover:bg-[#eef7ff]"
          >
            Бүх асуулт, хариултыг харах <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>

      <section className="px-5 py-10 sm:px-8 sm:py-14">
        <div className="relative mx-auto min-h-[250px] max-w-[1180px] overflow-hidden rounded-control bg-[#eaf6ff] px-6 py-8 sm:px-10 lg:flex lg:min-h-[230px] lg:items-center">
          <div className="relative z-10 max-w-[570px] text-center lg:text-left">
            <h2 className="text-heading font-extrabold leading-tight text-[#173e70] sm:text-display">
              Хүүхдийн хөгжлийг хамтдаа дэмжье
            </h2>
            <p className="mt-3 text-body leading-6 text-slate-600">
              {BRAND_LATIN} системд нэгдэж, хүүхэд бүрийн өсөлт, хөгжлийг нэг дороос хамтдаа
              хөтлөөрэй.
            </p>
            <a
              href="#login-card"
              className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-control bg-[#4585e6] px-7 text-body font-bold text-white shadow-sm hover:bg-[#3a78d8]"
            >
              Нэвтрэх <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </div>
          <div className="relative mx-auto mt-4 aspect-[4/3] w-full max-w-[330px] lg:absolute lg:-bottom-16 lg:right-4 lg:mt-0 lg:w-[360px]">
            <Image
              src="/illustrations/nomadkids-cta-children.png"
              alt="Од руу зааж буй хоёр хүүхэд"
              fill
              sizes="(max-width: 1023px) 330px, 360px"
              className="object-contain"
            />
          </div>
        </div>
      </section>

      <footer id="contact" className="border-t border-[#e8eff6] bg-white px-5 pb-10 pt-8 sm:px-8">
        <div className="mx-auto flex max-w-[1180px] flex-col items-center justify-between gap-7 text-center md:flex-row md:text-left">
          <Brand />
          <nav className="flex flex-wrap justify-center gap-x-5 gap-y-3 text-caption text-slate-500">
            <Link href="/register">Байгууллагын бүртгэл</Link>
            <a href="#features">Бүтээгдэхүүн</a>
            <a href="#audiences">Хэнд зориулагдсан</a>
            <Link href="/faq">Түгээмэл асуулт</Link>
            <Link href="/privacy">Нууцлалын бодлого</Link>
            <Link href="/terms">Үйлчилгээний нөхцөл</Link>
          </nav>
        </div>
        {/* Холбоо барих — 2026-10-08, the client. */}
        <address className="mx-auto mt-6 flex max-w-[1180px] flex-wrap items-center justify-center gap-x-6 gap-y-2 text-caption not-italic text-slate-600 md:justify-start">
          <span className="font-semibold text-[#173e70]">Холбоо барих</span>
          <a
            href={CONTACT.phoneHref}
            className="inline-flex min-h-10 items-center gap-1.5 hover:text-[#1686f5]"
          >
            <Phone className="size-4" aria-hidden /> {CONTACT.phone}
          </a>
          <a
            href={CONTACT.emailHref}
            className="inline-flex min-h-10 items-center gap-1.5 hover:text-[#1686f5]"
          >
            <Mail className="size-4" aria-hidden /> {CONTACT.email}
          </a>
          <a
            href={CONTACT.facebook}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-1.5 hover:text-[#1686f5]"
          >
            <FacebookIcon className="size-4" /> Facebook
          </a>
        </address>
        <div className="mx-auto mt-7 flex max-w-[1180px] flex-col items-center justify-between gap-2 border-t border-[#edf2f7] pt-5 text-caption text-slate-400 sm:flex-row">
          <span>© 2026 {BRAND_LATIN}. Бүх эрх хуулиар хамгаалагдсан.</span>
          <span>Хүүхэд бүрийн гэрэлт ирээдүйн төлөө.</span>
        </div>
      </footer>
    </main>
  );
}

/**
 * ☰ above the login card, opening `loginMenuItems`. On every width: the
 * page's own header is desktop-only, so on a phone this is the one menu.
 * Closes on a choice, on Escape and on a press outside it.
 */
function LoginMenu() {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPress = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Цэс хаах" : "Цэс нээх"}
        aria-expanded={open}
        aria-controls="login-menu"
        className="grid size-11 place-items-center rounded-control text-[#3f86ef] transition-colors hover:bg-white/70"
      >
        {open ? (
          <X className="size-6" aria-hidden="true" />
        ) : (
          <Menu className="size-6" aria-hidden="true" />
        )}
      </button>
      {open ? (
        <nav
          id="login-menu"
          aria-label="Нэвтрэх хэсгийн цэс"
          className="absolute right-0 top-12 z-20 flex w-60 flex-col rounded-control border border-[#e5edf7] bg-white p-1.5 text-body font-semibold text-[#173e70] shadow-lg"
        >
          {loginMenuItems.map(({ label, href }) =>
            href === null ? (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setOpen(false);
                  setContact(true);
                }}
                className="rounded-control px-3.5 py-2.5 text-left hover:bg-[#edf6ff] hover:text-[#1686f5]"
              >
                {label}
              </button>
            ) : href.startsWith("/") ? (
              <Link
                key={label}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-control px-3.5 py-2.5 hover:bg-[#edf6ff] hover:text-[#1686f5]"
              >
                {label}
              </Link>
            ) : (
              <a
                key={label}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-control px-3.5 py-2.5 hover:bg-[#edf6ff] hover:text-[#1686f5]"
              >
                {label}
              </a>
            ),
          )}
        </nav>
      ) : null}
      {contact ? <ContactDialog onClose={() => setContact(false)} /> : null}
    </div>
  );
}

/**
 * Холбоо барих in a small window — 2026-10-08, the client: "3 зураасны холбоо
 * барих дээр дарахаар жижиг цонх дээр холбоо барих хэсгүүд гарч болох уу".
 * Escape, × and a press on the backdrop close it (`ModalOverlay`).
 */
function ContactDialog({ onClose }: { onClose: () => void }) {
  const rows = [
    {
      icon: <Phone className="size-5" aria-hidden />,
      label: "Утас",
      value: CONTACT.phone,
      href: CONTACT.phoneHref,
    },
    {
      icon: <Mail className="size-5" aria-hidden />,
      label: "Мэйл",
      value: CONTACT.email,
      href: CONTACT.emailHref,
    },
    {
      icon: <FacebookIcon className="size-5" />,
      label: "Facebook",
      value: "Facebook хуудас",
      href: CONTACT.facebook,
      external: true,
    },
  ];
  return (
    <ModalOverlay label="Холбоо барих" onClose={onClose}>
      <div className="relative w-full max-w-[340px] rounded-card bg-white p-5 text-left shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className="absolute right-2 top-2 grid size-10 place-items-center rounded-pill text-slate-500 hover:bg-slate-100 hover:text-[#173e70]"
        >
          <X className="size-5" aria-hidden />
        </button>
        <h2 className="text-lead font-extrabold text-[#102f5d]">Холбоо барих</h2>
        <ul className="mt-3 flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.label}>
              <a
                href={row.href}
                {...(row.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="flex min-h-12 items-center gap-3 rounded-control px-2 hover:bg-[#edf6ff]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-[#edf6ff] text-[#3f86ef]">
                  {row.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-caption text-slate-500">{row.label}</span>
                  <span className="block truncate text-body font-semibold text-[#173e70]">
                    {row.value}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </ModalOverlay>
  );
}

/**
 * ESIS-тэй холбогдсон — the badge in the hero's top-left corner, and how a
 * kindergarten asks to be connected — 2026-10-08, the client.
 *
 * ★ The steps are how the connection really works (`docs/ESIS_COMPLIANCE.md`):
 * one platform-wide ESIS permission serves every kindergarten, and the
 * platform team links each to its ESIS institution number and runs a test
 * pull before groups and children are pulled from ESIS. Nothing a director
 * can switch on alone, so the window ends in the phone and e-mail.
 */
function EsisBadge() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/*
        «ESIS-тэй холбогдох», «Боловсролын яам» barely there above it, and no
        icon — 2026-10-08, the client.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-col rounded-control bg-white/80 px-3 py-1.5 text-left leading-tight shadow-sm ring-1 ring-[#dbe8fb] backdrop-blur hover:bg-white"
      >
        <span className="text-compact text-slate-400">Боловсролын яам</span>
        <span className="text-caption font-bold text-[#1d4fa8]">ESIS-тэй холбогдох</span>
      </button>
      {open ? <EsisDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const ESIS_STEPS = [
  {
    title: "Байгууллагаа бүртгүүлнэ",
    text: "«Байгууллагын бүртгэл»-ээр гэрээний хүсэлт илгээнэ.",
  },
  {
    title: "ESIS-ийн дугаараа бэлдэнэ",
    text: "ESIS дахь цэцэрлэгийнхээ байгууллагын дугаарыг тодруулна.",
  },
  {
    title: "Холболтын хүсэлт гаргана",
    text: "Доорх утас эсвэл мэйлээр холбогдож, дугаараа илгээнэ.",
  },
  {
    title: "Бид холбоод шалгана",
    text: "Туршилтын татан авалт хийсний дараа бүлэг, суралцагчаа ESIS-ээс татна.",
  },
] as const;

function EsisDialog({ onClose }: { onClose: () => void }) {
  return (
    <ModalOverlay label="ESIS-тэй холбогдох" onClose={onClose}>
      <div className="relative w-full max-w-[380px] rounded-card bg-white p-5 text-left shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className="absolute right-2 top-2 grid size-10 place-items-center rounded-pill text-slate-500 hover:bg-slate-100 hover:text-[#173e70]"
        >
          <X className="size-5" aria-hidden />
        </button>
        <h2 className="pr-8 text-lead font-extrabold leading-tight text-[#102f5d]">
          ESIS-тэй холбогдох
        </h2>
        <p className="mt-2 text-caption leading-5 text-slate-600">
          {BRAND_LATIN} нь Боловсролын яамны ESIS системтэй холбогдсон. Холболт хийлгэвэл
          цэцэрлэгийн бүлэг, суралцагчийн мэдээллийг ESIS-ээс татна.
        </p>
        <ol className="mt-3 flex flex-col gap-2">
          {ESIS_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-pill bg-[#3f86ef] text-compact font-bold text-white">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-body font-semibold text-[#173e70]">{step.title}</span>
                <span className="block text-caption text-slate-500">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <a
            href={CONTACT.phoneHref}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-pill bg-[#3f86ef] px-3 text-body font-bold text-white hover:bg-[#2f76df]"
          >
            <Phone className="size-4" aria-hidden /> {CONTACT.phone}
          </a>
          <a
            href={`${CONTACT.emailHref}?subject=${encodeURIComponent("ESIS холболтын хүсэлт")}`}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-pill bg-[#edf6ff] px-3 text-body font-bold text-[#1d4fa8] hover:bg-[#e0eefe]"
          >
            <Mail className="size-4" aria-hidden /> Мэйл бичих
          </a>
        </div>
      </div>
    </ModalOverlay>
  );
}
