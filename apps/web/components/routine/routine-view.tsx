"use client";

import Image from "next/image";
import { useState, type ComponentType } from "react";
import {
  Activity,
  BookOpen,
  ChevronDown,
  CircleDot,
  Coffee,
  Download,
  HeartHandshake,
  Leaf,
  MessagesSquare,
  Moon,
  MoreVertical,
  Music,
  Palette,
  Pencil,
  Plus,
  Puzzle,
  Shapes,
  Sigma,
  Sun,
  ToyBrick,
  Trash2,
  TreePine,
  Upload,
  UserRound,
  Users,
  Utensils,
  type LucideProps,
} from "lucide-react";
import { DemoBanner } from "@/components/feedback/feedback-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { TableShell, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  AREA_IMAGE,
  CLUB_REQUEST_LABEL,
  LEARNING_AREAS,
  PLAN_TEMPLATE,
  ROUTINE_TEMPLATE,
  WEEKDAYS,
  parseRoutineTable,
  routineToCsv,
  sortRoutine,
  type AreaPlan,
  type Club,
  type ClubInput,
  type Routine,
  type RoutineItem,
} from "@/lib/routine";
import { cn } from "@/lib/utils";

export type RoutineMode = "teacher" | "admin" | "parent";

/**
 * What the screen can do; each returns once the change is kept (or throws,
 * and the caller has already said why). Absent for a mode that cannot do it.
 */
export interface RoutineActions {
  saveItems?: (items: RoutineItem[]) => Promise<void>;
  savePlan?: (plan: AreaPlan[]) => Promise<void>;
  saveClub?: (input: ClubInput, id?: string) => Promise<void>;
  deleteClub?: (id: string) => Promise<void>;
  decide?: (requestId: string, approve: boolean) => Promise<void>;
  requestClub?: (clubId: string) => Promise<void>;
}

type Tab = "daily" | "plan" | "clubs";
const TABS: { key: Tab; label: string }[] = [
  { key: "daily", label: "Өдрийн дэглэм" },
  { key: "plan", label: "Судлагдахуун" },
  { key: "clubs", label: "Дугуйлан" },
];

/**
 * Өдрийн дэглэм · Судлагдахуун · Дугуйлан — the client's prototype as the
 * product's screen, 2026-10-09. One component for the three readers: the
 * teacher edits, the director reads what the teacher keeps, a family reads
 * and asks to join a club. Contract and template: `lib/routine.ts`.
 */
