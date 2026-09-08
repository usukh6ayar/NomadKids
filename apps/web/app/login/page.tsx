"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { primaryDashboardSchema, sessionSchema } from "@kinder/contracts";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Calculator,
  ChefHat,
  GraduationCap,
  Heart,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Sparkles,
  Stethoscope,
  UserRound,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
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

const audienceItems: ReadonlyArray<{
  icon: LucideIcon;
  title: string;
  copy: string;
  tone: string;
}> = [
  {
    icon: GraduationCap,
    title: "Багшийн веб",
    copy: "Өдрийн тайлан, ирц, хүүхдийн хөгжил, эцэг эхтэй харилцах ажлыг хялбарчилна.",
    tone: "bg-[#fff8d9] text-[#d99c13]",
  },
  {
    icon: LayoutDashboard,
    title: "Удирдлагын самбар",
    copy: "Бүх бүлгийн нэгтгэл, тайлан, гүйцэтгэлийг бодит хугацаанд хянана.",
    tone: "bg-[#e9f5ff] text-[#2388e8]",
  },
  {
    icon: Calculator,
    title: "Нягтлангийн веб",
    copy: "Төлбөр, орлого, зарлага, нэхэмжлэхийн бүртгэлийг нэг дор удирдана.",
    tone: "bg-[#eafaf2] text-[#26ad70]",
  },
  {
    icon: ChefHat,
    title: "Гал тогооны веб",
    copy: "Өдрийн цэс, порц, харшлын анхааруулга, зарцуулалтыг хөтөлнө.",
    tone: "bg-[#fff0e9] text-[#ef7646]",
  },
  {
    icon: Stethoscope,
    title: "Эмчийн веб",
    copy: "Хүүхдийн эрүүл мэнд, үзлэг, зөвлөгөөний түүхийг найдвартай хадгална.",
    tone: "bg-[#f1edff] text-[#7969d6]",
  },
];

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
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-control bg-white shadow-sm">
        <Image
          src="/logo-transparent.png"
          alt=""
          width={48}
          height={48}
          className="size-full object-contain"
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
                : primary.dashboard === "accountant"
                  ? "/finance"
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
      className="w-full max-w-[390px] rounded-control border border-[#e2edf7] bg-white p-5 text-left shadow-[0_16px_45px_rgba(32,88,132,.12)] sm:p-6"
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

      <p className="mt-3 border-t border-[#edf2f7] pt-3 text-center text-caption leading-5 text-slate-500">
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

function LoginLanding() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <main className="min-h-dvh overflow-hidden bg-white text-[#173e70]">
      <header className="sticky top-0 z-50 border-b border-[#e8f0f7] bg-white/95 px-4 backdrop-blur sm:px-6">
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

      <section id="home" className="relative bg-[#eef9ff] px-5 py-10 sm:px-8 sm:py-14 lg:py-16">
        <div className="pointer-events-none absolute left-0 top-16 h-28 w-28 rounded-pill bg-white/55" />
        <div className="pointer-events-none absolute right-[8%] top-9 h-20 w-32 rounded-pill bg-white/50" />

        <div className="relative mx-auto grid max-w-[1180px] items-center gap-x-10 gap-y-7 lg:grid-cols-[420px_1fr] lg:grid-rows-[auto_auto]">
          <div className="text-center lg:col-start-1 lg:row-start-1 lg:text-left">
            <h1 className="text-figure font-black leading-[1.08] text-[#102f5d] sm:text-figure">
              Хүүхэд бүрийн өдөр тутмыг илүү ойрхон
            </h1>
            <p className="mx-auto mt-4 max-w-[46ch] text-body leading-6 text-slate-600 sm:text-lead lg:mx-0">
              {BRAND} нь цэцэрлэг, сургуулийн өдөр тутмын үйл ажиллагааг нэгтгэсэн, хүүхэд төвтэй
              удирдлагын веб систем юм.
            </p>
          </div>

          <div className="relative mx-auto aspect-[3/2] w-full max-w-[720px] lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <Image
              src="/illustrations/nomadkids-login-hero.png"
              alt="Багш дөрвөн хүүхдийн хамт цэцэрлэгийн гадаа инээмсэглэж байна"
              fill
              priority
              sizes="(max-width: 1023px) 100vw, 720px"
              className="object-contain"
            />
          </div>

          <div className="mx-auto w-full max-w-[390px] lg:col-start-1 lg:row-start-2 lg:mx-0 lg:mt-3">
            <LoginCard />
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

        <div className="relative mx-auto mt-6 aspect-[5/2] w-full max-w-[980px] sm:mt-8">
          <Image
            src="/illustrations/nomadkids-audience-roles.png"
            alt="Багш, захирал, нягтлан бодогч, тогооч, эмч"
            fill
            sizes="(max-width: 1023px) 100vw, 980px"
            className="object-contain"
          />
        </div>

        <div className="mx-auto mt-3 grid max-w-[1120px] grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          {audienceItems.map((item) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="rounded-control border border-[#e8eef5] bg-white p-4 text-center shadow-sm sm:p-5"
              >
                <span
                  className={`mx-auto grid size-10 place-items-center rounded-control ${item.tone}`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-3 text-body font-extrabold leading-5 text-[#173e70]">
                  {item.title}
                </h3>
                <p className="mt-2 text-caption leading-5 text-slate-500">{item.copy}</p>
              </article>
            );
          })}
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
              src="/illustrations/nomadkids-cta-boy.png"
              alt="Цаасан онгоц нисгэж буй хүүхэд"
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

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-white" />}>
      <LoginLanding />
    </Suspense>
  );
}
