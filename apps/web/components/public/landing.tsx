"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { primaryDashboardSchema, sessionSchema } from "@kinder/contracts";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Heart,
  LockKeyhole,
  Menu,
  Sparkles,
  UserRound,
  Users,
  X,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { get, mutate } from "@/lib/api/browser";
import { rememberCsrfToken } from "@/lib/api/csrf";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { BRAND } from "@/lib/vocabulary";

const navigationItems = [
  { label: "Эхлэл", href: "#home" },
  { label: "Бүтээгдэхүүн", href: "#features" },
  { label: "Хэнд зориулагдсан", href: "#audiences" },
  { label: "Давуу тал", href: "#benefits" },
  { label: "Түгээмэл асуулт", href: "#faq" },
] as const;

const featureItems = [
  {
    icon: BookOpenCheck,
    title: "Өдөр тутмын мэдээлэл",
    copy: "Хүүхдийн ирц, хоол, үйл ажиллагаа, суралцах явцыг эцэг эхтэй нэг дороос хуваалцана.",
    tone: "bg-[#eaf6ff]",
    iconTone: "bg-[#d7efff] text-[#1686f5]",
  },
  {
    icon: Zap,
    title: "Багшийн хурдан бүртгэл",
    copy: "Өдөр тутмын ажлыг цөөн даралтаар хөтөлж, багшийн цагийг хүүхдэд зориулах боломж бүрдүүлнэ.",
    tone: "bg-[#eafaf2]",
    iconTone: "bg-[#d8f5e6] text-[#26ad70]",
  },
  {
    icon: BarChart3,
    title: "Цэцэрлэгийн удирдлага",
    copy: "Бүх үйл ажиллагаа, тайлан, төлбөр, мэдээллийг нэгтгэн бодит өгөгдөлд суурилан удирдана.",
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
    copy: "Төлбөр, орлого, зарлага, нэхэмжлэхийн бүртгэлийг нэг дор удирдана.",
  },
] as const;

