"use client";

import { useMutation } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, ShieldCheck, UserRound } from "lucide-react";
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
    <div className="relative min-h-dvh overflow-hidden bg-[linear-gradient(165deg,#f5f8ff,#eaf0fe_55%,#e2eafc)]">
      {/*
        Two soft shapes, the background's whole decoration. `aria-hidden` and
        pointer-transparent: they say nothing and must never intercept a tap.
      */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 top-32 size-[420px] rounded-pill bg-white/45 blur-2xl"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-24 size-[380px] rounded-pill bg-white/40 blur-2xl"
      />

      <header className="relative flex flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8">
        <Link href="/" className="flex min-h-[44px] items-center gap-3">
          <Image
            src="/brand-logo.png"
            alt={BRAND}
            width={56}
            height={56}
            className="w-[56px]"
            style={{ height: "auto" }}
            priority
          />
        </Link>

        <Button asChild variant="secondary" size="sm">
          <Link href="/login">
            <ArrowLeft size={17} aria-hidden />
            Нэвтрэх
          </Link>
        </Button>
      </header>

      <div className="relative mx-auto grid w-full max-w-[1180px] gap-8 px-5 pb-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:items-start lg:gap-12">
        <Explainer />

        <main className="w-full rounded-card border border-white/70 bg-surface p-6 shadow-lg [overflow-wrap:anywhere] sm:p-7">
          <StaffRegisterForm />
        </main>
      </div>
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
    <section className="max-w-[560px]">
      <p className="text-caption font-semibold uppercase tracking-[0.18em] text-primary">{BRAND}</p>
      <h1 className="mt-2 text-display font-bold leading-heading tracking-[-0.02em] text-ink">
        Ажилтны бүртгэл
      </h1>
      <p className="mt-3 max-w-[38ch] text-lead leading-relaxed text-muted">
        Цэцэрлэгээсээ авсан мэдээллээр ажилтны эрхээ үүсгэнэ үү.
      </p>

      <ol className="mt-7 flex flex-col gap-4">
        <Step
          n={1}
          tone="bg-primary-soft text-primary"
          icon={<Building2 size={20} aria-hidden />}
          title="Цэцэрлэгийн код"
          description="Цэцэрлэгээсээ авсан кодоо оруулна."
        />
        <Step
          n={2}
          tone="bg-mint text-mint-ink"
          icon={<UserRound size={20} aria-hidden />}
          title="Регистрийн дугаар"
          description="Өөрийн регистрийн дугаараа оруулна."
        />
        <Step
          n={3}
          tone="bg-sun text-sun-ink"
          icon={<Check size={20} strokeWidth={3} aria-hidden />}
          title="Бүртгүүлэх"
          description="Ажилтны эрхээ үүсгээд системдээ нэвтэрч ашиглана."
        />
      </ol>

      {/*
        The illustration is the last thing in the column and the first thing
        dropped on a short screen — `hidden` below `lg`, where the form has to
        be reachable without scrolling past a picture.
      */}
      <div aria-hidden="true" className="mt-8 hidden items-end gap-4 lg:flex">
        <Art name="reportChildrenStar" size={190} className="w-[190px]" />
        <p className="mb-3 max-w-[16ch] text-lead italic leading-snug text-primary/70">
          Хүүхэд бүрд илүү сайн ирээдүй
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
    <li className="flex items-start gap-3.5">
      <span className={`grid size-11 shrink-0 place-items-center rounded-pill ${tone}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-body font-semibold text-ink">
          {n}. {title}
        </span>
        <span className="mt-0.5 block text-body leading-relaxed text-muted">{description}</span>
      </span>
    </li>
  );
}

function StaffRegisterForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [registerNumber, setRegisterNumber] = useState("");

  const register = useMutation({
    mutationFn: () =>
      mutate("/staff-registration", staffSelfRegistrationResultSchema, {
        method: "POST",
        body: { code, registerNumber },
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
    <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
      <div>
        <p className="text-body text-muted">Сайн байна уу? 👋</p>
        <h2 className="mt-1 text-heading font-semibold tracking-[-.01em] text-ink">
          Ажилтны бүртгэл
        </h2>
        <p className="mt-1 text-body leading-relaxed text-muted">Доорх мэдээллүүдийг оруулна уу.</p>
      </div>

      {/*
        ★ Rendered unconditionally, not shown only when an error appears.
        Text that only shows up on failure is a second signal — see the
        docblock at the head of this file.
      */}
      <p className="rounded-control bg-canvas px-3.5 py-2.5 text-caption leading-relaxed text-muted">
        Жагсаалтаас олдохгүй бол цэцэрлэгийнхээ захиралтай холбогдоно уу.
      </p>

      <FormError message={register.isError ? errorMessage(register.error) : null} />

      <Field label="Цэцэрлэгийн код" required>
        {({ id, describedBy, invalid }) => (
          <IconInput icon={<Building2 size={18} aria-hidden />}>
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Жишээ: NK001"
              autoCapitalize="none"
              autoFocus
              className="pl-[52px]"
            />
          </IconInput>
        )}
      </Field>

      <Field label="Регистрийн дугаар" required>
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
              className="pl-[52px]"
            />
          </IconInput>
        )}
      </Field>

      <Button type="submit" size="lg" disabled={register.isPending} className="mt-1 w-full">
        {register.isPending ? "Илгээж байна…" : "Бүртгүүлэх"}
        {register.isPending ? null : <ArrowRight size={18} aria-hidden />}
      </Button>

      <p className="border-t border-border pt-4 text-center text-body text-muted">
        Бүртгэлтэй юу?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Нэвтрэх
        </Link>
      </p>

      <p className="flex items-start gap-2 text-caption leading-relaxed text-muted">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />
        <span>
          Таны мэдээлэл бүрэн хамгаалагдсан. {BRAND} нь хүүхдийн аюулгүй, найдвартай орчны төлөө.
        </span>
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
        className="pointer-events-none absolute left-0 top-0 grid h-[48px] w-[46px] place-items-center border-r border-border text-muted"
      >
        {icon}
      </span>
      {children}
    </span>
  );
}
