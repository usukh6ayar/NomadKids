"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { primaryDashboardSchema, sessionSchema } from "@kinder/contracts";
import {
  ArrowRight,
  Award,
  BarChart3,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  FolderHeart,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MessageCircle,
  ShieldCheck,
  SunMedium,
  UserRound,
  Utensils,
  X,
} from "lucide-react";
import NextImage from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { mutate, get } from "@/lib/api/browser";
import { rememberCsrfToken } from "@/lib/api/csrf";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";

const navigationItems = [
  { label: "Нүүр", href: "#home" },
  { label: "Бүтээгдэхүүн", href: "#features" },
  { label: "Хэнд зориулагдсан", href: "#audiences" },
  { label: "Системийн харагдац", href: "#system-preview" },
  { label: "Байгууллагын бүртгэл", href: "/register" },
  { label: "Нууцлалын бодлого", href: "#benefits" },
  { label: "Тусламж", href: "#footer" },
  { label: "Холбоо барих", href: "#contact" },
] as const;

const features = [
  {
    icon: ShieldCheck,
    color: "bg-blue-100 text-blue-600",
    title: "Багш, эцэг эх, цэцэрлэгийг холбох аюулгүй орчин",
    desc: "Хүүхдийн зураг, хөгжлийн мэдээлэл болон өдөр тутмын үйл ажиллагааг олон нийтийн сүлжээ, нээлттэй группт байрлуулахгүйгээр NOMADKIDS системээр дамжуулан хуваалцана. Мэдээллийг зөвхөн эрх бүхий багш, эцэг эх, цэцэрлэгийн ажилтан харах боломжтой бөгөөд талууд аюулгүй, хяналттай орчинд шуурхай харилцана.",
  },
  {
    icon: CalendarCheck,
    color: "bg-emerald-100 text-emerald-600",
    title: "Хүүхдийн өдөр тутмын мэдээллийг нэг дороос",
    desc: "Ирц, хоолны цэс, мэдээ мэдээлэл, төлбөр болон цэцэрлэгийн бүртгэлийн түүхийг нэг системээс хялбархан харж, хянана.",
  },
  {
    icon: Award,
    color: "bg-purple-100 text-purple-600",
    title: "Явцын болон улирлын үнэлгээний цогц систем",
    desc: "Ажиглалт, ярилцлагын тэмдэглэл, хүүхдийн бүтээлд хийсэн дүн шинжилгээ болон хөгжлийн үнэлгээг цахимаар нэгтгэнэ. Ингэснээр хүүхдийн ахиц, өөрчлөлтийг бодит баримтад тулгуурлан үнэлж, эцэг эх явцын болон улирлын үнэлгээтэй танилцах боломжтой.",
  },
  {
    icon: FolderHeart,
    color: "bg-teal-100 text-teal-600",
    title: "Хүүхэд бүрийн цахим хөгжлийн хавтас",
    desc: "Хүүхдийн ажиглалт, зураг, бүтээл, үнэлгээ болон хөгжлийн түүхийг эмх цэгцтэй баримтжуулна. Хүүхэд бүрийн онцлог, ахиц болон хөгжлийн замналыг хүүхдийн хөгжлийн цахим хувийн хавтаснаас нэг дороос харах боломжтой.",
  },
  {
    icon: BarChart3,
    color: "bg-cyan-100 text-cyan-600",
    title: "Хөгжлийн судалгаа ба график тайлан",
    desc: "Хүүхдийн хөгжилтэй холбоотой судалгаа, асуумж болон санал хүсэлтийг эцэг эхээс цаг алдалгүй авна. Үр дүн болон хөгжлийн мэдээллийг график үзүүлэлттэй тайлангаар нэгтгэн харуулж, Excel болон PDF форматаар татах боломжтой.",
  },
  {
    icon: Utensils,
    color: "bg-orange-100 text-orange-600",
    title: "Хоолны цэс ба харшлын ухаалаг хяналт",
    desc: "Өдөр тутмын болон долоо хоногийн хоолны цэсийг бүртгэж, хүүхдийн харшлын мэдээлэлтэй тулган шалгана. Тохирохгүй орц илэрсэн үед урьдчилан анхааруулж, хооллолтын аюулгүй байдлыг дэмжинэ.",
  },
  {
    icon: MessageCircle,
    color: "bg-pink-100 text-pink-600",
    title: "Шуурхай мэдээлэл, идэвхтэй харилцаа",
    desc: "Ангийн самбараар зарлал, чухал мэдээ, зураг болон бусад мэдээллийг нийтэлж, эцэг эхэд шууд хүргэнэ. Ингэснээр мэдээлэл олон сувагт тарахгүй, талууд шуурхай, уялдаатай харилцана.",
  },
  {
    icon: LayoutDashboard,
    color: "bg-indigo-100 text-indigo-600",
    title: "Цэцэрлэгийн үйл ажиллагаа, санхүүгийн нэгдсэн удирдлага",
    desc: "Хүүхэд, бүлэг, багш ажилтан, хичээлийн жил, улирал, үнэлгээ, баримт бичиг, тайлан болон санхүүгийн мэдээллийг нэг системээр зохион байгуулна. Ирц, төлбөр, нэхэмжлэл болон холбогдох тооцооллыг уялдуулснаар давхар бүртгэл, гар ажиллагааг багасгана.",
  },
];