export function RoutineView({
  routine,
  mode,
  demo,
  actions,
}: {
  routine: Routine;
  mode: RoutineMode;
  /** Sample data while the endpoint is missing — said once, above the tabs. */
  demo: boolean;
  actions: RoutineActions;
}) {
  const [tab, setTab] = useState<Tab>("daily");
  return (
    <div className="flex flex-col gap-4">
      {demo ? (
        <DemoBanner>
          {mode === "teacher"
            ? "Жишээ загвар харагдаж байна. Сервер холбогдох хүртэл засвар хадгалагдахгүй."
            : "Жишээ загвар харагдаж байна. Багш дэглэмээ оруулсны дараа энд гарна."}
        </DemoBanner>
      ) : null}

      <div
        role="tablist"
        aria-label="Өдрийн дэглэмийн хэсэг"
        className="grid grid-cols-3 gap-1 rounded-control bg-canvas p-1"
      >
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            onClick={() => setTab(entry.key)}
            className={cn(
              "min-h-[40px] rounded-control px-1 text-caption font-semibold transition-colors sm:text-body",
              tab === entry.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find((entry) => entry.key === tab)!.label}>
        {tab === "daily" ? <DailyTab routine={routine} mode={mode} actions={actions} /> : null}
        {tab === "plan" ? <PlanTab routine={routine} mode={mode} actions={actions} /> : null}
        {tab === "clubs" ? <ClubsTab routine={routine} mode={mode} actions={actions} /> : null}
      </div>
    </div>
  );
}

// ─── Өдрийн дэглэм ───────────────────────────────────────────────────────────

function AreaChips({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {areas.map((area) => (
        <span key={area} className="rounded-pill bg-canvas px-2 py-0.5 text-compact text-muted">
          {area}
        </span>
      ))}
    </span>
  );
}

type Icon = ComponentType<LucideProps>;

/**
 * A small coloured line icon before each activity — 2026-10-09, the client:
 * "өнгө өнгийн зураасан минимал айкон". Matched on the activity's own name,
 * the curriculum's fourteen first; anything else gets a quiet dot.
 */
const ACTIVITY_ICONS: [RegExp, Icon, string][] = [
  [/хүлээн авалт|хүлээн авах/i, Sun, "text-sun-ink"],
  [/дасгал/i, Activity, "text-mint-ink"],
  [/тойргийн/i, MessagesSquare, "text-sky-ink"],
  [/цай/i, Coffee, "text-peach-ink"],
  [/хоол/i, Utensils, "text-peach-ink"],
  [/чиглүүлэгтэй/i, Puzzle, "text-primary"],
  [/төвийн/i, Shapes, "text-cornflower-ink"],
  [/зугаалга|гадаа/i, TreePine, "text-mint-ink"],
  [/унт|амралт/i, Moon, "text-cornflower-ink"],
  [/ном|үлгэр/i, BookOpen, "text-sky-ink"],
  [/хөгжөөн|хөгжим|дуу/i, Music, "text-pink-ink"],
  [/ганцаарчилсан/i, UserRound, "text-primary"],
  [/өөртөө үйлчлэх/i, HeartHandshake, "text-mint-ink"],
  [/чөлөөт|тоглоом/i, ToyBrick, "text-sun-ink"],
];

function ActivityIcon({ name }: { name: string }) {
  const [, Glyph, tone] = ACTIVITY_ICONS.find(([pattern]) => pattern.test(name)) ?? [
    null,
    CircleDot,
    "text-muted",
  ];
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-pill bg-canvas"
    >
      <Glyph size={16} strokeWidth={1.75} className={tone} />
    </span>
  );
}

/** ⋮ with «Засах» and «Устгах» — the row menu every list in the product uses. */
function EditMenu({
  label,
  onEdit,
  onDelete,
}: {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <RowMenu
      ariaLabel={`${label} — үйлдэл`}
      triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
      items={[
        { label: "Засах", icon: <Pencil size={16} />, onSelect: onEdit },
        { label: "Устгах", icon: <Trash2 size={16} />, tone: "danger", onSelect: onDelete },
      ]}
    />
  );
}

