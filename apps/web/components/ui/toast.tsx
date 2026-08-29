"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Toast after save" — CLAUDE.md §5, finally implemented once.
 *
 * ★ Before this there was no toast anywhere in the product.
 *
 * Every screen that saved something rendered its own success line: 14 files
 * carried an inline `save.isSuccess ? <p role="status" class="bg-mint …">`,
 * and roughly seventy other mutation sites reported nothing at all. A rule the
 * codebase contradicts in seventy places is not a rule, and the cost of the
 * absence is quiet — a teacher presses "Хадгалах", nothing visibly changes,
 * and they press it again.
 *
 * ★★ What a toast is NOT for here.
 *
 * A toast disappears, so it may only carry information the user can afford to
 * miss. Two kinds of feedback deliberately stay in place instead:
 *
 *  - **Errors that are instructions.** `archive-button.tsx` documents the case:
 *    the 409 an admin gets for a group that still has children in it *is* the
 *    next step, and it must not vanish after four seconds. Those stay inline.
 *  - **State the screen already shows.** The assessment publish badge flips to
 *    "Эцэг эхэд нээлттэй"; a toast repeating it would be noise.
 *
 * So `error` exists on this API for the failures that are genuinely transient
 * ("saved, but the photo did not upload"), and it is given twice the lifetime
 * of a success. A screen whose error is actionable should keep rendering it.
 */

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  show: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
  toasts: Toast[];
}

/**
 * ★ A no-op default rather than a thrown error.
 *
 * `useToast` outside a provider returns a context that does nothing. That is
 * deliberate: this is a *feedback* mechanism, and a missing provider must never
 * turn a working save into a white screen. The provider is mounted once at the
 * app root, so the degraded path is "the save worked and said nothing" — bad,
 * but not destructive.
 */
const noop: ToastContextValue = { show: () => {}, dismiss: () => {}, toasts: [] };
const ToastContext = createContext<ToastContextValue>(noop);

/** How long each tone stays, in ms. */
const LIFETIME: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  // Twice a success: an error is read, not glanced at, and Mongolian error
  // copy is longer than its English equivalent.
  error: 9000,
};

/**
 * At most three. A fourth pushes the oldest out rather than growing a column
 * that covers the content the user is trying to look at.
 */
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const arm = useCallback(
    (id: number, tone: ToastTone) => {
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME[tone]),
      );
    },
    [dismiss],
  );

  const show = useCallback(
    (tone: ToastTone, message: string) => {
      setToasts((current) => {
        /*
          ★ Deduplicated by tone + message.

          A double-clicked save, or a mutation whose `onSuccess` runs per item
          in a loop, would otherwise stack four identical "Хадгаллаа" cards. The
          existing one has its timer restarted instead, so the message stays as
          long as it keeps happening and the column never grows.
        */
        const duplicate = current.find((t) => t.tone === tone && t.message === message);
        if (duplicate) {
          arm(duplicate.id, tone);
          return current;
        }

        const id = nextId.current++;
        arm(id, tone);

        const next = [...current, { id, tone, message }];
        // Oldest out first, and its timer with it.
        while (next.length > MAX_VISIBLE) {
          const dropped = next.shift()!;
          const timer = timers.current.get(dropped.id);
          if (timer) clearTimeout(timer);
          timers.current.delete(dropped.id);
        }
        return next;
      });
    },
    [arm],
  );

  // Nothing may keep firing after the tree goes away.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ show, dismiss, toasts }), [show, dismiss, toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * `const toast = useToast(); toast.success("Хадгаллаа")`
 *
 * The three helpers are the whole API. A screen that needs anything more than
 * a sentence needs an inline message, not a toast.
 */
export function useToast(): {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
} {
  const { show } = useContext(ToastContext);

  return useMemo(
    () => ({
      success: (message: string) => show("success", message),
      error: (message: string) => show("error", message),
      info: (message: string) => show("info", message),
    }),
    [show],
  );
}

/** Test seam — lets a test read what was queued without driving the DOM. */
export function useToasts(): Toast[] {
  return useContext(ToastContext).toasts;
}

const TONE_STYLE: Record<ToastTone, string> = {
  success: "border-mint-ink/25 bg-mint text-mint-ink",
  error: "border-danger/30 bg-danger-soft text-danger",
  info: "border-sky-ink/25 bg-sky text-sky-ink",
};

const TONE_ICON: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

/**
 * Where the toasts live.
 *
 * ★ The region is always in the DOM, empty or not.
 *
 * A live region inserted at the same moment as its first message is not
 * reliably announced — the screen reader has to be observing the node before
 * the text arrives. So the container mounts with the provider and only its
 * children change.
 *
 * ★★ Two live regions, not one — and `aria-live` **without** a role.
 *
 * `polite` waits for the user to finish what they are saying; `assertive`
 * interrupts. A save confirmation must not interrupt, and a failure must not
 * wait, so they are separate regions: one region with a changing politeness is
 * read at whatever it was when the reader first saw it.
 *
 * They carry `aria-live` rather than `role="alert"` / `role="status"`, which
 * matters more than it looks. Those roles are only shorthand for the same
 * politeness — but they also put two permanent landmarks into the accessibility
 * tree of every page, because this viewport is always mounted. In practice that
 * broke eight existing tests the moment it shipped: `queryByRole("alert")` on
 * any screen started matching this empty container instead of the component
 * under test, and an assertion that "nothing is announced as an alert" became
 * impossible to write. A screen's own `role="alert"` must stay the only one.
 *
 * ★★★ It clears the bottom navigation.
 *
 * `app-shell.tsx` fixes a nav bar to the bottom edge below `lg`, so a toast at
 * `bottom-4` would sit on top of it. `--size-bottom-nav` clears the rows plus their
 * padding, and the safe-area inset keeps both above the iPhone home indicator.
 */
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const errors = toasts.filter((t) => t.tone === "error");
  const others = toasts.filter((t) => t.tone !== "error");

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4",
        "bottom-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom))] lg:bottom-4 lg:items-end lg:px-6",
      )}
    >
      {/* Assertive: a failure interrupts. */}
      <div
        aria-live="assertive"
        data-toast-region="error"
        className="flex w-full flex-col items-center gap-2 lg:items-end"
      >
        {errors.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>

      {/* Polite: a confirmation waits its turn. */}
      <div
        aria-live="polite"
        data-toast-region="status"
        className="flex w-full flex-col items-center gap-2 lg:items-end"
      >
        {others.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const Icon = TONE_ICON[toast.tone];

  return (
    <div
      /*
        `pointer-events-auto` on the card, `none` on the container — the strip
        spans the width of the screen, and without this it would swallow clicks
        on whatever sits underneath it. A toast never blocks the page.
      */
      className={cn(
        "pointer-events-auto flex w-full max-w-[420px] items-start gap-2.5 rounded-card border px-3.5 py-3 shadow-sm",
        TONE_STYLE[toast.tone],
      )}
    >
      <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1 text-body font-medium">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Хаах"
        /*
          Smaller than the 44px tap floor on purpose, and allowed to be: every
          toast dismisses itself, so this is a shortcut rather than the only way
          out. The floor exists for controls a task depends on.
        */
        className="-m-1 shrink-0 rounded-control p-1 opacity-70 transition-opacity hover:opacity-100"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
