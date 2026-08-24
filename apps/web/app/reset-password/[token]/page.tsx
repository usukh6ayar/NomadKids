"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { AuthShell } from "@/components/shell/auth-shell";

const MIN_LENGTH = 8;

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

    if (password.length < MIN_LENGTH) {
      setLocalError(`Нууц үг дор хаяж ${MIN_LENGTH} тэмдэгт байх ёстой.`);
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
        ★ One rule, because one rule is enforced.
        The reference lists four — length, upper, lower, digit — mirroring
        Django's AUTH_PASSWORD_VALIDATORS. This API's `auth.dto.ts` requires
        length alone. Copying the list would announce requirements that do not
        exist and reject nothing, which teaches users the messages are noise.
      */}
      <ul className="mb-4 list-disc space-y-1 pl-5 text-body text-muted">
        <li>{MIN_LENGTH}-аас доошгүй тэмдэгт</li>
      </ul>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={localError ?? (reset.isError ? errorMessage(reset.error) : null)} />

        <Field label="Шинэ нууц үг" error={errors.password} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        <Field label="Нууц үгээ давтан оруулна уу" required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="password"
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
