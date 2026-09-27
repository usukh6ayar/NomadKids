"use client";

import { useMutation } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, Info, UserRound } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { staffSelfRegistrationResultSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { Art } from "@/components/ui/art";
import { BRAND } from "@/lib/vocabulary";

/**
 * Багшийн өөрийн бүртгэл — `POST /staff-registration`.
 *
 * ★★★ **The server refuses a wrong code, an unknown register number, a
 * malformed one, a stale roster and an unmapped job title with the exact same
 * status and the exact same sentence** (`StaffRegistrationService.REFUSAL`,
 * `apps/api/src/staff-registration/staff-registration.service.ts`) — on
 * purpose. If a wrong code read differently from "not on this roster", the
 * form would answer "does this register number belong to a member of staff
 * here?" for anyone holding a code and a list of numbers.
 *
 * This screen must not undo that in the browser. It renders whatever
 * `problem.detail` the API sends, through `errorMessage()`, and adds no
 * validation of its own that would tell a malformed register number apart
 * from an unknown one before the request is even sent — a client-side check
 * that rejects one shape and accepts another is the same leak one step
 * earlier.
 *
 * ★ The register number is typed as given, uppercase and lookalike-Latin
 * letters included: `normalizeRegisterNumber` on the API already forgives
 * both, so re-implementing that here would be a second copy of a rule that
 * only needs to exist once.
 *
 * ★★ On success the screen redirects to `/invitation/[token]`, which already
 * collects the first password — there is no second password form here. The
 * account it belongs to is unusable until that page is completed.
 *
 * ★★★★ **Its own layout since 2026-09-19, at the client's design.** It used
 * `AuthShell` — the login card, with a decorative panel beside it — and that
 * shell answers a different question. Somebody arriving here has been handed a
 * code by their director and does not yet know what the thing is, so the left
 * half explains the three steps before the form asks for anything. Nothing
 * about the request, the refusal or the redirect changed.
 */
export default function StaffRegisterPage() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#f1f9ff] text-[#173e70]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 top-24 size-[480px] rounded-pill bg-[#dceeff]/70 blur-3xl"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 top-40 size-[420px] rounded-pill bg-[#e2f5ec]/70 blur-3xl"
      />

      <header className="relative border-b border-white/80 bg-white/55 px-5 backdrop-blur-md sm:px-8">
        <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-3 py-3">
          <Link href="/" className="flex min-h-[48px] items-center gap-2.5">
            <Image
              src="/brand-logo.png"
              alt=""
              width={48}
              height={48}
              className="size-12 object-contain"
              priority
            />
            <span className="min-w-0">
              <span className="block text-body font-extrabold leading-tight text-[#173e70]">
                {BRAND}
              </span>
              <span className="block text-caption text-muted">Цэцэрлэгийн цахим орчин</span>
            </span>
          </Link>
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="rounded-control border-[#d5e5f3] text-[#176ac2]"
          >
            <Link href="/login">
              <ArrowLeft size={17} aria-hidden />
              Нэвтрэх
            </Link>
          </Button>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-[1160px] gap-7 px-5 pb-12 pt-8 sm:px-8 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(420px,460px)] lg:items-start lg:gap-16 lg:pt-16">
        <Explainer />

        <section
          aria-label="Ажилтны бүртгэлийн маягт"
          className="w-full rounded-card border border-white/90 bg-white/95 p-5 shadow-[0_24px_70px_rgba(25,72,111,.13)] backdrop-blur-xl [overflow-wrap:anywhere] sm:p-8"
        >
          <StaffRegisterForm />
        </section>
      </main>
    </div>
  );
}

/**
 * The left half: what this page is, in three steps, before it asks for
 * anything.
 *
 * ★ Ordered as a list rather than as three cards, because they happen in
 * order and the numbers are the content.
 *
 * ★★ Below `lg` it sits *above* the form rather than folding away. `AuthShell`
 * hides its panel on a phone, which is right there — it is decoration beside a
 * form everybody already understands. This is not decoration: a member of
 * staff holding a code needs the second step to know that the number being
 * asked for is their own.
 */
function Explainer() {
  return (
    <section className="max-w-[580px] lg:pt-7">
      <span className="inline-flex items-center gap-2 rounded-pill bg-white/85 px-3.5 py-2 text-caption font-bold tracking-wide text-[#145ca8] shadow-sm">
        <span className="size-2 rounded-pill bg-[#2588ed]" aria-hidden="true" />
        БАГШ, АЖИЛТАНД
      </span>
      <h1 className="mt-5 text-heading font-extrabold leading-heading tracking-tight text-[#173e70] sm:text-display">
        Ажилтны бүртгэл
      </h1>
      <p className="mt-3 max-w-[44ch] text-body leading-7 text-[#42627c] sm:text-lead">
        Цэцэрлэгийнхээ ESIS дугаар болон өөрийн регистрийн дугаараар эрхээ үүсгээд багтаа нэгдээрэй.
      </p>

      <div className="mt-7 rounded-card border border-white/90 bg-white/70 p-5 shadow-[0_14px_36px_rgba(25,72,111,.06)] sm:p-6">
        <p className="mb-4 text-caption font-bold uppercase tracking-[0.12em] text-[#176ac2]">
          3 алхмаар эхлүүлнэ
        </p>
        <ol className="flex flex-col gap-4">
          <Step
            n={1}
            tone="bg-[#e2f1ff] text-[#176ac2]"
            icon={<Building2 size={20} aria-hidden />}
            title="Цэцэрлэгийн ESIS дугаар"
            description="Танай цэцэрлэгийн ESIS дээрх байгууллагын дугаарыг оруулна."
          />
          <Step
            n={2}
            tone="bg-[#e4f5ed] text-[#1f6b4d]"
            icon={<UserRound size={20} aria-hidden />}
            title="Регистрийн дугаар"
            description="Өөрийн регистрийн дугаараа оруулна."
          />
          <Step
            n={3}
            tone="bg-[#fff1d3] text-[#825a11]"
            icon={<Check size={20} strokeWidth={3} aria-hidden />}
            title="Бүртгүүлэх"
            description="Дараагийн хуудсанд нууц үгээ тохируулж бүртгэлээ дуусгана."
          />
        </ol>
      </div>

      <div aria-hidden="true" className="mt-6 hidden items-center gap-4 lg:flex">
        <Art name="reportChildrenStar" size={130} className="w-[130px]" />
        <p className="max-w-[18ch] text-body font-semibold leading-relaxed text-[#42627c]">
          Хүүхэд бүрийн өсөлтөд хамтдаа анхааръя.
        </p>
      </div>
    </section>
  );
}

