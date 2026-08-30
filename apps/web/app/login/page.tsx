"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { primaryDashboardSchema, sessionSchema } from "@kinder/contracts";
import { mutate, get } from "@/lib/api/browser";
import { rememberCsrfToken } from "@/lib/api/csrf";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { AuthShell } from "@/components/shell/auth-shell";

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
      const session = await mutate("/auth/login", sessionSchema, {
        method: "POST",
        body: { identifier, password },
      });

      // Login is the one unsafe request that needs no CSRF token — it is
      // `@Public()`, there being no session yet to pair one with. Its response
      // carries the token for every request after it. `SessionProvider` will
      // mirror the same value once `/auth/me` answers; taking it here closes
      // the window in between, so a save made immediately after signing in
      // cannot go out unaccompanied.
      rememberCsrfToken(session.csrfToken);

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
        primary.dashboard === "platform"
          ? "/platform"
          : primary.dashboard === "admin"
            ? "/admin"
            : primary.dashboard === "teacher"
              ? "/dashboard"
              : // The screen each support role exists for. Neither can open
                // `/dashboard` — every widget on it is about children — so
                // sending them there would meet a permission wall on the first
                // screen after signing in.
                primary.dashboard === "cook"
                ? "/menu"
                : primary.dashboard === "accountant"
                  ? "/finance"
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
    <AuthShell>
      <h2 className="mb-1.5 text-heading font-semibold tracking-[-.01em] text-ink">Нэвтрэх</h2>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError
          message={
            login.isError && Object.keys(errors).length === 0 ? errorMessage(login.error) : null
          }
        />

        {/*
          ★ One field, naming all three things it accepts.

          A segmented Багш / Эцэг эх / Админ control stood above this. It changed
          only this label, two of its three options changed it to the same
          string, and the choice was never sent to the API — see `auth-shell.tsx`.
          Asking someone to classify themselves before they can type their
          username is a decision the system does not need and cannot use.
        */}
        <Field label="Нэвтрэх нэр, утас эсвэл и-мэйл" error={errors.identifier} required>
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
      </form>

      {/*
        Left-aligned above a rule, as in the reference. The reference's own link
        is 17px tall — measured — which is not a tappable target, so this one
        keeps the 44px floor while looking the same.
      */}
      <p className="mt-[22px] border-t border-border pt-4">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-[44px] items-center text-body font-semibold text-primary hover:underline"
        >
          Нууц үгээ мартсан уу?
        </Link>
      </p>
    </AuthShell>
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
