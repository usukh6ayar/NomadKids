"use client";

import { ArrowRight, Check, School } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { RegisterDialog } from "@/components/public/register-dialog";
import { TeacherApplyDialog } from "@/components/public/teacher-apply-dialog";
import {
  FIRST_TERM_OFFER,
  KINDERGARTEN_TIERS,
  PLANS,
  SHOW_KINDERGARTEN_TIERS,
  firstTermOfferRuns,
  tugrik,
  yearlySaving,
  type PlanKey,
} from "@/lib/pricing";
import { todayLocal } from "@/lib/format";
import { cn } from "@/lib/utils";

type Period = "term" | "year";

/**
 * Each plan's colour, as the client's sheet draws them — violet, green and
 * orange. Literal values like the rest of the public pages (`landing.tsx`),
 * which are drawn to pictures rather than to the app's tokens.
 */
const LOOK: Record<
  PlanKey,
  { card: string; text: string; ring: string; check: string; button: string; art: string }
> = {
  child: {
    card: "bg-[#f6f3ff] ring-[#e6defd]",
    text: "text-[#4f3fd8]",
    ring: "ring-[#4f3fd8]",
    check: "text-[#5b4bdb]",
    button: "bg-[#5b4bdb] hover:bg-[#4b3bcb]",
    // A family — 2026-10-08, the client: "хүүхэд гэдэг дээр гэр бүл зураг".
    art: "/icons/icon-age-family-3d.png",
  },
  teacher: {
    card: "bg-[#effaf4] ring-[#d3f0e0]",
    text: "text-[#0d6b4a]",
    ring: "ring-[#0f8a5f]",
    check: "text-[#0f8a5f]",
    button: "bg-[#0f8a5f] hover:bg-[#0c7650]",
    art: "/icons/icon-teacher-3d.png",
  },
  kindergarten: {
    card: "bg-[#fff6ec] ring-[#fbe3c8]",
    text: "text-[#c2410c]",
    ring: "ring-[#ea580c]",
    check: "text-[#ea580c]",
    button: "bg-[#ea580c] hover:bg-[#d24d08]",
    art: "/icons/icon-kindergarten-3d.png",
  },
};

/**
 * «Гэрээ байгуулах» — 2026-10-08, the client: a kindergarten's opens the home
 * page's «Байгууллагын бүртгэл» window, a teacher's a window like it, and the
 * child's plan has none.
 */
type Applying = "teacher" | "kindergarten" | null;

/**
 * Үнийн санал — the client's sheet, 2026-10-08, as a page: the period, the
 * three plans, the term calendar and the kindergarten package by groups.
 * Prices and savings come from `lib/pricing.ts`.
 */
