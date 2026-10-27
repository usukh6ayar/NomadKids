"use client";

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { childSummarySchema, paginated } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { fullName } from "@/lib/format";

const rosterSchema = paginated(childSummarySchema);
const graduationLetterSchema = z.object({ letter: z.string().nullable() });

/** The same key the portfolio page's own «Багшийн захиа» reads. */
const letterKey = (childId: string) => ["children", childId, "graduation-letter"] as const;

/** Parallel saves, a few at a time, so a group of thirty is not thirty at once. */
const CONCURRENCY = 4;

/**
 * One graduation letter, written once, for the whole group or for the children
 * picked by name — the user, 2026-10-17.
 *
 * ★ It is one copy per child, not a group letter. The API stores the letter on
 * each child (`PATCH /children/:id/graduation-letter`) and this sends that
 * request for every child chosen, so editing one child's letter afterwards on
 * their portfolio page leaves everyone else's alone.
 *
 * ★★ It asks before overwriting. A child who already has a letter — perhaps
 * one the teacher wrote for them alone — is marked «Захиатай» in the list, and
 * saving over any of them needs a second press.
 *
 * ★★★ A partial failure is named, not swallowed: the children whose save failed
 * are listed and «Дахин оролдох» resends to them only.
 *
 * The teacher's «Суралцагч» carries it beside «Бүлгээр урих» (the user,
 * 2026-10-17: "удирдлагад хэрэггүй багшид хэрэгтэй"); the roster is read when
 * the dialog opens, the same hundred-child page the group's own page reads.
 */
