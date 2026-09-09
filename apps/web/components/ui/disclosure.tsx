import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * A section that opens on demand.
 *
 * ★ A native `<details>`, not a scripted accordion. It opens with no
 * JavaScript, the browser gives it the right ARIA for free, and — the reason
 * that matters here — the browser's own "find in page" expands it to reveal a
 * match inside. An accountant searching a hundred-row register for one child's
 * name is a real thing to do, and a `useState` accordion silently fails it.
 *
 * ★★ `disabled` renders the row without a toggle rather than as a `<details>`
 * that opens onto nothing. The hint beside it says why, which is the same
 * information the empty panel would have carried and one press cheaper —
 * CLAUDE.md §5, an empty state says what to do next.
 *
 * ★★★ Lifted out of `app/(app)/finance/page.tsx` on 2026-09-09, when the
 * accountant's board wanted the same shape. It was a private component there,
 * which is fine until a second screen needs it — at which point the choice is
 * lifting it or copying it, and a copy is where one of the two stops getting
 * the fix. Same reasoning `navEntry` records in the app layout.
 */
export function Disclosure({
  title,
  hint,
  disabled = false,
  children,
}: {
  title: string;
  hint?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <Card pad="roomy" className="flex items-center justify-between gap-3">
        <span className="text-lead font-semibold text-faint">{title}</span>
        {hint ? <span className="text-caption text-muted">{hint}</span> : null}
      </Card>
    );
  }

  return (
    <details className="group rounded-card border border-border bg-surface">
      <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={18}
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform group-open:rotate-90"
        />
        <span className="flex-1 text-lead font-semibold text-ink">{title}</span>
        {hint ? <span className="shrink-0 text-caption text-muted">{hint}</span> : null}
      </summary>
      <div className="border-t border-border-soft px-4 py-4">{children}</div>
    </details>
  );
}
