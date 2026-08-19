"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { FormError } from "@/components/ui/states";

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
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-6 px-5 py-10">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-ink">Нууц үг сэргээх</h1>
        <p className="mt-1 text-sm text-muted">
          Бүртгэлтэй хэрэглэгчийн нэр, и-мэйл эсвэл утсаа оруулна уу.
        </p>
      </div>

      {request.isSuccess ? (
        <Card className="px-5 py-6 text-center">
          <p role="status" className="text-sm text-ink">
            Хэрэв ийм бүртгэл байгаа бол сэргээх заавар илгээгдэнэ. И-мэйлээ шалгана уу.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex min-h-[44px] items-center text-sm text-primary underline underline-offset-4"
          >
            Нэвтрэх хуудас руу буцах
          </Link>
        </Card>
      ) : (
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
            {request.isPending ? "Илгээж байна…" : "Илгээх"}
          </Button>

          <Link
            href="/login"
            className="mx-auto inline-flex min-h-[44px] items-center text-sm text-muted underline underline-offset-4"
          >
            Буцах
          </Link>
        </form>
      )}
    </main>
  );
}
