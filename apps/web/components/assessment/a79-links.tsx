"use client";

import { useMemo, useState } from "react";
import { BookOpen, Lightbulb, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { SearchField } from "@/components/ui/search-field";
import type { A79Domain } from "@/lib/a79-assessment";
import {
  A79_LEVEL_KEYS,
  A79_STATUSES,
  A79_STATUS_HINT,
  A79_STATUS_LABEL,
  a79Code,
  a79CriterionText,
  a79Level,
  type A79LevelKey,
  type A79Link,
  type A79Status,
} from "@/lib/a79-progress";
import { suggestA79 } from "@/lib/a79-suggest";
import { cn } from "@/lib/utils";

const DOMAINS: A79Domain[] = ["Мэдлэг", "Чадвар", "Төлөвшил"];

const STATUS_LOOK: Record<A79Status, string> = {
  INDEPENDENT: "border-mint-ink/40 bg-mint",
  SUPPORTED: "border-sky-ink/40 bg-sky",
  DEVELOPING: "border-sun-ink/40 bg-sun",
  NOT_YET: "border-border bg-canvas",
};

/**
 * «А/79 шалгууртай холбох» on the observation form — 2026-10-08, the client's
 * design: a note links to one or more А/79 criteria, and each says how the
 * skill showed. Picking is a dialog (level, part, search, checkboxes); what
 * was picked is a card per criterion in the form itself, so the teacher sees
 * what they are saving.
 */
export function A79LinksField({
  links,
  onChange,
  defaultLevel,
  text = "",
  error,
}: {
  links: A79Link[];
  onChange: (next: A79Link[]) => void;
  /** The level the form's own «Түвшин» or the child's age suggests. */
  defaultLevel: A79LevelKey;
  /** The note as written — what the suggestions read. */
  text?: string;
  error?: string;
}) {
  const [picking, setPicking] = useState(false);
  const level = links[0]?.level ?? defaultLevel;
  const linkedKey = links
    .filter((l) => l.level === level)
    .map((l) => l.number)
    .join(",");
  const suggestions = useMemo(
    () =>
      suggestA79(text, level, {
        exclude: linkedKey ? linkedKey.split(",").map(Number) : [],
      }),
    [text, level, linkedKey],
  );

  const update = (index: number, patch: Partial<A79Link>) =>
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));

  return (
    <section aria-labelledby="a79-heading" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 rounded-row border border-border bg-surface px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen size={18} aria-hidden="true" className="shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 id="a79-heading" className="text-body font-semibold text-ink">
              А/79 шалгууртай холбох
            </h3>
            <p className="text-caption text-muted">
              Нэг ажиглалтыг хэд хэдэн шалгууртай холбож болно.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="А/79 шалгуур нэмэх"
          onClick={() => setPicking(true)}
        >
          <Plus size={18} aria-hidden="true" />
        </Button>
      </div>

      {/*
        ★ Suggested from the note's own words — 2026-10-08, the client chose
        word matching over AI. Never ticked for the teacher: a press adds one.
        `lib/a79-suggest.ts` says what it can and cannot find.
      */}
      {suggestions.length > 0 ? (
        <div
          role="group"
          aria-label="Тэмдэглэлд тохирох шалгуур"
          className="flex flex-col gap-1.5 rounded-row border border-dashed border-primary/40 bg-primary/5 p-2.5"
        >
          <p className="flex items-center gap-1.5 text-caption font-medium text-primary">
            <Lightbulb size={14} aria-hidden="true" />
            Тэмдэглэлд тохирох шалгуур · {level} түвшин
          </p>
          {suggestions.map((row) => (
            <button
              key={row.number}
              type="button"
              aria-label={`Ш${row.number} нэмэх: ${row.text}`}
              onClick={() =>
                onChange([...links, { level, number: row.number, status: "INDEPENDENT", note: "" }])
              }
              className="flex min-h-[44px] items-center gap-2 rounded-row bg-surface px-2.5 py-1.5 text-left hover:bg-canvas"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-pill border border-border text-caption font-semibold tabular-nums text-ink">
                {row.number}
              </span>
              <span className="min-w-0 flex-1 text-body text-ink">{row.text}</span>
              <Plus size={16} aria-hidden="true" className="shrink-0 text-primary" />
            </button>
          ))}
          <p className="text-caption text-muted">
            Үгийн давхцлаар санал болгож байна. Тохирохыг нь өөрөө сонгоно уу.
          </p>
        </div>
      ) : null}

      {links.map((link, index) => (
        <LinkCard
          key={`${link.level}-${link.number}`}
          link={link}
          onStatus={(status) => update(index, { status })}
          onNote={(note) => update(index, { note })}
          onRemove={() => onChange(links.filter((_, i) => i !== index))}
        />
      ))}

      {error ? (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : null}

      {picking ? (
        <A79PickerDialog
          defaultLevel={links[0]?.level ?? defaultLevel}
          already={links}
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            const known = new Set(links.map((l) => `${l.level}-${l.number}`));
            onChange([
              ...links,
              ...picked
                .filter((p) => !known.has(`${p.level}-${p.number}`))
                .map((p) => ({ ...p, status: "INDEPENDENT" as const, note: "" })),
            ]);
            setPicking(false);
          }}
        />
      ) : null}
    </section>
  );
}

