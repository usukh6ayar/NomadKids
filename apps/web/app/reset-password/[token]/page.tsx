"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { PASSWORD_RULES, validatePasswordStrength } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, PasswordInput } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { AuthShell } from "@/components/shell/auth-shell";

/**
 * Set a new password from an emailed token.
 *
 * The confirmation field is checked here and not sent — the API takes one
 * password, and a mismatch is a typing mistake the user should learn about
 * without a round trip. The length rule is checked client-side *and* by the
 * server; this copy is a convenience, not the rule.
 */
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
      // Every session was revoked server-side, so there is nothing to keep.
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
        <h2 className="mb-1.5 text-heading font-semibold tracking-[-.01em] text-ink">
          Нууц үг шинэчлэгдлээ
        </h2>
        <p role="status" className="text-body text-muted">
          Нэвтрэх хуудас руу шилжиж байна…
        </p>
        <p>
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center text-body font-semibold text-primary hover:underline"
          >
            Нэвтрэх
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h2 className="mb-2.5 text-heading font-semibold tracking-[-.01em] text-ink">Шинэ нууц үг</h2>

      {/*
        ★ Every rule, because every rule is enforced — corrected 2026-08-31.

        This block used to print the length alone and explained itself with
        "one rule, because one rule is enforced", reading `auth.dto.ts` and
        finding `min(8)` there. The other three live in `password.service.ts`
        and always have: `validatePasswordStrength` runs on reset, invitation
        and change, and rejects with a 401. So the screen understated the
        policy and the server enforced it — the worst arrangement of the two,
        since the user learns the rule only by breaking it.

        `PASSWORD_RULES` and the check below now come from the same module the
        API calls.
      */}
      <ul className="mb-4 list-disc space-y-1 pl-5 text-body text-muted">
        {PASSWORD_RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={localError ?? (reset.isError ? errorMessage(reset.error) : null)} />

        <Field label="Шинэ нууц үг" error={errors.password} required>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              autoComplete="new-password"
              autoFocus
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
          {reset.isPending ? "Хадгалж байна…" : "Нууц үг хадгалах"}
        </Button>
      </form>
    </AuthShell>
  );
}
