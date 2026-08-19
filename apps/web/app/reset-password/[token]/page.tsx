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
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/states";

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
      <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-5">
        <Card className="px-5 py-6 text-center">
          <p role="status" className="font-medium text-ink">
            Нууц үг шинэчлэгдлээ.
          </p>
          <p className="mt-1 text-sm text-muted">Нэвтрэх хуудас руу шилжиж байна…</p>
          <Link
            href="/login"
            className="mt-4 inline-flex min-h-[44px] items-center text-sm text-primary underline underline-offset-4"
          >
            Нэвтрэх
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-6 px-5 py-10">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-ink">Шинэ нууц үг</h1>
        <p className="mt-1 text-sm text-muted">
          Дор хаяж {MIN_LENGTH} тэмдэгттэй нууц үг оруулна уу.
        </p>
      </div>

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
          {reset.isPending ? "Хадгалж байна…" : "Нууц үг шинэчлэх"}
        </Button>
      </form>
    </main>
  );
}