const benefitItems = [
  {
    icon: Heart,
    title: "Илүү аюулгүй орчин",
    copy: "Хүүхдийн мэдээлэл найдвартай хамгаалагдана.",
    tone: "bg-[#ffe9ec] text-[#ef6674]",
  },
  {
    icon: Sparkles,
    title: "Илүү аз жаргалтай хүүхэд",
    copy: "Ахиц, хэрэгцээг нь өдөр тутам анзаарна.",
    tone: "bg-[#fff4d5] text-[#e6ae28]",
  },
  {
    icon: Users,
    title: "Илүү бүтээмжтэй баг",
    copy: "Цаг хэмнэж, хамтын ажиллагааг сайжруулна.",
    tone: "bg-[#e8f3ff] text-[#3c8de8]",
  },
  {
    icon: BarChart3,
    title: "Илүү сайн удирдлага",
    copy: "Өгөгдөлд суурилсан зөв шийдвэр гаргана.",
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
      "Зөвшөөрөгдсөн байгууллага батлагдсан endpoint, эрхийн хүрээнд мэдээлэл татаж, ирц зэрэг утгыг шалгасны дараа илгээнэ.",
  },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="#home" className="inline-flex items-center gap-2" aria-label={`${BRAND} нүүр`}>
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-control bg-white p-0.5 shadow-sm">
        <Image
          src="/brand-mark.png"
          alt=""
          width={40}
          height={29}
          className="w-full object-contain"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-title font-extrabold leading-none text-[#123d73]">{BRAND}</span>
        {!compact ? (
          <span className="mt-1 block text-caption font-medium text-slate-500">
            Хүүхдийн хөгжил, жаргалтай мөч бүр
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function HeroBrand() {
  return (
    <div className="flex flex-col items-center text-center">
      <Image
        src="/brand-logo.png"
        alt="Бяцхан нүүдэлчид"
        width={1400}
        height={1400}
        priority
        sizes="(max-width: 1023px) 132px, 168px"
        className="size-[132px] object-contain lg:size-[168px]"
      />
      <p className="-mt-2 text-compact font-extrabold text-[#54a9fb] sm:text-body lg:mt-2 lg:text-lead">
        Цэцэрлэгийн ухаалаг цахим систем
      </p>
      <p className="my-1.5 scale-125 bg-gradient-to-r from-[#0758c8] via-[#596fe5] to-[#ba55df] bg-clip-text text-figure font-black leading-none tracking-[-0.055em] text-transparent lg:my-3 lg:scale-150">
        NomadKids
      </p>
      <p className="mt-1 text-compact font-black uppercase tracking-[-0.02em] text-[#5779e4] sm:text-body lg:text-lead">
        Цахимжуулах цогц шийдэл
      </p>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-caption font-bold uppercase text-[#1686f5]">{eyebrow}</p>
      <h2 className="mt-2 text-heading font-extrabold leading-tight text-[#102f5d] sm:text-display">
        {title}
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-body leading-6 text-slate-500 sm:text-lead">
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
      className="w-full max-w-[420px] rounded-card border border-[#e2edf7] bg-white p-5 text-left shadow-[0_16px_45px_rgba(32,88,132,.12)] sm:p-6"
    >
      <h2 className="text-title font-extrabold text-[#173e70]">Системд нэвтрэх</h2>
      <p className="mt-1 text-caption leading-5 text-slate-500">
        Өөрийн эрхээр нэвтэрч, ажлаа үргэлжлүүлнэ үү.
      </p>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3" noValidate>
        <FormError
          message={
            login.isError && Object.keys(errors).length === 0 ? errorMessage(login.error) : null
          }
        />

        <Field
          label="Нэвтрэх нэр, утас эсвэл и-мэйл"
          error={errors.identifier}
          required
          className="[&>label]:sr-only"
        >
          {({ id, describedBy, invalid }) => (
            <div className="relative">
              <UserRound
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[17px] -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                name="identifier"
                autoComplete="username"
                autoCapitalize="none"
                placeholder="Нэвтрэх нэр"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                className="h-12 rounded-control border-[#dbe7f2] bg-[#f8fbff] pl-11 text-body"
              />
            </div>
          )}
        </Field>

        <Field label="Нууц үг" error={errors.password} required className="[&>label]:sr-only">
          {({ id, describedBy, invalid }) => (
            <div className="relative">
              <LockKeyhole
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[17px] -translate-y-1/2 text-slate-400"
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
                className="h-12 rounded-control border-[#dbe7f2] bg-[#f8fbff] pl-11 text-body"
              />
            </div>
          )}
        </Field>

        <Button
          type="submit"
          block
          disabled={login.isPending}
          className="mt-1 h-12 rounded-control bg-[#2588ed] text-body font-bold text-white shadow-[0_8px_20px_rgba(37,136,237,.22)] hover:bg-[#1477da]"
        >
          {login.isPending ? "Нэвтэрч байна…" : "Нэвтрэх"}
        </Button>
      </form>

      <div className="mt-2 text-center">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center text-caption font-semibold text-[#2588ed] hover:underline"
        >
          Нууц үгээ мартсан?
        </Link>
      </div>

      <p className="mt-3 hidden border-t border-[#edf2f7] pt-3 text-center text-caption leading-5 text-slate-500 lg:block">
        Нэвтрэхдээ{" "}
        <Link href="/terms" className="font-semibold text-[#2588ed] hover:underline">
          Үйлчилгээний нөхцөл
        </Link>{" "}
        болон{" "}
        <Link href="/privacy" className="font-semibold text-[#2588ed] hover:underline">
          Нууцлалын бодлоготой
        </Link>{" "}
        танилцана уу.
      </p>
    </div>
  );
}

function DashboardPreview({ variant }: { variant: "teacher" | "admin" | "child" }) {
  const title =
    variant === "teacher"
      ? "Сайн байна уу, Саруул багш"
      : variant === "admin"
        ? "Нэгдсэн тайлан"
        : "Хүүхдийн мэдээлэл";

  return (
    <div className="min-h-[245px] overflow-hidden rounded-control border border-[#e5edf6] bg-white p-3 shadow-[0_12px_35px_rgba(25,72,111,.1)]">
      <div className="flex items-center justify-between border-b border-[#edf2f7] pb-2.5">
        <Brand compact />
        <span className="size-7 rounded-pill bg-[#ffedbe]" />
      </div>
      <div className="flex gap-3 pt-3">
        <div className="hidden w-14 shrink-0 space-y-2 sm:block">
          {[80, 55, 70, 48, 64, 58].map((width) => (
            <span
              key={width}
              className="block h-1.5 rounded-pill bg-[#e5edf6]"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-bold text-[#173e70]">{title}</p>
          {variant === "child" ? (
            <div className="mt-3 grid grid-cols-[72px_1fr] gap-2.5">
              <div className="grid place-items-center rounded-control bg-[#fff5dd]">
                <Users className="size-9 text-[#efa91f]" />
              </div>
              <div className="space-y-2 rounded-control bg-[#f7faff] p-3">
                <span className="block h-2.5 w-20 rounded-pill bg-[#dbe8f7]" />
                <span className="block h-2 w-full rounded-pill bg-[#e8eff7]" />
                <span className="block h-2 w-4/5 rounded-pill bg-[#e8eff7]" />
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <span className="h-10 rounded-control bg-[#e7f7ef]" />
                  <span className="h-10 rounded-control bg-[#fff0e8]" />
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {["#4a94ed", "#f39191", "#76c794", "#f1bf55"].map((color, index) => (
                  <div
                    key={color}
                    className="rounded-control p-2"
                    style={{ backgroundColor: `${color}18` }}
                  >
                    <span className="block text-body font-bold" style={{ color }}>
                      {[24, 3, 18, 2][index]}
                    </span>
                    <span
                      className="mt-1 block h-1 w-5 rounded-pill"
                      style={{ backgroundColor: `${color}55` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-[1.2fr_.8fr] gap-2.5">
                <div className="flex h-24 items-end gap-2 rounded-control bg-[#f7faff] p-3">
                  {[38, 62, 47, 77, 60, 86].map((height) => (
                    <span
                      key={height}
                      className="flex-1 rounded-t bg-[#65a8f3]"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
                <div className="grid place-items-center rounded-control bg-[#f8fbff]">
                  <div className="grid size-16 place-items-center rounded-pill bg-[conic-gradient(#4a94ed_0_44%,#6dc99a_44%_72%,#f0c66b_72%)]">
                    <span className="grid size-10 place-items-center rounded-pill bg-white text-caption font-bold text-[#173e70]">
                      92%
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
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

          <a
            href="#login-card"
            className="hidden min-h-11 items-center rounded-control bg-[#2588ed] px-6 text-body font-bold text-white shadow-sm transition-colors hover:bg-[#1477da] lg:inline-flex"
          >
            Нэвтрэх
          </a>

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
              className="mt-1 inline-flex min-h-11 items-center justify-center rounded-control bg-[#2588ed] px-5 text-white"
            >
              Нэвтрэх
            </a>
          </nav>
        ) : null}
      </header>

      <section
        id="home"
        data-testid="login-hero"
        className="relative isolate min-h-dvh bg-[#f1f9ff] bg-[url('/background/login-mobile.png')] bg-cover bg-top bg-no-repeat px-5 pb-[42vw] pt-[7vw] sm:px-8 lg:min-h-[calc(100dvh-70px)] lg:bg-[url('/background/login-desktop.png')] lg:px-[7vw] lg:pb-8 lg:pt-8"
      >
        <div className="relative mx-auto grid w-full max-w-[1680px] items-start gap-y-7 lg:grid-cols-[440px_minmax(0,1fr)] lg:gap-x-[7vw] xl:grid-cols-[480px_minmax(0,1fr)]">
          <div className="order-1 flex justify-center lg:order-2 lg:pt-0 xl:pt-2">
            <HeroBrand />
          </div>

          <div className="order-2 mx-auto w-full max-w-[420px] lg:order-1 lg:mx-0 lg:pt-[7vh]">
            <Link
              href="/register"
              className="mb-3 flex min-h-11 items-center justify-center text-body font-extrabold text-[#1686f5] hover:underline lg:justify-end lg:pr-1 lg:text-lead"
            >
              Байгууллагын бүртгэл
            </Link>
            <div className="rounded-card bg-[#eaf7ff]/80 p-2.5 shadow-[0_18px_55px_rgba(48,107,153,.08)] backdrop-blur-[2px]">
              <LoginCard />
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="px-5 py-16 sm:px-8 sm:py-20">
        <SectionHeading
          eyebrow="Бүтээгдэхүүн"
          title={`${BRAND} гэж юу вэ?`}
          copy="Цэцэрлэг, сургуулийн өдөр тутмын үйл ажиллагааг хялбар, ил тод, үр дүнтэй болгох цогц веб систем."
        />
        <div className="mx-auto mt-9 grid max-w-[1100px] gap-4 md:grid-cols-3">
          {featureItems.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className={`rounded-control p-6 ${item.tone}`}>
                <span
                  className={`grid size-12 place-items-center rounded-control ${item.iconTone}`}
                >
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-lead font-extrabold text-[#173e70]">{item.title}</h3>
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

      <section id="system-preview" className="px-5 py-16 sm:px-8 sm:py-20">
        <SectionHeading
          eyebrow="Харагдац"
          title="Системийн интерфэйс"
          copy="Энгийн, ойлгомжтой, өдөр бүр хэрэглэхэд эвтэйхэн."
        />
        <div className="mx-auto mt-9 grid max-w-[1180px] gap-5 md:grid-cols-3">
          <DashboardPreview variant="teacher" />
          <DashboardPreview variant="admin" />
          <DashboardPreview variant="child" />
        </div>
      </section>

      <section id="benefits" className="bg-[#fbfdff] px-5 py-16 sm:px-8 sm:py-20">
        <SectionHeading
          eyebrow={`Яагаад ${BRAND}`}
          title="Хүүхэд бүрд илүү сайн ирээдүй"
          copy="Жижиг өөрчлөлтүүд том боломжуудыг бүтээнэ."
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
              Өнөөдрөөс илүү ойр байцгаая
            </h2>
            <p className="mt-3 text-body leading-6 text-slate-600">
              {BRAND} системд нэгдэж, хүүхэд бүрийн гэрэлт ирээдүйг хамтдаа бүтээлцээрэй.
            </p>
            <a
              href="#login-card"
              className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-control bg-[#2588ed] px-7 text-body font-bold text-white shadow-sm hover:bg-[#1477da]"
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
            <a href="mailto:Nomadkidsmn@gmail.com">Холбоо барих</a>
          </nav>
        </div>
        <div className="mx-auto mt-7 flex max-w-[1180px] flex-col items-center justify-between gap-2 border-t border-[#edf2f7] pt-5 text-caption text-slate-400 sm:flex-row">
          <span>© 2026 {BRAND}. Бүх эрх хуулиар хамгаалагдсан.</span>
          <span>Хүүхэд бүрийн гэрэлт ирээдүйн төлөө.</span>
        </div>
      </footer>
    </main>
  );
}