const audiences = [
  {
    image: "/icons/icon-kindergarten.png",
    title: "Удирдлага & Арга зүй",
    copy: "Бүлэг, хүүхэд, ажилтны бүртгэлийг нэгтгэн удирдах, ирц, хөгжлийн ахиц болон судалгааны тайланг бодит өгөгдөлд суурилан ил тод хянах.",
    tone: "from-[#e8f4ff] to-[#f6fbff]",
  },
  {
    image: "/icons/icon-teacher.png",
    title: "Багшийн веб",
    copy: "Өдөр тутмын ирц, цахим хувийн хавтас, явцын үнэлгээ, эцэг эхтэй харилцах болон судалгаа, тайланг хурдан бүртгэн цаг хэмнэх.",
    tone: "from-[#fff8d9] to-[#fffdf3]",
  },
  {
    image: "/background/mascot-family.webp",
    title: "Эцэг эхийн веб / Апп",
    copy: "Хүүхдийн ирц, хөгжлийн ахиц, явцын үнэлгээ, хоолны цэс, сургалтын мэдээлэл болон төлбөрийн нэхэмжлэлийг нэг дороос авах.",
    tone: "from-[#e4faf3] to-[#f6fffb]",
  },
  {
    image: "/icons/icon-finance.png",
    title: "Нягтлан бодогчийн веб",
    copy: "Төлбөр, нэхэмжлэх, eBarimt ба санхүүгийн бүртгэлийг хариуцлагатай хөтөлж, эцэг эхэд төлбөрийн мэдээллийг ойлгомжтой хүргэх.",
    tone: "from-[#fff0e9] to-[#fff9f6]",
  },
  {
    image: "/icons/icon-menu.png",
    title: "Гал тогооны веб/таблет",
    copy: "Өдрийн ирцэд суурилсан порц, цэс, тооцоог хөтлөх болон хүүхдийн харшил, онцгой хэрэгцээний тэмдэглэлийг аюулгүй мөрдөх.",
    tone: "from-[#f2ecff] to-[#fbf9ff]",
  },
];

