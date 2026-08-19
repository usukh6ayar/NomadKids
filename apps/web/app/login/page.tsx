"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { primaryDashboardSchema, sessionSchema } from "@kinder/contracts";
import { mutate, get } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";

/**
 * Sign in.
 *
 * ★ No token is handled anywhere in this file. The API sets HttpOnly cookies on
 * the response; this component only learns *that* it worked and where to go.
 * That is the whole reason the login response carries a user summary rather
 * than a JWT — a token in a response body is a token some frontend eventually
 * puts in localStorage.
 *
 * Where to go next is asked of the server (`/dashboard/primary`) rather than
 * derived from the returned memberships. One rule, server-side, so the web app
 * and a future mobile client cannot disagree about where an admin-who-is-also-a
 * parent lands.
 */

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: async () => {
      await mutate("/auth/login", sessionSchema, {
        method: "POST",
        body: { identifier, password },
      });

      // Fetched after login so the redirect uses the new session's cookie.
      return get("/dashboard/primary", primaryDashboardSchema);
    },
    onSuccess: async (primary) => {
      // The session query is invalidated rather than written directly: one
      // source of truth, and `/auth/me` is what every other screen reads.
      await queryClient.invalidateQueries({ queryKey: qk.session() });

      // `from` is only honoured when it is a path on this origin. An absolute
      // URL here would make the login page an open redirect — a phishing link
      // that lands a real user on a real login form and then forwards them
      // somewhere else.
      const from = params.get("from");
      const safeFrom = from && from.startsWith("/") && !from.startsWith("//") ? from : null;

      if (safeFrom) {
        router.replace(safeFrom);
        return;
      }

      router.replace(
        primary.dashboard === "admin"
          ? "/admin"
          : primary.dashboard === "teacher"
            ? "/dashboard"
            : primary.dashboard === "parent"
              ? "/home"
              : // No membership at all — a real state after a revocation.
                "/no-access",
      );
    },
  });

  const errors = fieldErrors(login.error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // `isPending` also disables the button; this guards the Enter key, which
    // is how a double submit actually happens.
    if (login.isPending) return;
    login.mutate();
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-6 px-5 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-ink">NomadKids</h1>
        <p className="mt-1 text-sm text-muted">Хүүхдийн хөгжлийн цахим хавтас</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError
          message={
            login.isError && Object.keys(errors).length === 0 ? errorMessage(login.error) : null
          }
        />

        <Field label="Хэрэглэгчийн нэр, и-мэйл эсвэл утас" error={errors.identifier} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          )}
        </Field>

        <Field label="Нууц үг" error={errors.password} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        <Button type="submit" size="lg" block disabled={login.isPending}>
          {login.isPending ? "Нэвтэрч байна…" : "Нэвтрэх"}
        </Button>

        <Link
          href="/forgot-password"
          className="mx-auto inline-flex min-h-[44px] items-center text-sm text-primary underline underline-offset-4"
        >
          Нууц үгээ мартсан уу?
        </Link>
      </form>
    </main>
  );
}

export default function LoginPage() {
  // `useSearchParams` requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <LoginForm />
    </Suspense>
  );
}