export function PricingContent({ today = todayLocal() }: { today?: string } = {}) {
  const [period, setPeriod] = useState<Period>("term");
  const [applying, setApplying] = useState<Applying>(null);
  const offer = firstTermOfferRuns(today);

  return (
    <main className="bg-[linear-gradient(180deg,#f3f1ff_0%,#ffffff_420px)] text-[#173e70]">
      {/* No «NOMADKIDS.MN» label, and pulled up — 2026-10-08, the client. */}
      <section className="relative px-5 pb-5 pt-4 text-center sm:px-8 sm:pt-6">
        {/* No children at the sides and no subtitle — 2026-10-08, the client. */}
        <h1 className="text-figure font-extrabold leading-tight text-[#102f5d] sm:text-hero">
          Үнийн санал
        </h1>

        <div
          role="radiogroup"
          aria-label="Төлбөрийн хугацаа"
          className="relative mx-auto mt-6 grid max-w-[420px] grid-cols-2 gap-1 rounded-pill bg-white p-1 shadow-sm ring-1 ring-[#e7e9f5]"
        >
          {(
            [
              ["term", "Улирлаар (3 сар)"],
              ["year", "Жилээр (12 сар)"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                "min-h-11 rounded-pill px-3 text-body font-semibold transition-colors",
                period === value ? "bg-[#5b4bdb] text-white shadow-sm" : "text-slate-600",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {offer ? (
        <p className="mx-auto mb-4 w-fit rounded-pill bg-[#ffe4ee] px-4 py-1.5 text-center text-caption font-bold text-[#e11d63]">
          {FIRST_TERM_OFFER.label}: {FIRST_TERM_OFFER.note} хямдралтай
        </p>
      ) : null}

      <section
        aria-label="Багцууд"
        // Room above the cards for the children on «Цэцэрлэг», desktop only.
        className="mx-auto grid max-w-[1180px] gap-4 px-4 sm:px-8 md:grid-cols-3 lg:mt-24"
      >
        {PLANS.map((plan) => {
          const look = LOOK[plan.key];
          return (
            <article
              key={plan.key}
              aria-labelledby={`plan-${plan.key}`}
              className={cn("relative flex flex-col gap-4 rounded-card p-5 ring-1", look.card)}
            >
              {/*
                ★ Two children standing behind «Цэцэрлэг», cut at the belt and
                set so the cut sits exactly on the card's top edge — 2026-10-08,
                the client: "зөвхөн вэб дээр … Цэцэрлэг гэсний дээр арын
                талбарын зураастай яг тэгшлэн гэдэс хэсгээр тайран". Desktop
                only; a phone keeps the cards close together.
              */}
              {plan.key === "kindergarten" ? (
                <Image
                  src="/illustrations/pricing-kids.png"
                  alt=""
                  width={560}
                  height={270}
                  className="pointer-events-none absolute bottom-full right-6 mb-px hidden w-[230px] lg:block"
                />
              ) : null}
              <header className="flex items-center gap-3">
                <span className="grid size-16 shrink-0 place-items-center rounded-pill bg-white shadow-sm">
                  <Image
                    src={look.art}
                    alt=""
                    width={56}
                    height={56}
                    className="size-12 object-contain"
                  />
                </span>
                <div className="min-w-0">
                  <h2 id={`plan-${plan.key}`} className="text-title font-extrabold text-[#102f5d]">
                    {plan.name}
                  </h2>
                  {plan.audience ? (
                    <p className="text-body text-slate-600">{plan.audience}</p>
                  ) : null}
                </div>
              </header>

              <div className="grid grid-cols-2 gap-2">
                <PriceBox
                  amount={offer ? plan.firstTermOffer : plan.perTerm}
                  was={offer ? plan.perTerm : undefined}
                  badge={offer ? FIRST_TERM_OFFER.label : undefined}
                  unit="/ улирал (3 сар)"
                  selected={period === "term"}
                  textClass={look.text}
                  ringClass={look.ring}
                />
                <PriceBox
                  amount={plan.perYear}
                  unit="/ жил (12 сар)"
                  selected={period === "year"}
                  textClass="text-[#e11d63]"
                  ringClass="ring-[#e11d63]"
                />
              </div>

              <ul className="flex flex-col gap-2 text-body text-slate-700">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check className={cn("mt-0.5 size-5 shrink-0", look.check)} aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>

              {plan.key !== "child" ? (
                <button
                  type="button"
                  onClick={() => setApplying(plan.key === "teacher" ? "teacher" : "kindergarten")}
                  className={cn(
                    "mt-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-pill px-5 text-body font-bold text-white shadow-sm transition-colors",
                    look.button,
                  )}
                >
                  Гэрээ байгуулах <ArrowRight className="size-4" aria-hidden />
                </button>
              ) : null}
            </article>
          );
        })}
      </section>

      {/* No «Улирлын хуваарь»: it need not be on show — 2026-10-08, the client. */}

      {SHOW_KINDERGARTEN_TIERS ? (
        <section
          aria-labelledby="tiers-heading"
          className="mx-auto mt-6 max-w-[1180px] px-4 pb-14 sm:px-8"
        >
          <div className="rounded-card bg-white p-4 shadow-sm ring-1 ring-[#e3ecfa] sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2
                id="tiers-heading"
                className="flex items-center gap-2 text-lead font-extrabold text-[#102f5d]"
              >
                <School className="size-6 text-[#3f86ef]" aria-hidden />
                Цэцэрлэгийн багцын дэлгэрэнгүй үнэ
              </h2>
              {/* No «Жилээр авбал … хэмнэнэ» — 2026-10-08, the client. */}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-body">
                <caption className="sr-only">Цэцэрлэгийн багцын үнэ, бүлгийн тоогоор</caption>
                <thead>
                  <tr className="text-caption">
                    <th
                      scope="col"
                      className="bg-[#f4f6fb] px-3 py-2.5 text-left font-semibold text-slate-600"
                    >
                      Бүлгийн тоо
                    </th>
                    <th
                      scope="col"
                      className={cn(
                        "px-3 py-2.5 text-center font-semibold",
                        period === "term"
                          ? "bg-[#e5e0ff] text-[#4f3fd8]"
                          : "bg-[#f1efff] text-[#4f3fd8]",
                      )}
                    >
                      Улирлын үнэ <span className="block font-normal">(3 сар)</span>
                    </th>
                    <th
                      scope="col"
                      className={cn(
                        "px-3 py-2.5 text-center font-semibold",
                        period === "year"
                          ? "bg-[#ffd6e5] text-[#e11d63]"
                          : "bg-[#fff0f5] text-[#e11d63]",
                      )}
                    >
                      Жилийн үнэ <span className="block font-normal">(12 сар)</span>
                    </th>
                    <th
                      scope="col"
                      className="bg-[#eef2ff] px-3 py-2.5 text-center font-semibold text-[#3f56c8]"
                    >
                      Хөнгөлөлт
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {KINDERGARTEN_TIERS.map((tier) => (
                    <tr key={tier.groups} className="border-b border-[#eef2f7] last:border-0">
                      <th scope="row" className="px-3 py-2.5 text-left font-medium text-slate-700">
                        {tier.groups}
                      </th>
                      <td className="px-3 py-2.5 text-center font-bold tabular-nums text-[#102f5d]">
                        {tier.perTerm ? tugrik(tier.perTerm) : "Тусгай санал"}
                      </td>
                      <td className="px-3 py-2.5 text-center font-bold tabular-nums text-[#e11d63]">
                        {tier.perYear ? tugrik(tier.perYear) : "Тусгай санал"}
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold tabular-nums text-[#e11d63]">
                        {tier.perTerm && tier.perYear
                          ? `${yearlySaving(tier.perTerm, tier.perYear, 2)}%`
                          : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
      {applying === "kindergarten" ? <RegisterDialog onClose={() => setApplying(null)} /> : null}
      {applying === "teacher" ? <TeacherApplyDialog onClose={() => setApplying(null)} /> : null}
    </main>
  );
}

function PriceBox({
  amount,
  was,
  unit,
  selected,
  textClass,
  ringClass,
  badge,
}: {
  amount: number;
  /** The price before the offer, struck through above it. */
  was?: number;
  unit: string;
  selected: boolean;
  textClass: string;
  ringClass: string;
  badge?: string;
}) {
  return (
    <div
      className={cn(
        "relative rounded-row bg-white px-2 pb-2.5 pt-4 text-center ring-1 ring-[#e7e9f5] transition",
        selected && cn("ring-2", ringClass),
      )}
    >
      {badge ? (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-pill bg-[#ff4d7d] px-2 py-0.5 text-compact font-bold text-white">
          {badge}
        </span>
      ) : null}
      {was ? (
        <p className="text-caption tabular-nums text-slate-400 line-through">
          <span className="sr-only">Хуучин үнэ </span>
          {tugrik(was)}
        </p>
      ) : null}
      <p className={cn("text-title font-extrabold tabular-nums", textClass)}>{tugrik(amount)}</p>
      <p className="text-caption text-slate-500">{unit}</p>
    </div>
  );
}