function LinkCard({
  link,
  onStatus,
  onNote,
  onRemove,
}: {
  link: A79Link;
  onStatus: (status: A79Status) => void;
  onNote: (note: string) => void;
  onRemove: () => void;
}) {
  const code = a79Code(link);
  const note = link.note ?? "";
  return (
    <div
      role="group"
      aria-label={code}
      className="flex flex-col gap-2 rounded-row border border-border bg-surface p-3"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium text-primary">{code}</p>
          <p className="text-body font-medium text-ink">
            {a79CriterionText(link.level, link.number)}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`${code} хасах`}
          onClick={onRemove}
        >
          <Trash2 size={16} aria-hidden="true" className="text-danger" />
        </Button>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-caption font-semibold text-ink">
          Чадварын илрэлийн байдал <span className="text-danger">*</span>
        </legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {A79_STATUSES.map((status) => {
            const chosen = link.status === status;
            return (
              <label
                key={status}
                className={cn(
                  "flex min-h-[44px] cursor-pointer items-start gap-2 rounded-row border px-2.5 py-1.5",
                  chosen ? STATUS_LOOK[status] : "border-border-soft bg-surface",
                  chosen && "ring-2 ring-primary/30",
                )}
              >
                <input
                  type="radio"
                  name={`a79-status-${link.level}-${link.number}`}
                  className="mt-1"
                  checked={chosen}
                  onChange={() => onStatus(status)}
                />
                <span className="min-w-0">
                  <span className="block text-body font-medium text-ink">
                    {A79_STATUS_LABEL[status]}
                  </span>
                  <span className="block text-caption text-muted">{A79_STATUS_HINT[status]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <Field label="Тайлбар (заавал биш)" hint={`${note.length}/500`}>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            rows={1}
            maxLength={500}
            value={note}
            onChange={(e) => onNote(e.target.value)}
            className="min-h-[44px] py-2"
          />
        )}
      </Field>
    </div>
  );
}

/** Level, part and search, then a checkbox per criterion — the design's step 2. */
export function A79PickerDialog({
  defaultLevel,
  already,
  onClose,
  onPick,
}: {
  defaultLevel: A79LevelKey;
  already: Pick<A79Link, "level" | "number">[];
  onClose: () => void;
  onPick: (picked: { level: A79LevelKey; number: number }[]) => void;
}) {
  const [level, setLevel] = useState<A79LevelKey>(defaultLevel);
  const [domain, setDomain] = useState<A79Domain | "">("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const taken = new Set(already.map((l) => `${l.level}-${l.number}`));

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return a79Level(level)
      .criteria.map((criterion, index) => ({ ...criterion, number: index + 1 }))
      .filter((row) => !domain || row.domain === domain)
      .filter(
        (row) =>
          !needle || row.text.toLowerCase().includes(needle) || String(row.number) === needle,
      );
  }, [level, domain, query]);

  const toggle = (key: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="А/79 шалгуур сонгох"
      footer={
        <Button
          type="button"
          disabled={picked.size === 0}
          onClick={() =>
            onPick(
              [...picked].map((key) => {
                const [lvl, num] = key.split("-") as [A79LevelKey, string];
                return { level: lvl, number: Number(num) };
              }),
            )
          }
        >
          Сонгох ({picked.size})
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Түвшин">
            {({ id }) => (
              <Select
                id={id}
                value={level}
                onChange={(e) => setLevel(e.target.value as A79LevelKey)}
              >
                {A79_LEVEL_KEYS.map((key, i) => (
                  <option key={key} value={key}>
                    {`${key} түвшин (${i + 2} нас)`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Хэсэг">
            {({ id }) => (
              <Select
                id={id}
                value={domain}
                onChange={(e) => setDomain(e.target.value as A79Domain | "")}
              >
                <option value="">Бүгд</option>
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <SearchField
          label="Шалгуурын нэр, дугаараар хайх"
          value={query}
          onChange={setQuery}
          className="min-w-0"
        />

        {rows.length === 0 ? (
          <p className="py-6 text-center text-body text-muted">
            Тохирох шалгуур алга. Өөр үгээр хайгаад үзээрэй.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((row) => {
              const key = `${level}-${row.number}`;
              const done = taken.has(key);
              const on = picked.has(key);
              return (
                <li key={key}>
                  <label
                    className={cn(
                      "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-row border px-2.5 py-1.5",
                      on ? "border-primary bg-primary/5" : "border-transparent hover:bg-canvas",
                      done && "cursor-default opacity-60",
                    )}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-border text-caption font-semibold tabular-nums text-ink">
                      {row.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-body text-ink">{row.text}</span>
                      <span className="block text-caption text-muted">
                        {row.domain}
                        {done ? " · Холбогдсон" : ""}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      aria-label={`Ш${row.number}`}
                      className="size-5 shrink-0"
                      checked={on || done}
                      disabled={done}
                      onChange={() => toggle(key)}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FormDialog>
  );
}
