import { AlertTriangle } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
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
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-control bg-sunken", className)}
      style={style}
    />
  );
}

/**
 * What a loading screen is shaped like.
 *
 * ★ REDESIGN 2026-09-03. `LoadingState` painted `rows` identical 72px grey
 * rectangles for every screen in the product — the dashboard's card bands, the
 * roster's child rows and the assessment grid all loaded as the same stack of
 * blocks, and then the real content arrived with a different shape and the page
 * jumped.
 *
 * The brief asks the opposite twice: §4.1 wants loading and error to "share the
 * same header so nothing shifts when the query resolves", and constraint 12
 * asks for skeletons rather than spinners. A skeleton whose shape is unrelated
 * to what is coming is a spinner drawn as rectangles.
 *
 * These are the four shapes the product actually loads. Anything genuinely
 * one-off keeps composing `Skeleton` directly — a variant per screen is how a
 * scale becomes a list.
 */
const SHAPES = {
  /** A stack of list rows — the roster, notifications, the review queue. */
  rows: "h-[76px] w-full rounded-row",
  /** Full-width card bands — the dashboard, a detail screen's sections. */
  cards: "h-[152px] w-full rounded-card",
  /** A register: a name and a control per line, tighter than a card. */
  register: "h-[64px] w-full rounded-row",
  /** Short lines of prose — a form, a narrative report. */
  text: "h-[20px] w-full rounded-control",
} as const;

export function LoadingState({
  label = "Ачаалж байна…",
  rows = 3,
  shape = "rows",
  className,
}: {
  label?: string;
  rows?: number;
  /** Which of the product's four loading shapes this screen is about to show. */
  shape?: keyof typeof SHAPES;
  className?: string;
}) {
  return (
    <div className={className}>
      {/* Announced once, politely — not on every skeleton row. */}
      <p role="status" className="sr-only">
        {label}
      </p>
      <div className="card-stack">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton
            key={i}
            className={cn(
              SHAPES[shape],
              /*
                ★ The last row is short, and the stagger is not decoration.
                A block of identical full-width bars reads as a rendering
                fault; one ragged edge is what makes it read as text that has
                not arrived yet. The delay does the same for the pulse — all
                rows breathing in unison looks mechanical.
              */
              shape === "text" && i === rows - 1 && "w-3/5",
            )}
            style={{ animationDelay: `${i * 90}ms` }}
          />
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
  illustration,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /**
   * A small lucide glyph. Sits at `--color-muted`, which is correct on the
   * card's white — it is not correct on a tint, so a toned empty state should
   * use `illustration` instead.
   */
  icon?: ReactNode;
  /**
   * Artwork, given real room — a mascot or a feature illustration.
   *
   * ★ A separate slot from `icon`, not a bigger version of it.
   *
   * A 20px glyph and a 96px drawing want different space above the title and
   * different treatment: the glyph is a hint, the drawing is the first thing a
   * reader sees. One slot doing both means every call site passes a size, and
   * then no two empty states in the product are the same height.
   *
   * ★★ Nothing is drawn when this is absent. There is deliberately no default
   * illustration: a placeholder shipped everywhere is how a product ends up
   * with the same shrug on 34 screens, and `/home` already shows what a chosen
   * one is worth. Screens are wired to real artwork one at a time.
   *
   * The caller passes the `<Image>`, so it is `aria-hidden` at the call site
   * with `alt=""` — the title beside it already says what is empty.
   */
  illustration?: ReactNode;
}) {
  /*
   * ★ REDESIGN 2026-09-03 — the glyph sits in a tinted disc, and the type has
   * a hierarchy.
   *
   * This was a centred paragraph in a white box: a bare grey icon, then a
   * medium-weight line, then a muted line, all at nearly the same size. An
   * empty state is the *first* thing a teacher sees on a screen they have not
   * used yet, and constraint 15 asks it to say what to do next — which it
   * cannot do if the eye has nothing to land on.
   *
   * The disc gives the glyph a home and picks up the brand tint, so an empty
   * screen reads as part of the product rather than as a failure. The title
   * steps up to `text-title` semibold, and the description is given a measure
   * (`max-w-sm`) so it wraps as a paragraph rather than a full-width line —
   * which matters more in Mongolian, where the compounds are long.
   */
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {illustration ? <div className="mb-2">{illustration}</div> : null}
      {!illustration && icon ? (
        <div className="mb-3 flex size-14 items-center justify-center rounded-pill bg-primary-soft text-primary">
          {icon}
        </div>
      ) : null}
      <p className="text-title font-semibold tracking-[-.01em] text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-body leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
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
  /*
   * ★ REDESIGN 2026-09-03 — the same composition as `EmptyState`, in the
   * danger register.
   *
   * The two were built separately and looked it: one had a glyph in a disc and
   * a title, the other was two lines of centred text on a pink field. They
   * appear in the same slot on the same screens — the dashboard renders one or
   * the other into the identical position under the identical header — so the
   * page visibly changed shape depending on whether a request had failed.
   * Matching them is what lets the header's promise ("nothing shifts when the
   * query resolves") hold for the error branch too.
   */
  return (
    <Card
      role="alert"
      className="flex flex-col items-center gap-2 border-danger/25 bg-danger-soft px-6 py-12 text-center"
    >
      <div className="mb-3 flex size-14 items-center justify-center rounded-pill bg-danger/10 text-danger">
        <AlertTriangle size={24} aria-hidden="true" />
      </div>
      <p className="text-title font-semibold tracking-[-.01em] text-danger">{title}</p>
      {description ? (
        <p className="max-w-sm text-body leading-relaxed text-ink/70">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
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
