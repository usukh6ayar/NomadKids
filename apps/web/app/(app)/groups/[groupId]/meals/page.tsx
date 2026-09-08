"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { NotebookPen } from "lucide-react";
import { z } from "zod";
import {
  groupMealRowSchema,
  mealRecordSchema,
  type MealKind,
  type MealStatus,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { fullName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/app-shell";
import { GroupSwitcher, useSwitchableGroups } from "@/components/shell/group-switcher";
import { RequireRole } from "@/components/shell/require-role";
import { ChildAvatar } from "@/components/media/media-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { RegisterProgress } from "@/components/register/register-progress";
import { RegisterSaveBar } from "@/components/register/save-bar";
import type { Tone } from "@/components/ui/tone";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/auth/session";

const sheetSchema = z.array(groupMealRowSchema);
const savedSchema = z.array(mealRecordSchema);

/** The four sittings `MealKind` defines — `нэмэлт.md` §2, in serving order. */
const SITTINGS: { value: MealKind; label: string; short: string }[] = [
  { value: "BREAKFAST", label: "Өглөөний цай", short: "Өглөө" },
  { value: "LUNCH", label: "Өдрийн хоол", short: "Өдөр" },
  { value: "AFTERNOON_SNACK", label: "Их үдийн цай", short: "Их үд" },
  { value: "EXTRA", label: "Оройн хоол", short: "Орой" },
];

/**
 * The four statuses, with the tone each is scanned by.
 *
 * ★ Colour carries meaning here and is never the only carrier: the label is
 * always rendered, and the selected control is the one with `aria-checked`.
 * A teacher scanning twenty rows for who has not eaten reads the colour; a
 * screen reader reads the label and the state.
 */
const STATUSES: { value: MealStatus; label: string; selected: string; tone: Tone }[] = [
  {
    value: "TAKEN",
    label: "Авсан",
    selected: "border-mint-ink/30 bg-mint text-mint-ink",
    tone: "mint",
  },
  {
    value: "NOT_TAKEN",
    label: "Аваагүй",
    selected: "border-danger/30 bg-danger-soft text-danger",
    /*
      ★ `peach`, where the button beside it is `danger`.

      The chart palette (`ui/tone.ts`) has six accent washes and
      `--color-danger` is deliberately not one of them. `peach` is its
      attention tone and the nearest thing — the same substitution
      `ATTENDANCE_STATUS_CHART_TONE` makes for ABSENT, for the same reason.
    */
    tone: "peach",
  },
  {
    value: "PARTIAL",
    label: "Хэсэгчлэн",
    selected: "border-sun-ink/30 bg-sun text-sun-ink",
    tone: "sun",
  },
  {
    value: "SPECIAL",
    label: "Тусгай хоол",
    selected: "border-sky-ink/30 bg-sky text-sky-ink",
    tone: "sky",
  },
];

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<
  MealStatus,
  string
>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** What a row is carrying, once the teacher has touched it. */
interface Draft {
  status: MealStatus;
  /** Seeded from the saved record, so changing a status never wipes its note. */
  note: string;
}

/**
 * The group's meal register — `нэмэлт.md` §2.
 *
 * ★ It is not the menu, and the two must not be confused.
 *
 * `MenuDay` is what the kitchen planned to cook, one row per kindergarten per
 * day, and a parent reads it. This is what each child actually ate at one
 * sitting. They share the `MealKind` vocabulary and nothing else — §3 computes
 * the food cost from **хооллосон өдөр**, days eaten, so nothing here may be
 * inferred from the menu or from `Attendance`. A child collected before lunch
 * attended and did not eat.
 *
 * ★★ Batch save, unlike the attendance day sheet beside it.
 *
 * Attendance writes per tap because it is a fact about right now, usually
 * corrected in the moment. The meal API takes a whole sitting in one request
 * for the opposite reason, written into its own DTO: a teacher marks twenty
 * children at a serving hatch with the queue waiting, and twenty round trips
 * over a kindergarten's connection is the difference between a usable screen
 * and a form nobody fills in. So this screen holds a draft and saves once.
 */
export default function GroupMealsPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <GroupMeals />
    </RequireRole>
  );
}