function DailyTab({
  routine,
  mode,
  actions,
}: {
  routine: Routine;
  mode: RoutineMode;
  actions: RoutineActions;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const items = sortRoutine(routine.items);
  const canEdit = mode === "teacher" && Boolean(actions.saveItems);

  async function save(next: RoutineItem[], message: string) {
    await actions.saveItems!(sortRoutine(next));
    toast.success(message);
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", routineToCsv(items)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `odriin-deglem-${routine.group.name || "buleg"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-label="Өдрийн дэглэм" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-muted">Ажлын өдөр бүр ижил хуваарь</p>
        {/* No Excel for a family — 2026-10-09, the client. */}
        {mode !== "parent" ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={download}>
              <Download size={16} aria-hidden="true" /> Excel
            </Button>
            {canEdit ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
                  <Upload size={16} aria-hidden="true" /> Excel-ээс оруулах
                </Button>
                <Button size="sm" onClick={() => setEditing({ index: null })}>
                  <Plus size={16} aria-hidden="true" /> Нэмэх
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <Card pad="roomy" className="flex flex-col items-center gap-2 text-center">
          <p className="text-body font-medium text-ink">Өдрийн дэглэм оруулаагүй байна</p>
          {canEdit ? (
            <Button
              size="sm"
              onClick={() => void save(ROUTINE_TEMPLATE, "Ерөнхий загвараас эхэллээ.")}
            >
              Ерөнхий загвараас эхлэх
            </Button>
          ) : (
            <p className="text-caption text-muted">Багш оруулсны дараа энд харагдана.</p>
          )}
        </Card>
      ) : (
        <ol className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-card border border-border-soft bg-surface">
          {items.map((item, index) => (
            <li
              key={`${item.start}-${item.name}-${index}`}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <span className="w-12 shrink-0 text-center text-caption font-semibold tabular-nums text-ink">
                {item.start}
                <span className="block font-normal text-muted">{item.end}</span>
              </span>
              <ActivityIcon name={item.name} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-body font-medium text-ink">{item.name}</span>
                {item.description ? (
                  <span className="text-caption text-muted">{item.description}</span>
                ) : null}
                <AreaChips areas={item.areas} />
              </span>
              {canEdit ? (
                <EditMenu
                  label={item.name}
                  onEdit={() => setEditing({ index })}
                  onDelete={() => setDeleting(index)}
                />
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {editing ? (
        <RoutineItemDialog
          item={editing.index === null ? null : items[editing.index]!}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            const next =
              editing.index === null
                ? [...items, item]
                : items.map((row, i) => (i === editing.index ? item : row));
            await save(next, "Өдрийн дэглэм шинэчлэгдлээ.");
            setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title="Энэ үйл ажиллагааг устгах уу?"
        description={deleting !== null ? (items[deleting]?.name ?? "") : ""}
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await save(
              items.filter((_, i) => i !== deleting),
              "Үйл ажиллагаа устгагдлаа.",
            );
            setDeleting(null);
          } catch {
            // Said by the caller.
          } finally {
            setBusy(false);
          }
        }}
      />

      {importing ? (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImport={async (next) => {
            await save(next, `${next.length} мөр орууллаа.`);
            setImporting(false);
          }}
        />
      ) : null}
    </section>
  );
}

function AreaPicker({
  value,
  onChange,
  legend,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  legend: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-caption font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {LEARNING_AREAS.map((area) => {
          const on = value.includes(area);
          return (
            <button
              key={area}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((a) => a !== area) : [...value, area])}
              className={cn(
                "min-h-[36px] rounded-pill border px-3 text-caption transition-colors",
                on
                  ? "border-primary bg-primary-soft font-semibold text-primary"
                  : "border-border-soft text-muted hover:text-ink",
              )}
            >
              {area}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function RoutineItemDialog({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item: RoutineItem | null;
  onClose: () => void;
  onSave: (item: RoutineItem) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState<RoutineItem>(
    item ?? { start: "10:00", end: "10:30", name: "", description: "", areas: [] },
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch {
      // The caller has already said why.
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (!form.name.trim()) return setProblem("Үйл ажиллагааны нэрээ оруулна уу.");
    if (form.start >= form.end) return setProblem("Дуусах цаг эхлэх цагаас хойш байна.");
    setProblem("");
    void run(() =>
      onSave({ ...form, name: form.name.trim(), description: form.description?.trim() || null }),
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={item ? "Үйл ажиллагаа засах" : "Үйл ажиллагаа нэмэх"}
      busy={busy}
      footer={
        <>
          {onDelete ? (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              disabled={busy}
              onClick={() => void run(onDelete)}
            >
              <Trash2 size={16} aria-hidden="true" /> Хасах
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Цуцлах
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {problem ? (
          <p role="alert" className="text-caption text-danger">
            {problem}
          </p>
        ) : null}
        <Field label="Үйл ажиллагааны нэр" required>
          {({ id }) => (
            <Input
              id={id}
              value={form.name}
              maxLength={80}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Тайлбар">
          {({ id }) => (
            <Input
              id={id}
              value={form.description ?? ""}
              maxLength={160}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Эхлэх цаг" required>
            {({ id }) => (
              <Input
                id={id}
                type="time"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            )}
          </Field>
          <Field label="Дуусах цаг" required>
            {({ id }) => (
              <Input
                id={id}
                type="time"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
              />
            )}
          </Field>
        </div>
        {/* Optional on a routine row — 2026-10-09, the client. */}
        <AreaPicker
          legend="Сургалтын чиглэл (заавал биш)"
          value={form.areas}
          onChange={(areas) => setForm({ ...form, areas })}
        />
      </div>
    </FormDialog>
  );
}

/**
 * «Excel-ээс оруулах» — a CSV file, or cells copied straight out of Excel and
 * pasted (they arrive tab-separated). Replaces the whole routine, as the
 * menu's import replaces each day it names.
 */
function ImportDialog({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (items: RoutineItem[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = text.trim() ? parseRoutineTable(text) : null;

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Excel-ээс оруулах"
      description="Эхлэх · Дуусах · Үйл ажиллагаа · Тайлбар · Сургалтын чиглэл баганатай. Одоогийн дэглэмийг бүхэлд нь солино."
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Цуцлах
          </Button>
          <Button
            disabled={busy || !parsed || parsed.items.length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onImport(parsed!.items);
              } catch {
                // Said by the caller.
              } finally {
                setBusy(false);
              }
            }}
          >
            {parsed?.items.length ? `${parsed.items.length} мөр оруулах` : "Оруулах"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="CSV файл">
          {({ id }) => (
            <input
              id={id}
              type="file"
              accept=".csv,text/csv"
              className="text-caption"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setText(await file.text());
              }}
            />
          )}
        </Field>
        <Field label="Эсвэл Excel-ээс мөрүүдээ хуулаад буулгана">
          {({ id }) => (
            <Textarea
              id={id}
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"08:00\t08:40\tӨглөөний хүлээн авалт\tМэндчилгээ\tНийгэм-сэтгэл хөдлөл"}
            />
          )}
        </Field>
        {parsed ? (
          <p className="text-caption text-muted">
            {parsed.items.length} мөр уншигдлаа
            {parsed.skipped ? ` · ${parsed.skipped} мөр цаг эсвэл нэргүй тул алгаслаа` : ""}.
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}

// ─── Судлагдахуун ────────────────────────────────────────────────────────────

/**
 * Each learning area's 3D picture, as «Хоолны цэс» draws a dish's — the
 * client's set, 2026-10-09. The line icon is the fallback should one be
 * missing.
 */
const AREA_ART: Record<string, { src: string | null; icon: Icon }> = {
  "Нийгэм-сэтгэл хөдлөл": { src: AREA_IMAGE["Нийгэм-сэтгэл хөдлөл"]!, icon: Users },
  "Хөдөлгөөн, эрүүл мэнд": { src: AREA_IMAGE["Хөдөлгөөн, эрүүл мэнд"]!, icon: Activity },
  "Хэл яриа": { src: AREA_IMAGE["Хэл яриа"]!, icon: MessagesSquare },
  "Байгаль, нийгмийн орчин": { src: AREA_IMAGE["Байгаль, нийгмийн орчин"]!, icon: Leaf },
  Математик: { src: AREA_IMAGE["Математик"]!, icon: Sigma },
  "Зураг, урлал": { src: AREA_IMAGE["Зураг, урлал"]!, icon: Palette },
  Хөгжим: { src: AREA_IMAGE["Хөгжим"]!, icon: Music },
};

function AreaArt({ area }: { area: string }) {
  const art = AREA_ART[area];
  if (art?.src) {
    return (
      <Image
        src={art.src}
        alt=""
        width={44}
        height={44}
        className="size-11 shrink-0 object-contain"
      />
    );
  }
  const Glyph = art?.icon ?? CircleDot;
  return (
    <span
      aria-hidden="true"
      className="grid size-11 shrink-0 place-items-center rounded-row bg-canvas"
    >
      <Glyph size={20} strokeWidth={1.75} className="text-primary" />
    </span>
  );
}

function PlanTab({
  routine,
  mode,
  actions,
}: {
  routine: Routine;
  mode: RoutineMode;
  actions: RoutineActions;
}) {
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<AreaPlan | null>(null);
  const [clearing, setClearing] = useState<AreaPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = PLAN_TEMPLATE.map(
    (base) => routine.plan.find((row) => row.area === base.area) ?? base,
  );
  const canEdit = mode === "teacher" && Boolean(actions.savePlan);
  const replace = (next: AreaPlan) => plan.map((row) => (row.area === next.area ? next : row));

  return (
    <section aria-label="Судлагдахуун" className="flex flex-col gap-3">
      <p className="text-caption text-muted">
        СӨБ-ын сургалтын 7 чиглэл · хүүхдэд эзэмшүүлэх зорилго, агуулга
      </p>
      {/*
        ★ The seven names, numbered, each opening downward — 2026-10-09, the
        client: "7 сургалтын чиглэлийн нэр харагддаг байгаад доош дропдаун".
      */}
      <ol className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-card border border-border-soft bg-surface">
        {plan.map((row, index) => {
          const expanded = open === row.area;
          const panelId = `area-${index}`;
          return (
            <li key={row.area}>
              <div className="flex items-center gap-2 pr-1">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpen(expanded ? null : row.area)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas/60"
                >
                  <AreaArt area={row.area} />
                  <span className="min-w-0 flex-1 text-body font-semibold text-ink">
                    {row.label || row.area}
                  </span>
                  <ChevronDown
                    size={18}
                    aria-hidden="true"
                    className={cn(
                      "shrink-0 text-muted transition-transform",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
                {canEdit ? (
                  <EditMenu
                    label={row.label || row.area}
                    onEdit={() => setEditing(row)}
                    onDelete={() => setClearing(row)}
                  />
                ) : null}
              </div>
              {expanded ? (
                <div id={panelId} className="flex flex-col gap-1.5 px-4 pb-3 pl-[4.25rem]">
                  <p className="text-caption text-muted">
                    <span className="font-semibold text-ink">Зорилго: </span>
                    {row.goal || "—"}
                  </p>
                  <p className="whitespace-pre-line text-caption text-muted">
                    <span className="font-semibold text-ink">Агуулга: </span>
                    {row.content || "—"}
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {editing ? (
        <PlanDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            await actions.savePlan!(replace(next));
            toast.success(`${next.label || next.area} шинэчлэгдлээ.`);
            setEditing(null);
          }}
        />
      ) : null}

      {/* «Устгах» empties the teacher's goal and content; the seven areas stay. */}
      <ConfirmDialog
        open={clearing !== null}
        onOpenChange={(next) => (next ? undefined : setClearing(null))}
        title="Зорилго, агуулгыг устгах уу?"
        description={
          clearing
            ? `${clearing.label || clearing.area} — нэр нь «${clearing.area}» болж, зорилго, агуулга хоосорно.`
            : ""
        }
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={busy}
        onConfirm={async () => {
          if (!clearing) return;
          setBusy(true);
          try {
            await actions.savePlan!(
              replace({ area: clearing.area, label: null, goal: "", content: "" }),
            );
            toast.success(`${clearing.area} хоосорлоо.`);
            setClearing(null);
          } catch {
            // Said by the caller.
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

function PlanDialog({
  row,
  onClose,
  onSave,
}: {
  row: AreaPlan;
  onClose: () => void;
  onSave: (row: AreaPlan) => Promise<void>;
}) {
  const [label, setLabel] = useState(row.label || row.area);
  const [goal, setGoal] = useState(row.goal);
  const [content, setContent] = useState(row.content);
  const [busy, setBusy] = useState(false);
  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={row.label || row.area}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Цуцлах
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const name = label.trim();
                await onSave({
                  area: row.area,
                  // The standard name typed back is no rename at all.
                  label: name && name !== row.area ? name : null,
                  goal: goal.trim(),
                  content: content.trim(),
                });
              } catch {
                // Said by the caller.
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Сургалтын чиглэлийн нэр" hint={`Үндсэн нэр: ${row.area}`}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
        </Field>
        <Field label="Хүүхдэд эзэмшүүлэх зорилго" hint={`${goal.length}/600`}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              maxLength={600}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          )}
        </Field>
        <Field label="Агуулга" hint={`${content.length}/1200`}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={5}
              maxLength={1200}
              placeholder="Энэ улиралд бүлгээрээ хийх сэдэв, үйл ажиллагаа"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

// ─── Дугуйлан ────────────────────────────────────────────────────────────────

const dayLabels = (days: number[]) =>
  WEEKDAYS.filter((d) => days.includes(d.day))
    .map((d) => d.short)
    .join(" · ");

function ClubsTab({
  routine,
  mode,
  actions,
}: {
  routine: Routine;
  mode: RoutineMode;
  actions: RoutineActions;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Club | "new" | null>(null);
  const [deleting, setDeleting] = useState<Club | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const canEdit = mode === "teacher" && Boolean(actions.saveClub);
  const requestOf = (clubId: string) => routine.requests.find((r) => r.clubId === clubId);
  const pending = routine.requests.filter((r) => r.status === "PENDING").length;

  return (
    <section aria-label="Дугуйлан" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-muted">Бүлгийн дугуйлан</p>
        {mode !== "parent" ? (
          <div className="flex gap-2">
            {/* «Хүсэлт» before «＋ Нэмэх» — 2026-10-09, the client. */}
            <Button size="sm" variant="secondary" onClick={() => setRequestsOpen(true)}>
              Хүсэлт
              {pending > 0 ? (
                <span className="rounded-pill bg-primary px-1.5 text-compact font-semibold text-primary-ink">
                  {pending}
                </span>
              ) : null}
            </Button>
            {canEdit ? (
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus size={16} aria-hidden="true" /> Нэмэх
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {routine.clubs.length === 0 ? (
        <Card pad="roomy" className="text-center text-body text-muted">
          {canEdit ? "Дугуйлан нэмээгүй байна. «Нэмэх»-ээр эхэлнэ үү." : "Дугуйлан алга."}
        </Card>
      ) : (
        /* Minimal — a line each: name, then days, time, room and teacher. */
        <ul className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-card border border-border-soft bg-surface">
          {routine.clubs.map((club) => {
            const mine = requestOf(club.id);
            return (
              <li key={club.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-body font-semibold text-ink">{club.name}</span>
                  <span className="text-caption text-muted">
                    {dayLabels(club.days)} · {club.start}–{club.end}
                    {club.room ? ` · ${club.room}` : ""} · {club.teacherName}
                  </span>
                </span>
                {mode === "parent" ? (
                  mine ? (
                    <Badge
                      tone={
                        mine.status === "APPROVED"
                          ? "mint"
                          : mine.status === "REJECTED"
                            ? "neutral"
                            : "sun"
                      }
                    >
                      {CLUB_REQUEST_LABEL[mine.status]}
                    </Badge>
                  ) : actions.requestClub ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        await actions.requestClub!(club.id);
                        toast.success("Хамрагдах хүсэлт илгээгдлээ.");
                      }}
                    >
                      Хамрагдах хүсэлт
                    </Button>
                  ) : null
                ) : null}
                {canEdit ? (
                  <EditMenu
                    label={club.name}
                    onEdit={() => setEditing(club)}
                    onDelete={() => setDeleting(club)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <ClubDialog
          club={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await actions.saveClub!(input, editing === "new" ? undefined : editing.id);
            toast.success("Дугуйлан хадгалагдлаа.");
            setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title="Энэ дугуйланг устгах уу?"
        description="Хамрагдах хүсэлтүүд нь хамт хасагдана."
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={busy}
        onConfirm={async () => {
          if (!deleting || !actions.deleteClub) return;
          setBusy(true);
          try {
            await actions.deleteClub(deleting.id);
            toast.success("Дугуйлан устгагдлаа.");
            setDeleting(null);
          } catch {
            // Said by the caller.
          } finally {
            setBusy(false);
          }
        }}
      />

      {requestsOpen ? (
        <RequestsDialog
          routine={routine}
          decide={mode === "teacher" ? actions.decide : undefined}
          onClose={() => setRequestsOpen(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * «Хүсэлт» — 2026-10-09, the client: the children by name, which clubs each
 * attends, the total below, and the table to download. Requests still
 * waiting sit above it with «Батлах» and «Татгалзах».
 */
function RequestsDialog({
  routine,
  decide,
  onClose,
}: {
  routine: Routine;
  decide?: (requestId: string, approve: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const clubName = (id: string) => routine.clubs.find((c) => c.id === id)?.name ?? "";
  const pending = routine.requests.filter((r) => r.status === "PENDING");
  const attending = new Map<string, { name: string; clubs: string[] }>();
  for (const r of routine.requests.filter((q) => q.status === "APPROVED")) {
    const row = attending.get(r.childId) ?? { name: r.childName, clubs: [] };
    row.clubs.push(clubName(r.clubId));
    attending.set(r.childId, row);
  }
  const rows = [...attending.values()].sort((a, b) => a.name.localeCompare(b.name, "mn"));

  function download() {
    const quote = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
    const csv = [
      ["№", "Хүүхэд", "Дугуйлан"],
      ...rows.map((row, i) => [i + 1, row.name, row.clubs.join(", ")]),
      [],
      ["Нийт", `${rows.length} хүүхэд`],
    ]
      .map((line) => line.map(quote).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `duguilan-${routine.group.name || "buleg"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Дугуйлангийн хүсэлт"
      size="wide"
      footer={
        <>
          <Button variant="secondary" onClick={download} disabled={rows.length === 0}>
            <Download size={16} aria-hidden="true" /> Excel
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Хаах
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {pending.length > 0 ? (
          <section aria-label="Хүлээгдэж буй хүсэлт" className="flex flex-col gap-1">
            <h3 className="text-body font-semibold text-ink">Хүлээгдэж буй · {pending.length}</h3>
            <ul className="flex flex-col divide-y divide-border-soft">
              {pending.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 text-body text-ink">
                    {request.childName}
                    <span className="text-caption text-muted"> · {clubName(request.clubId)}</span>
                  </span>
                  {decide ? (
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          await decide(request.id, false);
                          toast.success("Хүсэлтээс татгалзлаа.");
                        }}
                      >
                        Татгалзах
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          await decide(request.id, true);
                          toast.success("Хүсэлтийг баталлаа.");
                        }}
                      >
                        Батлах
                      </Button>
                    </span>
                  ) : (
                    <Badge tone="sun">{CLUB_REQUEST_LABEL.PENDING}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {rows.length === 0 ? (
          <p className="py-4 text-center text-body text-muted">
            Дугуйланд хамрагдаж буй хүүхэд алга.
          </p>
        ) : (
          <TableShell caption="Дугуйланд хамрагдах хүүхдүүд" minWidth="min-w-0">
            <thead>
              <tr>
                <Th className="w-10">№</Th>
                <Th>Хүүхэд</Th>
                <Th>Дугуйлан</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.name + index}>
                  <Td className="tabular-nums text-muted">{index + 1}</Td>
                  <Td className="font-medium text-ink">{row.name}</Td>
                  <Td>{row.clubs.join(", ")}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={3} className="font-semibold text-ink">
                  Нийт: {rows.length} хүүхэд
                </Td>
              </tr>
            </tfoot>
          </TableShell>
        )}
      </div>
    </FormDialog>
  );
}

function ClubDialog({
  club,
  onClose,
  onSave,
  onDelete,
}: {
  club: Club | null;
  onClose: () => void;
  onSave: (input: ClubInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState<ClubInput>(
    club ?? {
      name: "",
      teacherName: "",
      room: "",
      days: [1],
      start: "15:00",
      end: "15:30",
      areas: [],
      goal: "",
    },
  );
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState("");

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch {
      // Said by the caller.
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (!form.name.trim() || !form.teacherName.trim())
      return setProblem("Дугуйлангийн нэр, багшийн нэрээ оруулна уу.");
    if (form.days.length === 0) return setProblem("Орох гарагаа сонгоно уу.");
    if (form.areas.length === 0) return setProblem("Сургалтын чиглэлээ сонгоно уу.");
    if (form.start >= form.end) return setProblem("Дуусах цаг эхлэх цагаас хойш байна.");
    setProblem("");
    void run(() =>
      onSave({
        ...form,
        name: form.name.trim(),
        teacherName: form.teacherName.trim(),
        room: form.room?.trim() || null,
        goal: form.goal?.trim() || null,
      }),
    );
  }

  return (
    <>
      <FormDialog
        open
        onOpenChange={(open) => (open ? undefined : onClose())}
        title={club ? "Дугуйлан засах" : "Дугуйлан нэмэх"}
        busy={busy}
        footer={
          <>
            {onDelete ? (
              <Button
                variant="ghost"
                className="mr-auto text-danger"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                <Trash2 size={16} aria-hidden="true" /> Устгах
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Цуцлах
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {problem ? (
            <p role="alert" className="text-caption text-danger">
              {problem}
            </p>
          ) : null}
          <Field label="Дугуйлангийн нэр" required>
            {({ id }) => (
              <Input
                id={id}
                value={form.name}
                maxLength={60}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Багшийн нэр" required>
              {({ id }) => (
                <Input
                  id={id}
                  value={form.teacherName}
                  maxLength={60}
                  onChange={(e) => setForm({ ...form, teacherName: e.target.value })}
                />
              )}
            </Field>
            <Field label="Танхим">
              {({ id }) => (
                <Input
                  id={id}
                  value={form.room ?? ""}
                  maxLength={50}
                  onChange={(e) => setForm({ ...form, room: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Эхлэх цаг" required>
              {({ id }) => (
                <Input
                  id={id}
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              )}
            </Field>
            <Field label="Дуусах цаг" required>
              {({ id }) => (
                <Input
                  id={id}
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              )}
            </Field>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-caption font-semibold text-ink">Орох гараг</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = form.days.includes(d.day);
                return (
                  <button
                    key={d.day}
                    type="button"
                    aria-pressed={on}
                    aria-label={d.name}
                    onClick={() =>
                      setForm({
                        ...form,
                        days: on
                          ? form.days.filter((x) => x !== d.day)
                          : [...form.days, d.day].sort(),
                      })
                    }
                    className={cn(
                      "min-h-[36px] min-w-[44px] rounded-pill border px-3 text-caption transition-colors",
                      on
                        ? "border-primary bg-primary-soft font-semibold text-primary"
                        : "border-border-soft text-muted hover:text-ink",
                    )}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <AreaPicker
            legend="Сургалтын чиглэл"
            value={form.areas}
            onChange={(areas) => setForm({ ...form, areas })}
          />
          <Field label="Сургалтын зорилго">
            {({ id }) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={450}
                value={form.goal ?? ""}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
              />
            )}
          </Field>
        </div>
      </FormDialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => (next ? undefined : setConfirming(false))}
        title="Энэ дугуйланг устгах уу?"
        description="Хамрагдах хүсэлтүүд нь хамт хасагдана."
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={busy}
        onConfirm={() => {
          setConfirming(false);
          void run(onDelete!);
        }}
      />
    </>
  );
}