function Step({
  n,
  tone,
  icon,
  title,
  description,
}: {
  n: number;
  tone: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <li className="flex items-start gap-3.5 border-b border-[#e6eff6] pb-4 last:border-0 last:pb-0">
      <span className={`grid size-11 shrink-0 place-items-center rounded-control ${tone}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption font-bold text-[#176ac2]">АЛХАМ {n}</span>
        <span className="mt-0.5 block text-body font-bold text-[#173e70]">{title}</span>
        <span className="mt-0.5 block text-caption leading-5 text-muted">{description}</span>
      </span>
    </li>
  );
}

function StaffRegisterForm() {
  const router = useRouter();
  const [institutionId, setInstitutionId] = useState("");
  const [registerNumber, setRegisterNumber] = useState("");

  const register = useMutation({
    mutationFn: () =>
      mutate("/staff-registration", staffSelfRegistrationResultSchema, {
        method: "POST",
        body: { institutionId, registerNumber },
      }),
    onSuccess: (result) => {
      router.replace(`/invitation/${result.invitationToken}`);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!register.isPending) register.mutate();
  }

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={onSubmit}>
      <div>
        <span className="inline-flex items-center gap-2 rounded-pill bg-[#eaf5ff] px-3 py-1.5 text-caption font-bold text-[#145ca8]">
          Эрхээ үүсгэх
        </span>
        <h2 className="mt-4 text-heading font-extrabold tracking-tight text-[#173e70]">
          Мэдээллээ оруулна уу
        </h2>
        <p className="mt-2 text-body leading-6 text-slate-600">
          Цэцэрлэгийнхээ ESIS дугаар, өөрийн регистрийн дугаараа оруулна уу.
        </p>
      </div>

      <FormError message={register.isError ? errorMessage(register.error) : null} />

      <Field
        label="Цэцэрлэгийн ESIS дугаар"
        hint="Танай цэцэрлэгийн ESIS дээрх байгууллагын дугаар. Захирлаасаа асууна уу."
        required
      >
        {({ id, describedBy, invalid }) => (
          <IconInput icon={<Building2 size={18} aria-hidden />}>
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={institutionId}
              onChange={(event) => setInstitutionId(event.target.value)}
              placeholder="Жишээ: 42778"
              inputMode="numeric"
              autoCapitalize="none"
              className="h-13 rounded-control border-[#dbe7f2] bg-[#f8fbff] pl-12 focus:bg-white"
            />
          </IconInput>
        )}
      </Field>

      <Field label="Регистрийн дугаар" hint="Өөрийн регистрийн дугаарыг бичнэ үү." required>
        {({ id, describedBy, invalid }) => (
          <IconInput icon={<UserRound size={18} aria-hidden />}>
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={registerNumber}
              onChange={(event) => setRegisterNumber(event.target.value)}
              placeholder="Жишээ: УБ12345678"
              autoCapitalize="none"
              className="h-13 rounded-control border-[#dbe7f2] bg-[#f8fbff] pl-12 focus:bg-white"
            />
          </IconInput>
        )}
      </Field>

      {/* This help remains visible before and after every server response. */}
      <p className="flex items-start gap-2.5 rounded-control border border-[#dcebf7] bg-[#f2f8fe] px-4 py-3 text-caption leading-5 text-[#42627c]">
        <Info size={18} className="mt-0.5 shrink-0 text-[#176ac2]" aria-hidden />
        <span>Жагсаалтаас олдохгүй бол цэцэрлэгийнхээ захиралтай холбогдоно уу.</span>
      </p>

      <Button
        type="submit"
        size="lg"
        disabled={register.isPending}
        className="w-full rounded-control bg-[#176ac2] font-bold shadow-[0_10px_24px_rgba(23,106,194,.22)] hover:bg-[#115aa8]"
      >
        {register.isPending ? "Илгээж байна…" : "Бүртгүүлэх"}
        {register.isPending ? null : <ArrowRight size={18} aria-hidden />}
      </Button>

      <p className="border-t border-[#e8f0f7] pt-5 text-center text-body text-muted">
        Бүртгэлтэй юу?{" "}
        <Link href="/login" className="font-bold text-[#176ac2] hover:underline">
          Нэвтрэх
        </Link>
      </p>
    </form>
  );
}

/**
 * A leading mark inside a field.
 *
 * ★ Decoration, and `aria-hidden` through its caller: the label above the
 * input is what names it, and an icon repeating "person" for a register number
 * would be a second, vaguer name for the same thing. The input carries the
 * left padding rather than the wrapper so the focus ring stays on the control.
 */
function IconInput({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="relative block">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 grid size-5 -translate-y-1/2 place-items-center text-[#62819d]"
      >
        {icon}
      </span>
      {children}
    </span>
  );
}
