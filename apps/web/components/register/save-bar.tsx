import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The unsaved-changes bar the group registers share.
 *
 * ★ One component because §6 says these are one pattern, and a pattern that
 * lives as copied markup is a pattern until the first person edits one copy.
 *
 * Ирц, Хоол ба цэс and Явцын үнэлгээ each had their own version of this bar.
 * They had already drifted — different padding, one with a `min-w-0` the other
 * lacked, one disabling "Болих" while saving and the other not — and the
 * 2026-09-03 redesign was about to make that three edits instead of one. The
 * only thing that legitimately differs between them is the sentence, so that
 * is the prop.
 *
 * ★★ It is `sticky`, not `fixed`, and the offset is `--size-bottom-nav`.
 *
 * A phone's roster is longer than the viewport, so a save button at the foot of
 * the page is a scroll away from wherever the teacher just tapped. Sticky keeps
 * it in the flow — it cannot overlap the content the way a fixed bar does — and
 * the bottom offset clears the fixed tab bar, which is the literal every one of
 * these had hard-coded before `globals.css` gave it a name.
 *
 * ★★★ "Хадгалах" is first and "Болих" second, deliberately.
 *
 * `Болих` discards the work the bar exists to protect. Constraint 14 asks a
 * register to offer a one-press way out, not to put it under the thumb that is
 * reaching for save.
 */
export function RegisterSaveBar({
  message,
  saving,
  onSave,
  onCancel,
  saveLabel = "Хадгалах",
  savingLabel = "Хадгалж байна…",
  cancelLabel = "Болих",
}: {
  /** What is outstanding, in words — "5 хүүхдийн үнэлгээ хадгалагдаагүй байна". */
  message: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
  savingLabel?: string;
  cancelLabel?: string;
}) {
  return (
    <div className="sticky bottom-[var(--size-bottom-nav)] z-10 lg:bottom-4">
      {/*
        ★ Tinted and elevated, because it has to be findable.

        This was a plain white card with a grey sentence, sitting at the foot of
        a white roster of white rows — the one control standing between a
        teacher and lost work, styled like another row. The brand border and
        tint say "this appeared", the modal shadow lifts it off the list, and
        the filled dot marks the unsaved state without relying on the sentence
        being read.
      */}
      <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/25 bg-primary-soft px-4 py-3.5 shadow-lg">
        <p
          className="flex min-w-0 items-center gap-2.5 text-body font-medium text-ink"
          aria-live="polite"
        >
          <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-primary" />
          {message}
        </p>
        <div className="flex gap-2">
          <Button size="sm" disabled={saving} onClick={onSave}>
            {saving ? savingLabel : saveLabel}
          </Button>
          <Button variant="secondary" size="sm" disabled={saving} onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