export function GroupGraduationLetter({
  groupId,
  label = "Захиа",
  className,
}: {
  groupId: string;
  label?: string;
  /** Extra classes for the trigger button. */
  className?: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [letter, setLetter] = useState("");
  const [scope, setScope] = useState<"all" | "pick">("all");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failedIds, setFailedIds] = useState<string[]>([]);

  const roster = useQuery({
    queryKey: qk.children({ groupId, page: 1, pageSize: 100 }),
    queryFn: () => get(`/children?groupId=${groupId}&page=1&pageSize=100`, rosterSchema),
    enabled: open,
  });
  const items = roster.data?.items ?? [];

  const existing = useQueries({
    queries: items.map((child) => ({
      queryKey: letterKey(child.id),
      queryFn: () => get(`/children/${child.id}/graduation-letter`, graduationLetterSchema),
      enabled: open,
    })),
  });
  const lettersLoading = open && existing.some((q) => q.isLoading);
  const hasLetter = new Set(
    items.filter((_, i) => existing[i]?.data?.letter).map((child) => child.id),
  );
  const unknown = new Set(items.filter((_, i) => existing[i]?.isError).map((child) => child.id));

  const targets =
    failedIds.length > 0
      ? items.filter((child) => failedIds.includes(child.id))
      : scope === "all"
        ? items
        : items.filter((child) => picked.has(child.id));
  const overwriting = targets.filter((child) => hasLetter.has(child.id) || unknown.has(child.id));

  const reset = () => {
    setLetter("");
    setScope("all");
    setPicked(new Set());
    setConfirming(false);
    setFailedIds([]);
  };

  const close = (next: boolean) => {
    if (next) return;
    setOpen(false);
    reset();
  };

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save() {
    setConfirming(false);
    setSaving(true);
    const body = { letter: letter.trim() };
    const failed: string[] = [];
    const queue = [...targets];

    const worker = async () => {
      for (let child = queue.shift(); child; child = queue.shift()) {
        try {
          const saved = await mutate(
            `/children/${child.id}/graduation-letter`,
            graduationLetterSchema,
            { method: "PATCH", body },
          );
          queryClient.setQueryData(letterKey(child.id), saved);
        } catch {
          failed.push(child.id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setSaving(false);

    const savedCount = targets.length - failed.length;
    if (failed.length === 0) {
      toast.success(`${savedCount} хүүхдэд захиа хадгалагдлаа.`);
      setOpen(false);
      reset();
    } else {
      setFailedIds(failed);
      if (savedCount > 0) toast.info(`${savedCount} хүүхдэд хадгалагдлаа.`);
    }
  }

  const onSave = () => {
    if (overwriting.length > 0 && !confirming) setConfirming(true);
    else void save();
  };

  const canSave =
    letter.trim().length > 0 &&
    targets.length > 0 &&
    !roster.isLoading &&
    !lettersLoading &&
    !saving;
  const failedNames = items.filter((child) => failedIds.includes(child.id)).map(fullName);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className={className}
        title="Төгсөлтийн захиа"
        onClick={() => setOpen(true)}
      >
        <Mail size={18} aria-hidden />
        {label}
      </Button>

      <FormDialog
        open={open}
        onOpenChange={close}
        title="Төгсөлтийн захиа"
        description="Цахим хувийн хавтасанд байршуулах багшийн захиа"
        busy={saving}
        footer={
          confirming ? (
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Буцах
              </Button>
              <Button onClick={() => void save()}>Солих</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => close(false)} disabled={saving}>
                Цуцлах
              </Button>
              <Button onClick={onSave} disabled={!canSave}>
                {saving
                  ? "Хадгалж байна…"
                  : failedIds.length > 0
                    ? "Дахин оролдох"
                    : `Хадгалах (${targets.length})`}
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <Textarea
              aria-label="Төгсөлтийн багшийн захиа"
              value={letter}
              maxLength={3500}
              rows={8}
              placeholder="Хайрт сурагчдаа…"
              onChange={(event) => setLetter(event.target.value)}
              disabled={saving}
            />
            <p className="mt-1 text-right text-caption text-faint">{letter.length}/3500</p>
          </div>

          {roster.isLoading ? <LoadingState rows={2} /> : null}
          {roster.isError ? <FormError message="Бүлгийн хүүхдийн жагсаалт уншигдсангүй." /> : null}
          {roster.data && items.length === 0 ? (
            <p className="text-body text-muted">Бүлэгт хүүхэд бүртгэгдээгүй байна.</p>
          ) : null}

          {items.length === 0 ? null : failedIds.length === 0 ? (
            <fieldset className="flex flex-col gap-1" disabled={saving}>
              <legend className="mb-1 text-body font-semibold text-ink">Хэнд хадгалах</legend>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="graduation-letter-scope"
                  checked={scope === "all"}
                  onChange={() => setScope("all")}
                />
                <span className="text-body text-ink">Бүх хүүхэд ({items.length})</span>
              </label>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="graduation-letter-scope"
                  checked={scope === "pick"}
                  onChange={() => setScope("pick")}
                />
                <span className="text-body text-ink">Хүүхэд сонгох</span>
              </label>

              {scope === "pick" ? (
                <ul className="max-h-64 overflow-y-auto rounded-row border border-border px-3">
                  {items.map((child) => (
                    <li key={child.id} className="flex items-center justify-between gap-2">
                      <Checkbox
                        label={fullName(child)}
                        checked={picked.has(child.id)}
                        onChange={() => toggle(child.id)}
                        className="flex-1"
                      />
                      {hasLetter.has(child.id) ? <Badge tone="sun">Захиатай</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </fieldset>
          ) : (
            <FormError
              message={`Дараах хүүхдүүдэд хадгалагдсангүй: ${failedNames.join(", ")}. «Дахин оролдох» дарна уу.`}
            />
          )}

          {lettersLoading ? (
            <p className="text-caption text-muted">Одоо байгаа захиаг шалгаж байна…</p>
          ) : null}

          {confirming ? (
            <p role="alert" className="rounded-row bg-sun px-3 py-2 text-body text-ink">
              {overwriting.length} хүүхдэд захиа аль хэдийн бичигдсэн байна:{" "}
              {overwriting.map(fullName).join(", ")}. Шинэ захиагаар солих уу?
            </p>
          ) : null}
        </div>
      </FormDialog>
    </>
  );
}
