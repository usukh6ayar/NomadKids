"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import {
  PASSWORD_RULES,
  phoneVerificationStartSchema,
  validatePasswordStrength,
} from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { TabButton, Tabs } from "@/components/ui/tabs";
import { AuthShell } from "@/components/shell/auth-shell";
import {
  MOBILE_PHONE,
  PhoneVerificationStep,
  usePhoneVerificationEnabled,
} from "@/components/auth/phone-verification";

/**
 * Request a password reset.
 *
 * ★ The success message never says whether the account exists.
 *
 * The endpoint answers 204 either way — deliberately, and timing-neutrally —
 * so that it cannot be used to enumerate which teachers and parents have
 * accounts. Writing "И-мэйл илгээгдлээ" only on success would hand that back
 * through the UI and undo the API's care.
 */
export default function ForgotPasswordPage() {
  const phoneEnabled = usePhoneVerificationEnabled();
  const [channel, setChannel] = useState<"email" | "phone">("email");
  const [identifier, setIdentifier] = useState("");

  const request = useMutation({
    mutationFn: () =>
      mutate("/auth/password-reset", z.unknown(), {
        method: "POST",
        body: { identifier },
      }),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (request.isPending) return;
    request.mutate();
  }

  return (
    <AuthShell>
      <h2 className="mb-1.5 text-heading font-semibold tracking-[-.01em] text-ink">
        Нууц үг сэргээх
      </h2>

      {/*
        ★ «Утсаар» exists only where verify.mn is configured — 2026-10-01. It
        is the way back in for the parents this page used to send to an
        administrator: a phone number and no e-mail.
      */}
      {phoneEnabled ? (
        <div className="mb-4">
          <Tabs label="Сэргээх арга">
            <TabButton active={channel === "email"} onClick={() => setChannel("email")}>
              И-мэйлээр
            </TabButton>
            <TabButton active={channel === "phone"} onClick={() => setChannel("phone")}>
              Утсаар
            </TabButton>
          </Tabs>
        </div>
      ) : null}

      {phoneEnabled && channel === "phone" ? (
        <PhoneReset />
      ) : request.isSuccess ? (
        <p role="status" className="text-body leading-relaxed text-ink">
          Хэрэв ийм бүртгэл байгаа бол сэргээх заавар илгээгдэнэ. И-мэйлээ шалгана уу.
        </p>
      ) : (
        <>
          {/*
            The reference asks for an e-mail address only. This asks for any
            identifier, because the API accepts any and many parents here have a
            phone number and no e-mail — refusing them would mean an account
            that can never be recovered. The wording is the reference's;
            the field is v2's, deliberately wider.
          */}
          <p className="mb-4 text-body leading-relaxed text-muted">
            Бүртгэлтэй хэрэглэгчийн нэр, и-мэйл эсвэл утсаа оруулна уу. Сэргээх холбоос илгээнэ.
          </p>

          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <FormError message={request.isError ? errorMessage(request.error) : null} />

            <Field label="Хэрэглэгчийн нэр, и-мэйл эсвэл утас" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  name="identifier"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              )}
            </Field>

            <Button type="submit" size="lg" block disabled={request.isPending}>
              {request.isPending ? "Илгээж байна…" : "Холбоос илгээх"}
            </Button>
          </form>
        </>
      )}

      <p className="mt-[22px] border-t border-border pt-4 text-body leading-relaxed text-muted">
        {phoneEnabled
          ? "И-мэйл хаяггүй бол «Утсаар» сонгож SMS-ээр сэргээнэ үү. Утсаа солисон бол цэцэрлэгийн администратортаа хандана уу."
          : "И-мэйл хаяггүй юу? Цэцэрлэгийн администратортаа хандаж нууц үгээ сэргээлгэнэ үү."}
      </p>
      <p>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center text-body font-semibold text-primary hover:underline"
        >
          Нэвтрэх хуудас руу буцах
        </Link>
      </p>
    </AuthShell>
  );
}

/**
 * «Утсаар» — a reset proven by one SMS from the account's own phone.
 *
 * Three steps on one screen: the number, the SMS, the new password. The
 * server answers the first identically whether or not an account holds the
 * number; it says so only once the SMS has arrived, when the person has
 * proven the number is theirs.
 */
function PhoneReset() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [proof, setProof] = useState<{ handle: string; accountFound: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const trimmed = phone.trim();
  const phoneValid = MOBILE_PHONE.test(trimmed);

  const reset = useMutation({
    mutationFn: () =>
      mutate("/auth/password-reset/phone/confirm", z.unknown(), {
        method: "POST",
        body: { handle: proof?.handle, password },
      }),
    onSuccess: () => {
      setTimeout(() => router.replace("/login"), 2000);
    },
  });
  const errors = fieldErrors(reset.error);

  function onSubmit(event: FormEvent) {
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

  if (reset.isSuccess) {
    return (
      <p role="status" className="text-body leading-relaxed text-ink">
        Нууц үг шинэчлэгдлээ. Нэвтрэх хуудас руу шилжиж байна…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Бүртгэлтэй утасны дугаар"
        hint={trimmed && !phoneValid ? "8 оронтой дугаар оруулна уу." : undefined}
        required
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            autoFocus
            disabled={proof !== null}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>

      {phoneValid && proof === null ? (
        <PhoneVerificationStep
          key={trimmed}
          phone={trimmed}
          start={(value) =>
            mutate("/auth/password-reset/phone", phoneVerificationStartSchema, {
              method: "POST",
              body: { phone: value },
            })
          }
          onVerified={(handle, check) =>
            setProof({ handle, accountFound: check.accountFound === true })
          }
        />
      ) : null}

      {proof && !proof.accountFound ? (
        <p role="status" className="text-body leading-relaxed text-ink">
          Энэ дугаартай бүртгэл олдсонгүй. Цэцэрлэгийн администратортаа хандана уу.
        </p>
      ) : null}

      {proof?.accountFound ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <p role="status" className="text-body font-semibold text-mint-ink">
            Утасны дугаар баталгаажлаа. Шинэ нууц үгээ сонгоно уу.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-body text-muted">
            {PASSWORD_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <FormError message={localError ?? (reset.isError ? errorMessage(reset.error) : null)} />
          <Field label="Шинэ нууц үг" error={errors.password} required>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Field label="Нууц үгээ давтан оруулна уу" required>
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" size="lg" block disabled={reset.isPending}>
            {reset.isPending ? "Хадгалж байна…" : "Нууц үг шинэчлэх"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