function Brand({
  compact = false,
  tagline = "Хэрэгтэй мөч, нандин түүх",
  primaryLogo = false,
  name = "Nomad Kids",
}: {
  compact?: boolean;
  tagline?: string;
  primaryLogo?: boolean;
  name?: string;
}) {
  return (
    <Link href="/login" className="inline-flex items-center gap-2" aria-label={`${name} нүүр`}>
      {primaryLogo ? (
        <NextImage
          src="/logo.png"
          alt="NomadKids Logo"
          width={1071}
          height={1149}
          className={compact ? "h-6 w-auto object-contain" : "h-8 w-auto object-contain sm:h-10"}
        />
      ) : (
        <span className="grid size-9 place-items-center rounded-full bg-[#fff1a8] text-[#efa91f] sm:size-10">
          <SunMedium size={26} strokeWidth={2.2} aria-hidden="true" />
        </span>
      )}
      <span>
        <span className="block text-[17px] font-extrabold leading-none tracking-[-.025em] text-[#143d72] sm:text-[20px]">
          {name}
        </span>
        {!compact ? (
          <span className="mt-1 block text-[8px] font-medium tracking-[.01em] text-slate-500 sm:text-[9px]">
            {tagline}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 shrink-0" fill="currentColor">
      <path d="M13.6 21v-8h2.8l.4-3h-3.2V8.1c0-.9.3-1.5 1.6-1.5h1.7V3.9c-.8-.1-1.6-.2-2.4-.2-2.4 0-4.1 1.5-4.1 4.2V10H7.7v3h2.7v8h3.2Z" />
    </svg>
  );
}

function SectionHeading({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <h2 className="text-[clamp(1.65rem,3vw,2.35rem)] font-extrabold tracking-[-.035em] text-[#102f5d]">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">{copy}</p>
    </div>
  );
}

function FeaturesAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="mx-auto mt-10 max-w-[900px] space-y-3">
      {features.map((item, index) => {
        const isOpen = openIndex === index;
        const panelId = `feature-panel-${index}`;
        const Icon = item.icon;

        return (
          <article
            key={item.title}
            className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition-[border-color,box-shadow] duration-200 ${
              isOpen
                ? "border-[#b9dafe] shadow-[0_12px_30px_rgba(34,111,188,.09)]"
                : "border-slate-200"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex min-h-14 w-full items-center justify-between gap-4 p-4 text-left text-sm font-bold text-[#173e70] transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#318cf0]/40 sm:px-6 sm:py-5 sm:text-base"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-xl ${item.color}`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span>{item.title}</span>
              </span>
              <ChevronDown
                className={`size-5 shrink-0 text-slate-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            <div
              id={panelId}
              aria-hidden={!isOpen}
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <p className="border-t border-slate-100 bg-slate-50/50 pb-5 pl-[4.25rem] pr-4 pt-4 text-sm leading-6 text-slate-600 sm:pl-[4.75rem] sm:pr-6">
                  {item.desc}
                </p>
              </div>
            </div>
          </article>
        );
      })}
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
              : primary.dashboard === "cook"
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
      className="w-full max-w-[650px] rounded-[22px] border border-white/80 bg-white/95 p-6 text-left shadow-[0_24px_70px_rgba(63,118,158,.13)] backdrop-blur sm:rounded-[30px] sm:p-10"
    >
      <h2 className="text-xl font-extrabold tracking-[-.02em] text-[#173e70] sm:text-[28px]">
        Системд нэвтрэх
      </h2>
      <p className="mt-2 text-xs leading-5 text-slate-500 sm:text-sm">
        Багш | Эцэг эх | Удирдлага | Тогооч | Нягтлан
      </p>

      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4 sm:mt-7" noValidate>
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
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[18px] -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                name="identifier"
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                placeholder="Нэвтрэх нэр"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                className="h-14 rounded-xl border-[#d5e2f2] bg-[#edf3ff] pl-12 text-base shadow-[0_2px_10px_rgba(20,61,114,.03)] sm:h-16 sm:text-lg"
              />
            </div>
          )}
        </Field>

        <Field label="Нууц үг" error={errors.password} required className="[&>label]:sr-only">
          {({ id, describedBy, invalid }) => (
            <div className="relative">
              <LockKeyhole
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[18px] -translate-y-1/2 text-slate-400"
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
                className="h-14 rounded-xl border-[#d5e2f2] bg-[#edf3ff] pl-12 text-base shadow-[0_2px_10px_rgba(20,61,114,.03)] sm:h-16 sm:text-lg"
              />
            </div>
          )}
        </Field>

        <Button
          type="submit"
          size="lg"
          block
          disabled={login.isPending}
          className="mt-1 h-14 rounded-xl bg-gradient-to-r from-[#2582eb] to-[#3d9cf5] text-base font-bold shadow-[0_10px_28px_rgba(37,130,235,.25)] hover:from-[#1875dc] hover:to-[#2b8ee9] sm:h-16 sm:text-lg"
        >
          {login.isPending ? "Нэвтэрч байна…" : "Нэвтрэх"}
        </Button>
      </form>

      <div className="mt-3 text-center">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[#318cf0] hover:underline sm:text-base"
        >
          Нууц үгээ мартсан?
        </Link>
      </div>
    </div>
  );
}

function MiniDashboard({ variant }: { variant: "teacher" | "admin" | "child" }) {
  const palette =
    variant === "teacher"
      ? ["#66a9f2", "#f69a9a", "#77c999", "#f3c466"]
      : variant === "admin"
        ? ["#4a94ed", "#7bc5f7", "#76c794", "#f39191"]
        : ["#70a5ed", "#f0a77d", "#72c997", "#e8c565"];
  const title =
    variant === "teacher"
      ? "Сайн байна уу, Багш аа! 👋"
      : variant === "admin"
        ? "Нийт тайлан"
        : "Хүүхдийн мэдээлэл";

  return (
    <div className="relative min-h-[255px] overflow-hidden rounded-[20px] border border-[#e8eff7] bg-white p-4 shadow-[0_18px_50px_rgba(34,78,121,.12)] sm:min-h-[285px]">
      <div className="flex items-center justify-between border-b border-[#edf2f7] pb-3">
        <Brand compact primaryLogo name="NomadKids" />
        <span className="size-7 rounded-full bg-[#ffeec4]" />
      </div>
      <div className="flex gap-3 pt-3">
        <div className="hidden w-16 shrink-0 space-y-2 sm:block">
          {[70, 52, 60, 45, 65].map((width, index) => (
            <span
              key={index}
              className="block h-2 rounded-full bg-[#e7eef7]"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-[#173e70]">{title}</p>
          {variant !== "child" ? (
            <>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {palette.map((color, index) => (
                  <div
                    key={color}
                    className="rounded-lg p-2"
                    style={{ backgroundColor: `${color}20` }}
                  >
                    <span className="block text-sm font-bold" style={{ color }}>
                      {[24, 12, 18, 3][index]}
                    </span>
                    <span
                      className="mt-1 block h-1 w-8 rounded-full"
                      style={{ backgroundColor: `${color}55` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-[1.2fr_.8fr] gap-3">
                <div className="rounded-xl bg-[#f7faff] p-3">
                  <div className="flex h-20 items-end gap-2">
                    {[35, 60, 48, 78, 64, 88].map((height) => (
                      <span
                        key={height}
                        className="flex-1 rounded-t bg-[#65a8f3]"
                        style={{ height: `${height}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="grid place-items-center rounded-xl bg-[#f8fbff]">
                  <div className="grid size-20 place-items-center rounded-full bg-[conic-gradient(#4a94ed_0_40%,#6dc99a_40%_72%,#f0c66b_72%)]">
                    <span className="grid size-12 place-items-center rounded-full bg-white text-xs font-bold text-[#173e70]">
                      96%
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-3 grid grid-cols-[90px_1fr] gap-3">
              <div className="grid place-items-center rounded-xl bg-[#fff4dc] p-2">
                <NextImage
                  src="/background/mascot-girl-teal-b.webp"
                  alt=""
                  width={56}
                  height={120}
                  className="h-24 w-auto object-contain"
                />
              </div>
              <div className="space-y-2 rounded-xl bg-[#f8fbff] p-3">
                <span className="block h-3 w-24 rounded bg-[#dbe8f7]" />
                <span className="block h-2 w-full rounded bg-[#edf2f7]" />
                <span className="block h-2 w-4/5 rounded bg-[#edf2f7]" />
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <span className="h-12 rounded-lg bg-[#e9f7ef]" />
                  <span className="h-12 rounded-lg bg-[#fff1e8]" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NomadCloud({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 260 92"
      aria-hidden="true"
      className={`pointer-events-none absolute text-white/80 ${className}`}
    >
      <path
        fill="currentColor"
        d="M0 57c18 0 28-4 39-13 8-8 14-20 30-20 17 0 26 11 31 21 8-17 21-28 39-28 19 0 32 10 39 25 7-8 16-13 27-13 18 0 27 11 32 23 5 10 10 14 23 16-8 8-20 13-36 13H33C17 81 7 72 0 66z"
      />
      <path
        d="M119 45c-3-13 5-23 17-23 14 0 22 12 17 23-4 10-18 12-24 4-4-6 0-13 7-13 6 0 10 6 7 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CharacterScene() {
  return (
    <div
      role="img"
      aria-label="Багш хоёр хүүхэдтэй ярилцаж байгаа зураг"
      className="relative min-h-[390px] overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#fff9ee_35%,#ecd4ad_100%)] sm:min-h-[610px]"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-36 bg-gradient-to-b from-[#eff8ff] via-[#f6fbff]/90 to-transparent sm:h-52" />
      <div className="pointer-events-none absolute inset-x-[3%] top-[23%] grid grid-cols-6 gap-4 opacity-35 blur-[7px] sm:gap-8">
        {["#d9eef8", "#f3d7a5", "#d8ead9", "#ead3df", "#cce6e4", "#f0d8b8"].map((color, index) => (
          <span
            key={color}
            className="h-28 rounded-t-2xl border-b-[14px] border-[#caa97d]/35 sm:h-48"
            style={{ backgroundColor: color, transform: `translateY(${index % 2 ? 18 : 0}px)` }}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-[linear-gradient(180deg,rgba(231,196,143,.12),rgba(215,170,109,.42))] blur-sm" />

      <div className="absolute inset-x-0 bottom-[-28px] z-30 flex items-end justify-center sm:bottom-[-42px]">
        <NextImage
          src="/background/mascot-teacher.webp"
          alt=""
          width={118}
          height={240}
          loading="eager"
          className="relative z-10 h-[315px] w-auto object-contain drop-shadow-[0_16px_18px_rgba(72,42,23,.16)] sm:h-[500px]"
        />
        <NextImage
          src="/background/mascot-boy-green.webp"
          alt=""
          width={136}
          height={240}
          className="relative z-20 -ml-12 h-[245px] w-auto object-contain drop-shadow-[0_14px_18px_rgba(72,42,23,.14)] sm:-ml-20 sm:h-[380px]"
        />
        <NextImage
          src="/background/mascot-girl-purple.webp"
          alt=""
          width={142}
          height={240}
          className="relative z-10 -ml-12 h-[245px] w-auto object-contain drop-shadow-[0_14px_18px_rgba(72,42,23,.14)] sm:-ml-16 sm:h-[380px]"
        />
      </div>
    </div>
  );
}

function LoginLanding() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <main className="min-h-dvh overflow-hidden bg-white text-[#173e70]">
      <header className="absolute inset-x-0 top-0 z-50 px-4 pt-3">
        <div className="mx-auto flex max-w-[1220px] justify-end">
          <nav
            aria-label="Үндсэн цэс"
            className="hidden items-center gap-1 rounded-2xl border border-white/80 bg-white/90 p-2 text-xs font-semibold text-[#173e70] shadow-sm backdrop-blur lg:flex"
          >
            {navigationItems.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="rounded-xl px-3 py-2.5 transition-colors hover:bg-[#edf6ff] hover:text-[#1686f5]"
              >
                {label}
              </a>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-white/80 bg-white/90 text-[#173e70] shadow-sm backdrop-blur transition-colors hover:text-[#1686f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1686f5]/40 lg:hidden"
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
            className="ml-auto mt-2 flex w-full max-w-xs flex-col gap-1 rounded-2xl border border-[#e5edf7] bg-white p-3 text-sm font-semibold text-[#173e70] shadow-[0_18px_50px_rgba(34,78,121,.16)] lg:hidden"
          >
            {navigationItems.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                onClick={() => setIsMenuOpen(false)}
                className="rounded-xl px-4 py-3 transition-colors hover:bg-[#edf6ff] hover:text-[#1686f5]"
              >
                {label}
              </a>
            ))}
          </nav>
        ) : null}
      </header>

      <section
        id="home"
        className="relative overflow-hidden bg-[linear-gradient(180deg,#eaf6ff_0%,#f5fbff_100%)] px-4 pb-14 pt-14 sm:px-8 sm:pb-20 sm:pt-24"
      >
        <NomadCloud className="left-[-70px] top-[12%] w-[260px] sm:left-[-25px] sm:w-[380px]" />
        <NomadCloud className="right-[-95px] top-[6%] w-[260px] sm:right-[-20px] sm:w-[400px]" />
        <NomadCloud className="left-[4%] top-[38%] hidden w-[250px] sm:block" />
        <NomadCloud className="right-[-40px] top-[39%] w-[190px] opacity-75 sm:w-[290px]" />
        <NomadCloud className="left-[-80px] top-[67%] w-[200px] opacity-70 sm:w-[290px]" />

        <div className="relative z-10 mx-auto flex max-w-[760px] flex-col items-center text-center">
          <NextImage
            src="/logo.png"
            alt="Бяцхан нүүдэлчид"
            width={1071}
            height={1149}
            priority
            className="h-auto w-[105px] object-contain sm:w-[155px]"
          />

          <h1 className="mt-12 text-[clamp(2.5rem,7vw,4.2rem)] font-black leading-none tracking-[-.055em] text-[#15363f] sm:mt-20">
            NomadKids
          </h1>
          <p className="mt-2 text-sm font-extrabold text-[#1686f5] sm:text-lg">
            СӨБ-ын цогц систем
          </p>

          <div className="mt-10 flex w-full max-w-[650px] justify-end sm:mt-14">
            <Link
              href="/register"
              className="inline-flex min-h-11 items-center px-2 text-sm font-bold text-[#1686f5] hover:underline sm:text-base"
            >
              Байгууллагын бүртгэл
            </Link>
          </div>
          <LoginCard />
        </div>
      </section>

      <CharacterScene />

      <section id="features" className="px-5 py-20 sm:px-8 sm:py-24">
        <SectionHeading
          title="Яагаад NOMADKIDS-ийг сонгох вэ?"
          copy="Цэцэрлэгийн удирдлага, багш, эцэг эхийн хамтын ажиллагааг хялбарчилж, хүүхдийн хөгжил болон байгууллагын өдөр тутмын үйл ажиллагааг нэг дор удирдах нэгдсэн цахим систем."
        />
        <FeaturesAccordion />
      </section>

      <section id="audiences" className="bg-[#fbfdff] px-5 py-20 sm:px-8 sm:py-24">
        <SectionHeading
          title="Хэрэглэгч бүрд тохирсон ухаалаг шийдэл"
          copy="Хэрэглэгч тус бүрийн хэрэгцээнд тохирсон, хялбар цогц систем"
        />
        <div className="mx-auto mt-10 grid max-w-[1180px] grid-cols-2 gap-3 sm:gap-4 md:grid-cols-6 md:gap-5">
          {audiences.map((audience, index) => (
            <article
              key={audience.title}
              className={`group flex min-h-[280px] flex-col items-center rounded-2xl bg-gradient-to-b ${audience.tone} p-3 text-center shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md last:col-span-2 last:mx-auto last:w-[calc(50%-6px)] sm:min-h-[320px] sm:p-5 sm:last:w-[calc(50%-8px)] md:col-span-2 md:min-h-[365px] md:p-6 md:last:mx-0 md:last:w-auto ${index === 3 ? "md:col-start-2" : ""}`}
            >
              <div className="relative h-20 w-20 sm:h-28 sm:w-28 md:h-40 md:w-40">
                <NextImage
                  src={audience.image}
                  alt=""
                  fill
                  sizes="(max-width: 639px) 80px, (max-width: 767px) 112px, 160px"
                  className="object-contain"
                />
              </div>
              <h3 className="mt-3 text-sm font-extrabold leading-5 text-[#173e70] sm:mt-4 sm:text-base md:text-lg md:leading-6">
                {audience.title}
              </h3>
              <p className="mt-2 flex-1 text-[11px] leading-[1.55] text-slate-600 sm:mt-3 sm:text-sm sm:leading-6">
                {audience.copy}
              </p>
              <span className="mt-4 grid size-8 place-items-center rounded-full bg-white text-[#318cf0] shadow-sm transition-transform group-hover:translate-x-1">
                <ChevronRight size={16} />
              </span>
            </article>
          ))}
        </div>
      </section>

      <section id="system-preview" className="px-5 py-20 sm:px-8 sm:py-24">
        <SectionHeading
          title="Системийн харагдац"
          copy="Энгийн, ойлгомжтой, хэрэглэгчдэд ээлтэй."
        />
        <div className="mx-auto mt-10 grid max-w-[1220px] gap-6 min-[900px]:grid-cols-3">
          <MiniDashboard variant="teacher" />
          <MiniDashboard variant="admin" />
          <MiniDashboard variant="child" />
        </div>
      </section>

      <section id="benefits" className="bg-[#fbfdff] px-5 py-12 sm:px-8 sm:py-16">
        <div className="relative mx-auto flex max-w-[1220px] flex-col items-start overflow-hidden rounded-[24px] bg-[linear-gradient(105deg,#edf8ff_0%,#eef8ff_56%,#e8f7df_100%)] px-7 py-9 sm:px-10 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
          <div className="relative z-10 max-w-xl">
            <h3 className="text-2xl font-extrabold tracking-[-.025em] text-[#173e70]">
              Хүүхэд насны нандин дурсамж бүрийг хамтдаа бүтээцгээе
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              NomadKids системд нэгдэн өөрийн цэцэрлэгийн үйлчилгээг автоматжуулаарай.
            </p>
          </div>
          <div className="relative z-10 mt-6 flex self-center min-[900px]:mr-48 min-[900px]:mt-0">
            <Link
              href="/register"
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-[#2484ed] to-[#419cf2] px-8 text-sm font-bold text-white shadow-[0_9px_24px_rgba(37,130,235,.24)]"
            >
              Байгууллагын бүртгэл <ArrowRight size={18} />
            </Link>
          </div>
          <NextImage
            src="/background/mascot-boy-orange.webp"
            alt=""
            width={94}
            height={240}
            className="pointer-events-none absolute -bottom-7 right-5 hidden h-40 w-auto min-[900px]:block"
          />
        </div>
      </section>

      <section
        id="contact"
        aria-labelledby="contact-title"
        className="border-t border-gray-100 bg-white px-5 py-8 sm:px-8 sm:py-10"
      >
        <div className="mx-auto max-w-[1220px] text-center">
          <h2 id="contact-title" className="mb-1 text-base font-bold text-gray-800">
            Холбоо барих
          </h2>
          <p className="mb-3 text-sm font-semibold text-gray-600">“ӨВ БЯЦХАН НҮҮДЭЛЧИД” ХХК</p>

          <div className="mb-6 flex flex-col items-center justify-center gap-3 text-sm text-gray-600 sm:flex-row sm:gap-6">
            <div>
              <span className="font-medium text-gray-500">Утас: </span>
              <a
                href="tel:+97672134888"
                className="font-semibold transition-colors hover:text-blue-600"
              >
                (+976) 72-134-888
              </a>
              ,
              <a
                href="tel:+97699750539"
                className="font-semibold transition-colors hover:text-blue-600"
              >
                {" "}
                (+976) 9975-0539
              </a>
            </div>
            <span className="hidden text-gray-300 sm:inline">•</span>
            <div>
              <span className="font-medium text-gray-500">Имэйл: </span>
              <a
                href="mailto:Nomadkidsmn@gmail.com"
                className="font-semibold transition-colors hover:text-blue-600"
              >
                Nomadkidsmn@gmail.com
              </a>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-[620px] flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <a
              href="https://www.facebook.com/share/1MQfhFpDjD/?mibextid=wwXIfr"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#1877f2]/25 bg-[#edf6ff] px-4 py-2 text-center text-sm font-semibold leading-4 text-[#1769c2] transition-colors hover:border-[#1877f2]/45 hover:bg-[#e3f1ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877f2]/40 sm:flex-1"
            >
              <FacebookIcon />
              <span>Бяцхан Нүүдэлчид (Page)</span>
            </a>
            <a
              href="https://www.facebook.com/share/g/1DV6bfjyHW/?mibextid=wwXIfr"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#1877f2]/25 bg-[#edf6ff] px-4 py-2 text-center text-sm font-semibold leading-4 text-[#1769c2] transition-colors hover:border-[#1877f2]/45 hover:bg-[#e3f1ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1877f2]/40 sm:flex-1"
            >
              <FacebookIcon />
              <span>Бяцхан Нүүдэлчид (Групп)</span>
            </a>
          </div>
        </div>
      </section>

      <footer
        id="footer"
        className="relative overflow-hidden border-t border-[#edf2f7] bg-white px-5 pb-14 pt-10 sm:px-8"
      >
        <div className="mx-auto flex max-w-[1220px] flex-col items-center justify-between gap-8 text-center md:flex-row md:text-left">
          <Brand tagline="СӨБ-ын цогц систем" primaryLogo name="NomadKids" />
          <nav className="flex flex-wrap justify-center gap-x-5 gap-y-3 text-xs text-slate-500">
            <a href="#features">Бүтээгдэхүүн</a>
            <a href="#audiences">Хэнд зориулагдсан</a>
            <a href="#benefits">Нууцлалын бодлого</a>
            <a href="#contact">Тусламж</a>
          </nav>
        </div>
        <div className="mx-auto mt-8 flex max-w-[1220px] flex-col items-center justify-between gap-2 border-t border-[#edf2f7] pt-5 text-[11px] text-slate-400 sm:flex-row">
          <span>© 2026 Nomad Kids. Бүх эрх хуулиар хамгаалагдсан.</span>
          <span>Илүү сайн ирээдүйн төлөө · Хамтдаа ❤</span>
        </div>
        <div className="pointer-events-none absolute -bottom-12 left-0 h-20 w-full rounded-[50%] bg-[#e6f5dc]" />
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
