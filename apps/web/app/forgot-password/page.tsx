"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { AuthShell } from "@/components/shell/auth-shell";

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
    <AuthShell>
      <h2 className="mb-1.5 text-[1.35rem] font-bold tracking-[-.01em] text-ink">Нууц үг сэргээх</h2>

      {request.isSuccess ? (
        <p role="status" className="text-sm leading-relaxed text-ink">
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
          <p className="mb-4 text-sm leading-relaxed text-muted">
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

      <p className="mt-[22px] border-t border-border pt-4 text-sm leading-relaxed text-muted">
        И-мэйл хаяггүй юу? Цэцэрлэгийн администратортаа хандаж нууц үгээ сэргээлгэнэ үү.
      </p>
      <p>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:underline"
        >
          Нэвтрэх хуудас руу буцах
        </Link>
      </p>
    </AuthShell>
  );
}
