import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

/**
 * Loading, empty and error — the three states every screen actually spends time
 * in, and the three that get skipped when a screen is built against seeded data.
 *
 * They live here as components rather than as a pattern to copy so that a new
 * screen gets all three by construction. A blank white rectangle while data
 * loads is indistinguishable from a broken screen.
 */

/**
 * A skeleton.
 *
 * `aria-hidden` with a live region alongside: animated grey boxes announced
 * individually are noise, so the *status* is announced once and the shapes are
 * hidden.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("animate-pulse rounded-control bg-canvas", className)} />
  );
}

export function LoadingState({
  label = "Ачаалж байна…",
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div>
      {/* Announced once, politely — not on every skeleton row. */}
      <p role="status" className="sr-only">
        {label}
      </p>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-[72px] w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Nothing here — and why.
 *
 * Always says what would appear and, where there is one, offers the action that
 * creates the first item. "Хоосон" on its own tells a teacher nothing about
 * whether the screen is broken or the day is quiet.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-1 text-muted">{icon}</div> : null}
      <p className="font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-body text-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </Card>
  );
}

/**
 * Something failed.
 *
 * `role="alert"` so it is announced, and a retry wherever the caller can offer
 * one — an error with no way forward is a dead end the user can only escape by
 * reloading.
 */
export function ErrorState({
  title = "Алдаа гарлаа",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card
      role="alert"
      className="flex flex-col items-center gap-2 border-danger/30 bg-danger-soft px-6 py-10 text-center"
    >
      <p className="font-medium text-danger">{title}</p>
      {description ? <p className="max-w-sm text-body text-ink/70">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </Card>
  );
}

/**
 * A form-level error, distinct from a field error.
 *
 * "Distinguish field vs global errors": a wrong password and a failed network
 * request are not attached to any one input, and attaching them to the first
 * field is how a user ends up retyping something that was never wrong.
 */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="rounded-control border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-body font-medium text-danger"
    >
      {message}
    </p>
  );
}
