"use client";

import { useMutation } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  LockKeyhole,
  MessageSquareText,
  Phone,
  PhoneOff,
  RotateCcw,
  SearchX,
} from "lucide-react";
import { z } from "zod";
import {
  PASSWORD_RULES,
  passwordRuleStatus,
  phoneVerificationStartSchema,
  validatePasswordStrength,
} from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import {
  MOBILE_PHONE,
  formatSeconds,
  usePhoneVerification,
  usePhoneVerificationAvailability,
} from "@/components/auth/phone-verification";
import { cn } from "@/lib/utils";

/**
 * «Нууц үг сэргээх» — by phone, and by phone only. Redesigned 2026-10-04.
 *
 * ★ The e-mail path is gone from this screen at the client's word — «email-ийг
 * ашиглахаа больсон, зөвхөн дугаар». Most parents here have a phone and no
 * e-mail, and the e-mail form was where they used to be told to go and find
 * an administrator. `POST /auth/password-reset` still exists on the API; this
 * screen no longer calls it.
 *
 * Three steps on one card — the number, the SMS, the new password — drawn on
 * the same backdrop and card as the login it is reached from, so recovering an
 * account feels like the front door rather than a back office.
 *
 * ★★ It never says whether an account holds a number until the SMS has
 * proven the number is the asker's (`accountFound`, `docs/SECURITY.md` §2.1).
 * The first step reads identically for every number typed.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const availability = usePhoneVerificationAvailability();

  const [phone, setPhone] = useState("");
  const [proof, setProof] = useState<{ handle: string; accountFound: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const sms = usePhoneVerification({
    start: (value) =>
      mutate("/auth/password-reset/phone", phoneVerificationStartSchema, {
        method: "POST",
        body: { phone: value },
      }),
    onVerified: (handle, check) => setProof({ handle, accountFound: check.accountFound === true }),
  });

  const reset = useMutation({
    mutationFn: () =>
      mutate("/auth/password-reset/phone/confirm", z.unknown(), {
        method: "POST",
        body: { handle: proof?.handle, password },
      }),
    onSuccess: () => {
      setTimeout(() => router.replace("/login"), 2500);
    },
  });
  const errors = fieldErrors(reset.error);

  const phase: Phase = reset.isSuccess
    ? "done"
    : proof
      ? proof.accountFound
        ? "password"
        : "no-account"
      : sms.session
        ? "sms"
        : "phone";

  /*
   * Focus follows the step. The card's content is replaced wholesale, and a
   * screen reader left on a button that no longer exists hears nothing; the
   * heading is where the new step starts.
   */
  const heading = useRef<HTMLHeadingElement>(null);
  const firstPhase = useRef(true);
  useEffect(() => {
    if (firstPhase.current) {
      firstPhase.current = false;
      return;
    }
    heading.current?.focus();
  }, [phase]);

  function startOver() {
    setProof(null);
    setPassword("");
    setConfirm("");
    setLocalError(null);
    sms.reset();
  }

  function onSubmitPhone(event: FormEvent) {
    event.preventDefault();
    if (MOBILE_PHONE.test(phone) && !sms.starting) sms.begin(phone);
  }

  function onSubmitPassword(event: FormEvent) {
    event.preventDefault();
    if (reset.isPending) return;
    const weaknesses = validatePasswordStrength(password);
    if (weaknesses.length > 0) {
      setLocalError(`${weaknesses.join(". ")}.`);
      return;
    }
    if (password !== confirm) {
      setLocalError("Хоёр нууц үг таарахгүй байна.");
      return;
    }
    setLocalError(null);
    reset.mutate();
  }

  const copy = COPY[availability.loading ? "phone" : availability.enabled ? phase : "off"];

  return (
    <div className="relative isolate min-h-dvh bg-primary-soft bg-[url('/background/login-mobile.png')] bg-cover bg-top bg-no-repeat px-5 pb-[45vw] pt-6 sm:px-8 lg:bg-[url('/background/login-desktop.png')] lg:px-[7vw] lg:pb-10 lg:pt-10">
      {/* The login hero's own grid width, so the card sits where the login
          card sat and the backdrop's illustration stays clear of it. */}
      <main className="mx-auto w-full max-w-[1320px]">
        <div className="mx-auto w-full max-w-[440px] lg:mx-0">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-pill px-1 text-body font-semibold text-primary-strong hover:underline"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Нэвтрэх хуудас
          </Link>

          <section
            aria-labelledby="reset-heading"
            className="relative mt-12 rounded-card border border-white/80 bg-white/95 p-6 shadow-[0_24px_70px_rgba(25,72,111,.16)] backdrop-blur-xl [overflow-wrap:anywhere] sm:p-8"
          >
            {/*
            The teacher from the login backdrop, leaning over the card's edge.
            Decorative — the heading says everything she does.
          */}
            <Image
              src="/background/mascot-girl-teal-b.webp"
              alt=""
              aria-hidden="true"
              width={92}
              height={240}
              className="pointer-events-none absolute -top-[68px] right-6 h-[104px] w-auto drop-shadow-sm select-none"
              priority
            />

            <span className="inline-flex items-center gap-2 rounded-pill bg-primary-soft px-3 py-1.5 text-caption font-bold text-primary-strong">
              <span className="size-2 rounded-pill bg-primary" aria-hidden="true" />
              Нууц үг сэргээх
            </span>

            {availability.enabled && phase !== "done" && phase !== "no-account" ? (
              <Stepper current={STEP_OF[phase]} />
            ) : null}

            <h1
              id="reset-heading"
              ref={heading}
              tabIndex={-1}
              className="mt-5 text-heading font-extrabold leading-heading tracking-tight text-ink outline-none"
            >
              {copy.title}
            </h1>
            <p className="mt-2 text-body leading-6 text-muted">{copy.lede}</p>

            <div key={availability.loading ? "loading" : phase} className="mt-6 animate-step-in">
              {availability.loading ? (
                <div className="h-[132px] animate-pulse rounded-control bg-canvas" />
              ) : !availability.enabled ? (
                <OffState />
              ) : phase === "phone" ? (
                <form onSubmit={onSubmitPhone} className="flex flex-col gap-4" noValidate>
                  <FormError message={sms.startError} />
                  <PhoneField value={phone} onChange={setPhone} />
                  <Button
                    type="submit"
                    block
                    disabled={!MOBILE_PHONE.test(phone) || sms.starting}
                    className={PRIMARY_ACTION}
                  >
                    {sms.starting ? "Код авч байна…" : "Код авах"}
                    {!sms.starting ? <ArrowRight size={18} aria-hidden="true" /> : null}
                  </Button>
                </form>
              ) : phase === "sms" && sms.session ? (
                <SmsStep
                  code={sms.session.code}
                  shortcode={sms.session.shortcode}
                  smsUri={sms.session.smsUri}
                  instruction={sms.session.displayInstruction}
                  secondsLeft={sms.secondsLeft}
                  totalSeconds={sms.session.totalSeconds}
                  expired={sms.expired}
                  restarting={sms.starting}
                  error={sms.startError}
                  onRestart={() => sms.begin(phone)}
                  onChangeNumber={startOver}
                />
              ) : phase === "password" ? (
                <form onSubmit={onSubmitPassword} className="flex flex-col gap-4" noValidate>
                  <p
                    role="status"
                    className="flex items-center gap-2 self-start rounded-pill bg-mint px-3 py-1.5 text-caption font-bold text-mint-ink"
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {phone} баталгаажлаа
                  </p>

                  <FormError
                    message={localError ?? (reset.isError ? errorMessage(reset.error) : null)}
                  />

                  <Field label="Шинэ нууц үг" error={errors.password} required>
                    {({ id, describedBy, invalid }) => (
                      <IconInput icon={<LockKeyhole aria-hidden="true" />}>
                        <PasswordInput
                          id={id}
                          aria-describedby={describedBy}
                          invalid={invalid}
                          autoComplete="new-password"
                          autoFocus
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className={ICON_INPUT}
                        />
                      </IconInput>
                    )}
                  </Field>

                  <RuleList password={password} />

                  <Field label="Нууц үгээ давтан оруулна уу" required>
                    {({ id, describedBy }) => (
                      <IconInput icon={<LockKeyhole aria-hidden="true" />}>
                        <PasswordInput
                          id={id}
                          aria-describedby={describedBy}
                          autoComplete="new-password"
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          className={ICON_INPUT}
                        />
                      </IconInput>
                    )}
                  </Field>
                  {confirm && confirm === password ? (
                    <p className="-mt-2 flex items-center gap-1.5 text-caption font-semibold text-mint-ink">
                      <Check size={14} aria-hidden="true" />
                      Нууц үг таарч байна
                    </p>
                  ) : null}

                  <Button type="submit" block disabled={reset.isPending} className={PRIMARY_ACTION}>
                    {reset.isPending ? "Хадгалж байна…" : "Нууц үг шинэчлэх"}
                  </Button>
                </form>
              ) : phase === "no-account" ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3 rounded-control bg-peach/50 p-4">
                    <SearchX className="mt-0.5 size-5 shrink-0 text-peach-ink" aria-hidden="true" />
                    <p role="status" className="text-body leading-6 text-ink">
                      <span className="font-bold tabular-nums">{phone}</span> дугаартай бүртгэл
                      олдсонгүй.
                    </p>
                  </div>
                  <Button variant="secondary" block onClick={startOver} className="h-13">
                    <RotateCcw size={18} aria-hidden="true" />
                    Өөр дугаар оруулах
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 py-2 text-center">
                  <span className="grid size-16 place-items-center rounded-pill bg-mint text-mint-ink shadow-sm">
                    <Check className="size-8" strokeWidth={3} aria-hidden="true" />
                  </span>
                  <p role="status" className="text-body text-muted">
                    Нэвтрэх хуудас руу шилжиж байна…
                  </p>
                  <Button asChild block className={PRIMARY_ACTION}>
                    <Link href="/login">
                      Нэвтрэх
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
            {/*
              Inside the card, not under it: below the card the backdrop's
              illustration begins, and a sentence over a drawn face is a
              sentence nobody can read on a phone.
            */}
            <div className="mt-6 border-t border-border pt-4 text-center">
              <p className="text-caption leading-5 text-muted">
                Утасны дугаараа сольсон бол цэцэрлэгийн администратортаа хандана уу.
              </p>
              <nav
                aria-label="Нууцлал ба тусламж"
                className="mt-1 flex flex-wrap justify-center gap-x-4 text-caption font-semibold text-primary"
              >
                <Link href="/privacy" className="min-h-10 content-center hover:underline">
                  Нууцлал
                </Link>
                <Link href="/terms" className="min-h-10 content-center hover:underline">
                  Үйлчилгээний нөхцөл
                </Link>
                <Link href="/faq" className="min-h-10 content-center hover:underline">
                  Түгээмэл асуулт
                </Link>
              </nav>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

type Phase = "phone" | "sms" | "password" | "no-account" | "done";

const STEP_OF = { phone: 0, sms: 1, password: 2, "no-account": 1, done: 2 } as const;

const COPY: Record<Phase | "off", { title: string; lede: string }> = {
  phone: {
    title: "Дугаараа оруулна уу",
    lede: "Бүртгэлтэй дугаараасаа нэг SMS илгээж, шинэ нууц үг тохируулна.",
  },
  sms: {
    title: "SMS илгээнэ үү",
    lede: "Доорх кодыг утаснаасаа илгээмэгц энэ хуудас өөрөө үргэлжилнэ.",
  },
  password: {
    title: "Шинэ нууц үг",
    lede: "Дараа нь энэ нууц үгээрээ нэвтэрнэ. Бусдад хэлэхгүй байгаарай.",
  },
  "no-account": {
    title: "Бүртгэл олдсонгүй",
    lede: "Цэцэрлэгт өгсөн дугаараа оруулсан эсэхээ шалгана уу.",
  },
  done: {
    title: "Нууц үг шинэчлэгдлээ",
    lede: "Шинэ нууц үгээрээ нэвтэрч орно уу.",
  },
  off: {
    title: "Нууц үгээ мартсан уу?",
    lede: "Цэцэрлэгийн администратор таны нууц үгийг сэргээж өгнө.",
  },
};

/** The login card's own field and button proportions, so the two screens match. */
const ICON_INPUT =
  "h-13 rounded-control border-border bg-canvas pl-11 text-body transition-colors focus:bg-white";
const PRIMARY_ACTION =
  "h-13 rounded-control text-body font-bold shadow-[0_10px_24px_rgba(29,78,216,.24)] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_26px_rgba(29,78,216,.28)]";

function IconInput({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-faint [&_svg]:size-[17px]">
        {icon}
      </span>
      {children}
    </div>
  );
}

/**
 * The number, as a Mongolian mobile is written: «+976» fixed in front, eight
 * digits after it. Anything that is not a digit is dropped as it is typed, so
 * "9911 2233" pasted from a contact card becomes the number it means.
 */
function PhoneField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const tooShort = value.length > 0 && !MOBILE_PHONE.test(value);
  return (
    <Field
      label="Утасны дугаар"
      hint={tooShort ? "8 оронтой дугаар оруулна уу." : undefined}
      required
    >
      {({ id, describedBy }) => (
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 flex -translate-y-1/2 items-center gap-2 text-body font-semibold text-muted">
            <Phone className="size-[17px] text-faint" aria-hidden="true" />
            +976
            <span className="h-5 w-px bg-border" aria-hidden="true" />
          </span>
          <Input
            id={id}
            aria-describedby={describedBy}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            autoFocus
            maxLength={8}
            placeholder="9911 2233"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="h-13 rounded-control border-border bg-canvas pl-[6.5rem] text-lead font-semibold tracking-wider tabular-nums transition-colors focus:bg-white"
          />
        </div>
      )}
    </Field>
  );
}

/** Дугаар → SMS → Нууц үг. */
function Stepper({ current }: { current: 0 | 1 | 2 }) {
  const steps = ["Дугаар", "SMS", "Нууц үг"];
  return (
    <ol className="mt-5 grid grid-cols-3" aria-label="Алхам">
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className="relative flex flex-col items-center gap-1.5"
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute right-1/2 top-4 z-0 h-0.5 w-full -translate-y-1/2 transition-colors duration-500",
                  index <= current ? "bg-primary" : "bg-border",
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 grid size-8 place-items-center rounded-pill text-caption font-bold transition-all duration-300",
                done && "bg-primary text-primary-ink",
                active && "bg-primary text-primary-ink ring-4 ring-primary/15",
                !done && !active && "border-2 border-border bg-white text-faint",
              )}
            >
              {done ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-caption font-semibold",
                active ? "text-primary-strong" : done ? "text-ink" : "text-faint",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The code as a ticket, the one action that sends it, and time running out.
 *
 * ★ verify.mn's `displayInstruction` is shown verbatim: it names the number
 * the SMS must come from, and sending from the other SIM is the commonest
 * reason a code never arrives.
 */
function SmsStep({
  code,
  shortcode,
  smsUri,
  instruction,
  secondsLeft,
  totalSeconds,
  expired,
  restarting,
  error,
  onRestart,
  onChangeNumber,
}: {
  code: string;
  shortcode: string;
  smsUri: string;
  instruction: string;
  secondsLeft: number;
  totalSeconds: number;
  expired: boolean;
  restarting: boolean;
  error: string | null;
  onRestart: () => void;
  onChangeNumber: () => void;
}) {
  const share = Math.max(0, Math.min(1, secondsLeft / totalSeconds));

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />

      <div
        className={cn(
          "relative overflow-hidden rounded-control border-2 border-dashed p-5 text-center transition-opacity",
          expired ? "border-border bg-canvas opacity-60" : "border-primary/30 bg-primary-soft",
        )}
      >
        <p className="text-caption font-bold uppercase tracking-wider text-primary-strong">
          Илгээх код
        </p>
        <p
          className={cn(
            "mt-1 whitespace-nowrap text-figure font-black tabular-nums tracking-[0.2em] text-primary-strong [overflow-wrap:normal]",
            expired && "line-through decoration-2",
          )}
        >
          {code}
        </p>
        <p className="mt-2 flex items-center justify-center gap-2 text-body font-semibold text-ink">
          <ArrowRight size={16} className="text-primary" aria-hidden="true" />
          <span className="tabular-nums">{shortcode}</span> дугаарт
        </p>
      </div>

      {expired ? (
        <>
          <p role="status" className="text-body leading-6 text-ink">
            Хугацаа дууссан тул энэ код хүчингүй боллоо. Шинэ код авна уу.
          </p>
          <Button block disabled={restarting} onClick={onRestart} className={PRIMARY_ACTION}>
            <RotateCcw size={18} aria-hidden="true" />
            {restarting ? "Код авч байна…" : "Шинэ код авах"}
          </Button>
        </>
      ) : (
        <>
          <Button asChild block className={PRIMARY_ACTION}>
            <a href={smsUri}>
              <MessageSquareText size={18} aria-hidden="true" />
              SMS бичих
            </a>
          </Button>

          <p className="text-compact leading-5 text-muted">{instruction}</p>

          <div>
            <div className="flex items-center justify-between text-caption font-semibold">
              <span role="status" aria-live="polite" className="flex items-center gap-2 text-ink">
                <span className="relative flex size-2.5" aria-hidden="true">
                  <span className="absolute inline-flex size-full animate-ping rounded-pill bg-primary opacity-60" />
                  <span className="relative inline-flex size-2.5 rounded-pill bg-primary" />
                </span>
                SMS хүлээж байна
              </span>
              <span className="tabular-nums text-muted">{formatSeconds(secondsLeft)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-track" aria-hidden="true">
              <div
                className={cn(
                  "h-full rounded-pill transition-[width] duration-1000 ease-linear",
                  share < 0.2 ? "bg-danger" : "bg-primary",
                )}
                style={{ width: `${share * 100}%` }}
              />
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onChangeNumber}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 self-center text-caption font-semibold text-primary hover:underline"
      >
        <Phone size={14} aria-hidden="true" />
        Дугаар солих
      </button>
    </div>
  );
}

/** The three rules, ticked off as they are met rather than listed as failures. */
function RuleList({ password }: { password: string }) {
  const met = passwordRuleStatus(password);
  return (
    <ul className="-mt-1 flex flex-col gap-1.5" aria-label="Нууц үгийн шаардлага">
      {PASSWORD_RULES.map((rule, index) => (
        <li
          key={rule}
          className={cn(
            "flex items-center gap-2 text-caption font-medium transition-colors",
            met[index] ? "text-mint-ink" : "text-muted",
          )}
        >
          <span
            className={cn(
              "grid size-4 place-items-center rounded-pill transition-colors",
              met[index] ? "bg-mint" : "border border-border bg-white",
            )}
            aria-hidden="true"
          >
            {met[index] ? <Check className="size-3" strokeWidth={3} /> : null}
          </span>
          {rule}
          <span className="sr-only">{met[index] ? " — хангасан" : " — хангаагүй"}</span>
        </li>
      ))}
    </ul>
  );
}

/** No verify.mn key on this deployment: the only way back is an administrator. */
function OffState() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-control bg-canvas p-4">
        <PhoneOff className="mt-0.5 size-5 shrink-0 text-faint" aria-hidden="true" />
        <p className="text-body leading-6 text-ink">
          Утсаар сэргээх боломж одоогоор идэвхгүй байна. Цэцэрлэгийн администратортаа хандаж нууц
          үгээ сэргээлгэнэ үү.
        </p>
      </div>
      <Button asChild variant="secondary" block className="h-13">
        <Link href="/login">
          <ArrowLeft size={18} aria-hidden="true" />
          Нэвтрэх хуудас руу буцах
        </Link>
      </Button>
    </div>
  );
}
