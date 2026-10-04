"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Check, CheckCircle2, KeyRound, LockKeyhole } from "lucide-react";
import { z } from "zod";
import { PASSWORD_RULES, passwordRuleStatus, validatePasswordStrength } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, PasswordInput } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { AuthShell } from "@/components/shell/auth-shell";

/** Set a new password from the single-use link sent by an administrator. */
export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: () =>
      mutate("/auth/password-reset/confirm", z.unknown(), {
        method: "POST",
        body: { token: params.token, password },
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
      <AuthShell>
        <div className="py-2 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-pill bg-mint text-mint-ink">
            <CheckCircle2 className="size-8" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-heading font-extrabold tracking-tight text-ink">
            Нууц үг шинэчлэгдлээ
          </h1>
          <p role="status" className="mt-2 text-body text-muted">
            Нэвтрэх хуудас руу шилжиж байна…
          </p>
          <Button asChild size="lg" className="mt-6 w-full sm:w-auto">
            <Link href="/login">
              Нэвтрэх
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const ruleStatus = passwordRuleStatus(password);

  return (
    <AuthShell>
      <span className="inline-flex items-center gap-2 rounded-pill bg-primary-soft px-3 py-1.5 text-caption font-bold text-primary-strong">
        <KeyRound className="size-4" aria-hidden="true" />
        Нууц үг сэргээх
      </span>
      <h1 className="mt-4 text-heading font-extrabold tracking-tight text-ink sm:text-display">
        Шинэ нууц үг
      </h1>
      <p className="mt-2 text-body leading-6 text-muted">
        Цаашид нэвтрэхдээ ашиглах найдвартай нууц үгээ тохируулна уу.
      </p>

      <ul
        className="mt-5 grid gap-2 rounded-control bg-canvas p-4 text-caption"
        aria-label="Нууц үгийн шаардлага"
      >
        {PASSWORD_RULES.map((rule, index) => (
          <li
            key={rule}
            className={`flex items-center gap-2 font-medium ${ruleStatus[index] ? "text-mint-ink" : "text-muted"}`}
          >
            <span
              className={`grid size-5 shrink-0 place-items-center rounded-pill ${ruleStatus[index] ? "bg-mint" : "border border-border bg-white"}`}
              aria-hidden="true"
            >
              {ruleStatus[index] ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
            {rule}
          </li>
        ))}
      </ul>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <FormError message={localError ?? (reset.isError ? errorMessage(reset.error) : null)} />

        <Field label="Шинэ нууц үг" error={errors.password} required>
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
                autoComplete="new-password"
                autoFocus
                placeholder="Шинэ нууц үг"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-[52px] bg-canvas pl-11 focus:bg-white"
              />
            </div>
          )}
        </Field>

        <Field label="Нууц үгээ давтан оруулна уу" required>
          {({ id, describedBy }) => (
            <div className="relative">
              <LockKeyhole
                className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[17px] -translate-y-1/2 text-faint"
                aria-hidden="true"
              />
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                autoComplete="new-password"
                placeholder="Нууц үгээ дахин оруулна уу"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="h-[52px] bg-canvas pl-11 focus:bg-white"
              />
            </div>
          )}
        </Field>

        {confirm && confirm === password ? (
          <p className="-mt-1 flex items-center gap-1.5 text-caption font-semibold text-mint-ink">
            <Check className="size-4" aria-hidden="true" />
            Нууц үг таарч байна
          </p>
        ) : null}

        <Button type="submit" size="lg" block disabled={reset.isPending} className="mt-1">
          {reset.isPending ? "Хадгалж байна…" : "Нууц үг хадгалах"}
          {!reset.isPending ? <ArrowRight aria-hidden="true" /> : null}
        </Button>
      </form>
    </AuthShell>
  );
}
