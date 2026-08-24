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
 * Accepting an invitation — choosing the first password on a new account.
 *
 * ★ Not the same screen as a password reset, though they look alike.
 *
 * A reset recovers an account somebody already had. This is the first time
 * anyone can open the account at all: until it succeeds the password is 32
 * random bytes nobody has seen, so there is nothing to recover and nothing to
 * confirm. The API keeps the two apart for the same reason — an invitation
 * token must never be usable to reset an existing user's password.
 *
 * The wording follows from that. "Тавтай морил" rather than "Нууц үг сэргээх",
 * because the person reading it has never been here before.
 */
export default function AcceptInvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () =>
      mutate("/auth/invitation/accept", z.unknown(), {
        method: "POST",
        body: { token: params.token, password },
      }),
    onSuccess: () => {
      // Straight to the login form: the account now has a credential and the
      // API cleared the cookies, so signing in is one deliberate step.
      setTimeout(() => router.replace("/login"), 2000);
    },
  });

  const errors = fieldErrors(accept.error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (accept.isPending) return;

    if (password.length < MIN_LENGTH) {
      setLocalError(`Нууц үг дор хаяж ${MIN_LENGTH} тэмдэгт байх ёстой.`);
      return;
    }
    // Checked here and not sent: the API takes one password, and a mismatch is
    // a typing mistake the user should learn about without a round trip.
    if (password !== confirm) {
      setLocalError("Хоёр нууц үг таарахгүй байна.");
      return;
    }

    setLocalError(null);
    accept.mutate();
  }

  if (accept.isSuccess) {
    return (
      <AuthShell>
        <h2 className="mb-1.5 text-heading font-semibold tracking-[-.01em] text-ink">
          Бүртгэл идэвхжлээ
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
      <h2 className="mb-1.5 text-heading font-semibold tracking-[-.01em] text-ink">Тавтай морил</h2>
      <p className="mb-4 text-body leading-relaxed text-muted">
        Бүртгэлээ идэвхжүүлэхийн тулд нууц үгээ сонгоно уу.
      </p>

      <ul className="mb-4 list-disc space-y-1 pl-5 text-body text-muted">
        <li>{MIN_LENGTH}-аас доошгүй тэмдэгт</li>
      </ul>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={localError ?? (accept.isError ? errorMessage(accept.error) : null)} />

        <Field label="Нууц үг" error={errors.password} required>
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

        <Button type="submit" size="lg" block disabled={accept.isPending}>
          {accept.isPending ? "Идэвхжүүлж байна…" : "Бүртгэл идэвхжүүлэх"}
        </Button>
      </form>

      <p className="mt-[22px] border-t border-border pt-4 text-body leading-relaxed text-muted">
        Урилга хүчингүй болсон бол цэцэрлэгийн багш, администратортаа хандаж шинээр авна уу.
      </p>
    </AuthShell>
  );
}
