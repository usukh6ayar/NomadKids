"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { z } from "zod";
import {
  groupMealSheetEntrySchema,
  groupSchema,
  MEAL_KIND_LABEL,
  MEAL_STATUS_LABEL,
  mealKindSchema,
  mealRecordSchema,
  mealStatusSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const sheetSchema = z.array(groupMealSheetEntrySchema);
const savedSchema = z.array(mealRecordSchema);
const MEAL_KINDS = mealKindSchema.options;
const MEAL_STATUSES = mealStatusSchema.options;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The meal register — `нэмэлт.md` §2.
 *
 * ★ One sitting at a time, the same "one column, not a matrix" call
 * `GroupAssessmentPage` already made for the same reason: a teacher marking
 * twenty children at a serving hatch needs one clear task — this date, this
 * sitting — not four sittings' worth of choices open at once.
 *
 * The whole sitting saves in one request, same as the assessment column: a
 * teacher taps through the roster and saves once.
 */
export default function GroupMealsPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <Suspense fallback={<LoadingState rows={4} />}>
        <GroupMeals />
      </Suspense>
    </RequireRole>
  );
}

function GroupMeals() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  // The selection lives in the URL, same reasoning as the assessment
  // screen's term/domain: a teacher can bookmark or share "this date, this
  // sitting", and a reload does not throw them back to today's breakfast.
  const date = searchParams.get("date") || todayIso();
  const kind = searchParams.get("kind") || MEAL_KINDS[0]!;

  function setSelection(next: { date?: string; kind?: string }) {
    const updated = new URLSearchParams(searchParams.toString());
    if (next.date !== undefined) updated.set("date", next.date);
    if (next.kind !== undefined) updated.set("kind", next.kind);
    router.replace(`?${updated.toString()}`, { scroll: false });
  }

  const group = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupSchema),
  });

  const sheet = useQuery({
    queryKey: qk.groupMealSheet(groupId, date, kind),
    queryFn: () => get(`/groups/${groupId}/meals?date=${date}&kind=${kind}`, sheetSchema),
  });

  /** Pending status choices, keyed by child. Empty until something is tapped. */
  const [draft, setDraft] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      const entries = Object.entries(draft).map(([childId, status]) => ({ childId, status }));
      return mutate(`/groups/${groupId}/meals`, savedSchema, {
        method: "PUT",
        body: { date, kind, entries },
      });
    },
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: qk.groupMealSheet(groupId, date, kind) });
    },
  });

  if (group.isLoading) return <LoadingState rows={4} />;

  if (group.isError) {
    return (
      <div className="py-6">
        <ErrorState description={errorMessage(group.error)} />
      </div>
    );
  }

  const pendingCount = Object.keys(draft).length;

  return (
    <div className="flex flex-col gap-5 py-2">
      <header>
        <h1 className="text-heading font-semibold text-ink">Хоолны бүртгэл</h1>
        <p className="mt-0.5 text-body text-muted">{group.data?.name}</p>
      </header>

      <Card className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
        <Field label="Огноо">
          {({ id }) => (
            <input
              id={id}
              type="date"
              value={date}
              max={todayIso()}
              onChange={(e) => {
                setDraft({});
                setSelection({ date: e.target.value || todayIso() });
              }}
              className="flex h-[48px] w-full items-center rounded-control border border-border bg-surface px-3.5 text-body text-ink outline-none focus-visible:border-primary"
            />
          )}
        </Field>

        <Field label="Хоолны цаг">
          {({ id }) => (
            <Select
              id={id}
              value={kind}
              onChange={(e) => {
                setDraft({});
                setSelection({ kind: e.target.value });
              }}
            >
              {MEAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {MEAL_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Card>

      {sheet.isLoading ? <LoadingState rows={5} /> : null}

      {sheet.isError ? (
        <ErrorState
          description={errorMessage(sheet.error)}
          action={
            <Button variant="secondary" onClick={() => void sheet.refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {sheet.data ? (
        <>
          <SectionHeader
            title={MEAL_KIND_LABEL[kind] ?? kind}
            action={<span className="text-body text-muted">{sheet.data.length} хүүхэд</span>}
          />

          {sheet.data.length === 0 ? (
            <EmptyState
              title="Бүлэгт хүүхэд алга"
              description="Энэ хичээлийн жилд идэвхтэй бүртгэлтэй хүүхэд байхгүй байна."
            />
          ) : (
            <Card className="divide-y divide-border">
              {sheet.data.map((entry) => (
                <ChildRow
                  key={entry.enrollmentId}
                  child={entry.child}
                  selectedStatus={draft[entry.child.id] ?? entry.record?.status ?? null}
                  isDirty={Boolean(draft[entry.child.id])}
                  onSelect={(status) =>
                    setDraft((current) => ({ ...current, [entry.child.id]: status }))
                  }
                />
              ))}
            </Card>
          )}

          <FormError message={save.isError ? errorMessage(save.error) : null} />

          {pendingCount > 0 ? (
            <div className="sticky bottom-[76px] z-10 lg:bottom-4">
              <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-lg">
                <p className="text-body text-ink" aria-live="polite">
                  {pendingCount} хүүхдийн хоол хадгалагдаагүй байна
                </p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
                    {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setDraft({})}>
                    Болих
                  </Button>
                </div>
              </Card>
            </div>
          ) : null}

          {save.isSuccess && pendingCount === 0 ? (
            <p role="status" className="rounded-control bg-mint px-4 py-3 text-body text-mint-ink">
              Хоолны бүртгэл хадгалагдлаа.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * One child's row — four status buttons, same "buttons, not a dropdown"
 * reasoning as the assessment screen's level choice: marking is the whole
 * task, and four options fit a phone row at 44px each.
 */
function ChildRow({
  child,
  selectedStatus,
  isDirty,
  onSelect,
}: {
  child: { id: string; lastName: string; firstName: string };
  selectedStatus: string | null;
  isDirty: boolean;
  onSelect: (status: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ChildAvatar child={child} size={40} />
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">{fullName(child)}</span>
          {isDirty ? <span className="text-caption text-primary">Хадгалаагүй</span> : null}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label={`${fullName(child)} — хоолны байдал`}
        className="flex flex-wrap gap-2"
      >
        {MEAL_STATUSES.map((status) => {
          const selected = status === selectedStatus;
          return (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(status)}
              className={cn(
                "min-h-[44px] rounded-control border px-3 text-body font-medium transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-ink"
                  : "border-border bg-surface text-muted hover:bg-canvas hover:text-ink",
              )}
            >
              {MEAL_STATUS_LABEL[status]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
