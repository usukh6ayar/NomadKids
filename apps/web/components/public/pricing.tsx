"use client";

import { ArrowRight, Check, Minus, Plus } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { RegisterDialog } from "@/components/public/register-dialog";
import { TeacherApplyDialog } from "@/components/public/teacher-apply-dialog";
import {
  CHILD_STANDARD_TERM_PRICE,
  KINDERGARTEN_CURRENT_TERM_PER_GROUP,
  KINDERGARTEN_MONTHLY_PER_GROUP,
  PLANS,
  kindergartenTermPrice,
  kindergartenYearlyPrice,
  tugrik,
  type BillingPeriod,
  type Plan,
  type PlanKey,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";

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

type Applying = "teacher" | "kindergarten" | null;

/**
 * Үнийн санал: хүүхдийн улирлын/жилийн үнэ, багшийн үнэгүй багц, цэцэрлэгийн
 * бүлгийн тоонд суурилсан амьд тооцоолуур нэг дэлгэцэд байна.
 */
export function PricingContent() {
  const [period, setPeriod] = useState<BillingPeriod>("term");
  const [groupCount, setGroupCount] = useState(1);
  const [applying, setApplying] = useState<Applying>(null);

  return (
    <main className="bg-[linear-gradient(180deg,#f3f1ff_0%,#ffffff_420px)] text-[#173e70]">
      <section className="relative px-5 pb-5 pt-4 text-center sm:px-8 sm:pt-6">
        <h1 className="text-figure font-extrabold leading-tight text-[#102f5d] sm:text-hero">
          Үнийн санал
        </h1>
        <p className="mx-auto mt-2 max-w-[640px] text-body text-slate-600">
          Хэрэглээндээ тохирох багцаа сонгоод жилийн төлбөрөөр илүү хэмнээрэй.
        </p>

        <div
          role="radiogroup"
          aria-label="Төлбөрийн хугацаа"
          className="relative mx-auto mt-5 grid max-w-[420px] grid-cols-2 gap-1 rounded-pill bg-white p-1 shadow-sm ring-1 ring-[#e7e9f5]"
        >
          {(
            [
              ["term", "Улирлаар"],
              ["year", "Жилээр — хямд"],
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

      <section
        aria-label="Багцууд"
        className="mx-auto grid max-w-[1180px] gap-4 px-4 pb-14 sm:px-8 md:grid-cols-2 lg:mt-24 lg:grid-cols-3"
      >
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.key}
            plan={plan}
            period={period}
            groupCount={groupCount}
            onGroupCountChange={setGroupCount}
            onApply={() => setApplying(plan.key === "teacher" ? "teacher" : "kindergarten")}
          />
        ))}
      </section>

      {applying === "kindergarten" ? (
        <RegisterDialog
          onClose={() => setApplying(null)}
          initialGroupCount={groupCount}
          initialBillingPeriod={period}
        />
      ) : null}
      {applying === "teacher" ? <TeacherApplyDialog onClose={() => setApplying(null)} /> : null}
    </main>
  );
}

function PlanCard({
  plan,
  period,
  groupCount,
  onGroupCountChange,
  onApply,
}: {
  plan: Plan;
  period: BillingPeriod;
  groupCount: number;
  onGroupCountChange: (count: number) => void;
  onApply: () => void;
}) {
  const look = LOOK[plan.key];
  const termAmount = plan.key === "kindergarten" ? kindergartenTermPrice(groupCount) : plan.perTerm;
  const yearlyAmount =
    plan.key === "kindergarten" ? kindergartenYearlyPrice(groupCount) : plan.perYear;
  return (
    <article
      aria-labelledby={"plan-" + plan.key}
      className={cn("relative flex flex-col gap-4 rounded-card p-5 ring-1", look.card)}
    >
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
          <Image src={look.art} alt="" width={56} height={56} className="size-12 object-contain" />
        </span>
        <div className="min-w-0">
          <h2 id={"plan-" + plan.key} className="text-title font-extrabold text-[#102f5d]">
            {plan.name}
          </h2>
          {plan.audience ? <p className="text-body text-slate-600">{plan.audience}</p> : null}
        </div>
      </header>

      {plan.key === "kindergarten" ? (
        <GroupCounter count={groupCount} onChange={onGroupCountChange} />
      ) : null}

      {plan.key === "teacher" ? (
        <div className="mx-auto w-fit min-w-28 rounded-row bg-white px-5 py-3 text-center ring-2 ring-[#0f8a5f]">
          <p className="text-title font-extrabold text-[#0d6b4a]">Үнэгүй</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <PriceBox
            amount={termAmount}
            was={
              plan.key === "child"
                ? CHILD_STANDARD_TERM_PRICE
                : groupCount * KINDERGARTEN_MONTHLY_PER_GROUP
            }
            unit={plan.key === "kindergarten" ? "/ 1-р улирал · нийт" : "/ 1-р улирал"}
            selected={period === "term"}
            textClass={look.text}
            ringClass={look.ring}
          />
          <PriceBox
            amount={yearlyAmount}
            unit={plan.key === "kindergarten" ? "/ хичээлийн жил · нийт" : "/ хичээлийн жил"}
            selected={period === "year"}
            textClass="text-[#e11d63]"
            ringClass="ring-[#e11d63]"
          />
        </div>
      )}

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
          onClick={onApply}
          className={cn(
            "mt-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-pill px-5 text-body font-bold text-white shadow-sm transition-colors",
            look.button,
          )}
        >
          {plan.key === "teacher" ? "Бүртгүүлэх" : "Гэрээ байгуулах"}{" "}
          <ArrowRight className="size-4" aria-hidden />
        </button>
      ) : null}
    </article>
  );
}

function GroupCounter({ count, onChange }: { count: number; onChange: (count: number) => void }) {
  return (
    <div className="rounded-row bg-white p-3 ring-1 ring-[#f3d4b4]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-body font-bold text-[#102f5d]">Бүлгийн тоо</p>
          <p className="text-caption text-slate-500">
            1 бүлэг сарын {tugrik(KINDERGARTEN_MONTHLY_PER_GROUP)}
          </p>
          <p className="text-compact font-semibold text-[#c2410c]">
            11 сар хүртэл {tugrik(KINDERGARTEN_CURRENT_TERM_PER_GROUP)}
          </p>
        </div>
        <div className="flex items-center gap-1.5" aria-label="Бүлгийн тоо сонгох">
          <button
            type="button"
            aria-label="Бүлгийн тоо хасах"
            disabled={count <= 1}
            onClick={() => onChange(Math.max(1, count - 1))}
            className="grid size-11 place-items-center rounded-pill bg-[#fff1e3] text-[#c2410c] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <output
            aria-live="polite"
            aria-label="Сонгосон бүлгийн тоо"
            className="min-w-10 text-center text-title font-extrabold tabular-nums text-[#102f5d]"
          >
            {count}
          </output>
          <button
            type="button"
            aria-label="Бүлгийн тоо нэмэх"
            onClick={() => onChange(count + 1)}
            className="grid size-11 place-items-center rounded-pill bg-[#fff1e3] text-[#c2410c]"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
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
        <p className="text-caption font-semibold tabular-nums text-slate-400 line-through">
          {tugrik(was)}
        </p>
      ) : null}
      <p className={cn("text-title font-extrabold tabular-nums", textClass)}>{tugrik(amount)}</p>
      <p className="text-caption text-slate-500">{unit}</p>
    </div>
  );
}