function GroupMeals() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const queryClient = useQueryClient();
  const toast = useToast();

  /*
   * ★ A director reads the meal register; they do not mark it — 2026-09-06.
   *
   * The client's words: "хоолны хэсэгт авсан аваагүй гэхгүй, багшаас ирсэн
   * дата л харагдна, ерөөсөө захирал гараар өөрөө оруулахгүй". Same reasoning
   * as the attendance day sheet beside it, and it matters more here: a meal
   * record is what the kitchen's portion count and the food-cost split are
   * built from, and two people marking the same sitting from two screens is
   * how a day ends up counted twice.
   *
   * Held against ADMIN-without-TEACHER for the reason that page records: a
   * director who also teaches has a group whose register somebody has to
   * write, and their `Membership` is what says which they are.
   */
  const { hasRole } = useSession();
  const readOnly = hasRole("ADMIN") && !hasRole("TEACHER");

  const [date, setDate] = useState(today());
  const [kind, setKind] = useState<MealKind>("BREAKFAST");
  /** Unsaved marks, keyed by child id — never by row index, which reorders. */
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [noting, setNoting] = useState<string | null>(null);

  /*
   * ★ The same key the other two registers use, so switching from Ирц to
   * Үнэлгээ for the same group does not refetch the list of groups.
   */
  const switchable = useSwitchableGroups();

  /*
    ★ One sitting, not four.

    The API answers per `kind` and requires it, so the first paint costs one
    request rather than four — and `enabled` covers the empty date a cleared
    `<input type="date">` produces, which would otherwise fire `?date=` and
    come back 400 against the format regex.
  */
  const sheet = useQuery({
    queryKey: qk.groupMeals(groupId, date, kind),
    queryFn: () => get(`/groups/${groupId}/meals?date=${date}&kind=${kind}`, sheetSchema),
    enabled: Boolean(groupId && date),
  });

  /*
    The invariant: a draft belongs to exactly one (date, sitting).

    Carrying breakfast's marks into lunch would save them under the wrong
    `kind` — the register's version of the assessment column's wrong-domain
    save, and the same guard. The controls are disabled while anything is
    unsaved (see `SittingPicker`), so in practice this never has work to do;
    it stays because "in practice" is not an invariant.
  */
  useEffect(() => {
    setDraft({});
  }, [groupId, date, kind]);

  const save = useMutation({
    mutationFn: () => {
      /*
        ★ Only the rows the teacher marked.

        `MealStatus` has no "not recorded" member, so an unmarked child has no
        status to send — and the DTO requires one per entry. Sending the whole
        roster would mean inventing a status for children nobody marked.
      */
      const entries = Object.entries(draft).map(([childId, value]) => ({
        childId,
        status: value.status,
        note: value.note.trim() ? value.note.trim() : null,
      }));

      return mutate(`/groups/${groupId}/meals`, savedSchema, {
        method: "PUT",
        body: { date, kind, entries },
      });
    },
    onSuccess: (saved) => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: qk.groupMeals(groupId, date, kind) });
      toast.success(`${saved.length} хүүхдийн хоол бүртгэгдлээ.`);
    },
  });

  const rows = sheet.data ?? [];
  const pendingCount = Object.keys(draft).length;
  const isDirty = pendingCount > 0;
  const sitting = SITTINGS.find((s) => s.value === kind)!;

  /** The saved status, unless the teacher has changed it in this session. */
  const statusFor = (row: z.infer<typeof groupMealRowSchema>): MealStatus | null =>
    draft[row.child.id]?.status ?? row.record?.status ?? null;

  const setStatus = (row: z.infer<typeof groupMealRowSchema>, status: MealStatus) => {
    setDraft((current) => ({
      ...current,
      [row.child.id]: {
        status,
        // Preserved: marking a child PARTIAL must not silently clear the note
        // that says why they only ate half.
        note: current[row.child.id]?.note ?? row.record?.note ?? "",
      },
    }));
  };

  const notingRow = rows.find((r) => r.child.id === noting) ?? null;
  const recorded = rows.filter((row) => statusFor(row) !== null).length;

  /*
   * ★ Counted through `statusFor`, so an unsaved draft counts.
   *
   * This screen batches its writes behind a save bar, unlike the attendance
   * sheet. A summary that read only `row.record` would sit still while a
   * teacher taps their way down the list and jump when they save — the one
   * moment the number tells them nothing they did not just do.
   */
  const breakdown = STATUSES.map((status) => ({
    key: status.value,
    label: status.label,
    count: rows.filter((row) => statusFor(row) === status.value).length,
    tone: status.tone,
  }));

  return (
    <div className="flex flex-col gap-5 py-2">
      <PageHeader title="Хоолны бүртгэл" />

      <GroupSwitcher
        groups={switchable.data?.items ?? []}
        activeGroupId={groupId}
        href={(id) => `/groups/${id}/meals`}
      />

      <Card className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <SittingPicker value={kind} onChange={setKind} locked={isDirty} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Огноо" hint={isDirty ? "Эхлээд хадгална уу." : undefined}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="date"
                // The API refuses a future sitting; the picker says so first.
                max={today()}
                value={date}
                disabled={isDirty}
                onChange={(e) => setDate(e.target.value)}
              />
            )}
          </Field>
        </div>

        {sheet.data && rows.length > 0 ? (
          <RegisterProgress inset recorded={recorded} total={rows.length} breakdown={breakdown} />
        ) : null}
      </Card>

      {sheet.isLoading ? <LoadingState rows={6} shape="register" /> : null}

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
          {/*
            ★ The count left the section header when `RegisterProgress` arrived.

            "14/18 бүртгэсэн" is now the strip's second line, and keeping it
            here as well would put the same figure twice on one screen — the
            failure `ROUTE_ICON` guards against, one component down.
          */}
          <SectionHeader title={sitting.label} />

          {rows.length === 0 ? (
            <EmptyState
              title="Бүлэгт хүүхэд алга"
              description="Энэ хичээлийн жилд идэвхтэй бүртгэлтэй хүүхэд байхгүй байна."
            />
          ) : (
            <Card className="divide-y divide-border">
              {rows.map((row) => (
                <ChildRow
                  key={row.enrollmentId}
                  child={row.child}
                  status={statusFor(row)}
                  readOnly={readOnly}
                  note={draft[row.child.id]?.note ?? row.record?.note ?? ""}
                  isDirty={Boolean(draft[row.child.id])}
                  onSelect={(status) => setStatus(row, status)}
                  onOpenNote={() => setNoting(row.child.id)}
                />
              ))}
            </Card>
          )}

          <FormError message={save.isError ? errorMessage(save.error) : null} />

          {/*
            A sticky save bar, the same place the assessment column puts one:
            on a phone the roster is longer than the viewport, so a button at
            the foot of the page is a scroll away from the row just tapped.
            `--size-bottom-nav` clears the mobile navigation — see `globals.css`,
            which records what it is measured from and why a literal went stale.
          */}
          {isDirty ? (
            <RegisterSaveBar
              message={`${pendingCount} хүүхдийн бүртгэл хадгалагдаагүй байна`}
              saving={save.isPending}
              onSave={() => save.mutate()}
              onCancel={() => setDraft({})}
            />
          ) : null}
        </>
      ) : null}

      {notingRow ? (
        <NoteDialog
          childName={fullName(notingRow.child)}
          status={statusFor(notingRow)}
          value={draft[notingRow.child.id]?.note ?? notingRow.record?.note ?? ""}
          onClose={() => setNoting(null)}
          onSave={(note) => {
            const status = statusFor(notingRow);
            // Guarded by the trigger being disabled without a status — the DTO
            // has no note-only entry, so there is nothing to attach one to.
            if (!status) return;
            setDraft((current) => ({
              ...current,
              [notingRow.child.id]: { status, note },
            }));
            setNoting(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Which sitting is being recorded.
 *
 * ★ `role="group"` with `aria-pressed`, not a tablist.
 *
 * `home/page.tsx` documents why the product stopped claiming `role="tab"`: a
 * tablist promises a `tabpanel`, `aria-controls`, a roving tabindex and arrow
 * keys, and announcing "tab, 1 of 4" while none of that works is worse than
 * not claiming the pattern. These are buttons that stay in.
 *
 * ★★ Locked while there are unsaved marks.
 *
 * The draft belongs to one sitting; switching would discard it. The assessment
 * column clears its draft silently in the same situation, and that is the one
 * thing this screen does differently — twenty marks made at a serving hatch is
 * too much work to lose to a mistaken tap. "Болих" in the save bar is one press
 * away, so the way out is always available and always deliberate.
 */
function SittingPicker({
  value,
  onChange,
  locked,
}: {
  value: MealKind;
  onChange: (kind: MealKind) => void;
  locked: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-compact font-medium text-muted" id="sitting-label">
        Хоолны цаг
      </span>
      <div
        role="group"
        aria-labelledby="sitting-label"
        /*
          Scrolls inside itself rather than widening the page — four Mongolian
          sitting names do not fit across 390px, and a row that cannot give
          takes the whole layout sideways.
        */
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {SITTINGS.map((s) => {
          const active = s.value === value;
          return (
            <button
              key={s.value}
              type="button"
              aria-pressed={active}
              disabled={locked && !active}
              title={locked && !active ? "Эхлээд хадгална уу эсвэл болино уу." : undefined}
              onClick={() => onChange(s.value)}
              className={cn(
                "min-h-[44px] shrink-0 rounded-pill border px-4 text-body font-medium transition-all duration-150 active:translate-y-[1px]",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border bg-surface text-muted hover:border-faint hover:bg-canvas hover:text-ink",
              )}
            >
              {/* The full name where it fits, an abbreviation on a phone. */}
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.short}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One child's row.
 *
 * ★ Compact, and a list rather than a card per child.
 *
 * This is repeated daily entry over a whole group: a card each would put four
 * children on a phone screen and turn a two-minute job into scrolling. The
 * statuses are buttons rather than a select for the same reason the assessment
 * levels are — choosing is the entire task, and a dropdown costs two taps and
 * hides the options.
 */
function ChildRow({
  child,
  status,
  readOnly,
  note,
  isDirty,
  onSelect,
  onOpenNote,
}: {
  child: { id: string; lastName: string; firstName: string };
  status: MealStatus | null;
  /** A director's view — see the note in `GroupMeals`. */
  readOnly: boolean;
  note: string;
  isDirty: boolean;
  onSelect: (status: MealStatus) => void;
  onOpenNote: () => void;
}) {
  const name = fullName(child);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ChildAvatar child={child} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{name}</span>
          {/*
            ★ "Not yet recorded" is a state the register has to show. A child
            nobody has marked comes back with `record: null` on purpose, and a
            row that looked identical to a marked one would defeat the point.
          */}
          {status === null ? (
            <span className="text-caption text-muted">Бүртгээгүй</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-caption text-muted">{STATUS_LABEL[status]}</span>
              {isDirty ? <Badge tone="sun">Хадгалаагүй</Badge> : null}
            </span>
          )}
        </span>

        {/*
          Read-only keeps the note *visible* and drops the editor: the teacher's
          "Гэрээсээ хоолтой ирсэн" is exactly the kind of thing a director opens
          this screen for, and hiding it with the control that writes it would
          remove the explanation along with the ability to change it.
        */}
        {readOnly ? (
          note ? (
            <span
              title={note}
              className="inline-flex shrink-0 items-center gap-1.5 text-caption text-muted"
            >
              <NotebookPen size={16} aria-hidden="true" />
              <span className="max-w-[180px] truncate">{note}</span>
            </span>
          ) : null
        ) : (
          <Button
            variant="ghost"
            size="icon"
            disabled={status === null}
            aria-label={`${name} — тэмдэглэл`}
            title={
              status === null
                ? "Эхлээд хоолны төлөвийг сонгоно уу."
                : note
                  ? note
                  : "Тэмдэглэл нэмэх"
            }
            onClick={onOpenNote}
            className={cn("shrink-0", note ? "text-primary" : "text-muted")}
          >
            <NotebookPen size={18} aria-hidden="true" />
          </Button>
        )}
      </div>

      {/*
        `basis-full` below `sm`: four 44px controls plus a name do not fit one
        390px line, so the statuses take their own row under the child rather
        than squeezing the name to three characters.
      */}
      {/*
        ★ One tinted chip instead of four buttons when this is being read — the
        same substitution the attendance day sheet makes, and for the same
        reason: four disabled controls still say "press these later", and there
        is no later for a director here.
      */}
      {readOnly ? (
        <div className="flex basis-full flex-wrap gap-2 sm:basis-auto sm:justify-end">
          {status ? (
            <span
              className={cn(
                "inline-flex min-h-9 items-center rounded-control px-3 text-body font-semibold",
                STATUSES.find((s) => s.value === status)?.selected,
              )}
            >
              {STATUS_LABEL[status]}
            </span>
          ) : (
            <span className="inline-flex min-h-9 items-center rounded-control border border-dashed border-border px-3 text-body text-faint">
              Бүртгээгүй
            </span>
          )}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={`${name} — хоол`}
          className="flex basis-full flex-wrap gap-2 sm:basis-auto"
        >
          {STATUSES.map((s) => {
            const selected = s.value === status;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect(s.value)}
                className={cn(
                  "min-h-[44px] flex-1 rounded-control border px-3 text-body font-medium transition-all duration-150 active:translate-y-[1px] sm:flex-none",
                  selected
                    ? cn(s.selected, "font-semibold shadow-sm")
                    : "border-border bg-surface text-muted hover:border-faint hover:bg-canvas hover:text-ink",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A note on one child's record — `MealRecord.note`.
 *
 * ★ Behind a control rather than in the row, and that is the whole design.
 *
 * §2's register is twenty children marked quickly; a textarea on every row
 * would be four screens of scrolling for a field most rows never use. It earns
 * its place on the two statuses that beg the question — "Гэрээсээ хоолтой
 * ирсэн" for `NOT_TAKEN`, "Харшлын улмаас тусгай хоол" for `SPECIAL` — so the
 * dialog says so, and nothing requires it.
 *
 * ★★ It edits the draft, not the server.
 *
 * There is no note-only endpoint: `entries[]` requires a status per row, so a
 * note travels with the sitting's batch save like everything else. Closing this
 * dialog stages the change; the save bar commits it.
 */
function NoteDialog({
  childName,
  status,
  value,
  onClose,
  onSave,
}: {
  childName: string;
  status: MealStatus | null;
  value: string;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [text, setText] = useState(value);
  const tooLong = text.length > 500;

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Тэмдэглэл"
      description={status ? `${childName} — ${STATUS_LABEL[status]}` : childName}
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Болих
          </Button>
          <Button type="submit" form="meal-note-form" size="sm" disabled={tooLong}>
            Нэмэх
          </Button>
        </>
      }
    >
      <form
        id="meal-note-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!tooLong) onSave(text);
        }}
      >
        <Field
          label="Тэмдэглэл"
          hint="Жишээ: гэрээсээ хоолтой ирсэн, харшлын улмаас тусгай хоол."
          // The DTO's own limit. Enforced here because zod's overflow message
          // arrives in English, which no screen in this product shows.
          error={tooLong ? "Тэмдэглэл 500 тэмдэгтээс хэтрэхгүй." : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              rows={3}
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}
