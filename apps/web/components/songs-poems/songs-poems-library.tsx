"use client";

import {
  ArrowLeft,
  BookOpenText,
  FileDown,
  FileUp,
  ImagePlus,
  MoreVertical,
  Music2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  createSongPoemResource,
  removeSongPoemResource,
  updateSchoolMonth,
  updateSongPoemResource,
  useSchoolMonths,
  useSongPoemResources,
  type SchoolMonth,
  type SchoolMonthKey,
  type SongPoemDraft,
  type SongPoemResource,
  type SongPoemType,
} from "@/lib/songs-poems";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RESOURCE_TYPES: Record<
  SongPoemType,
  { label: string; tone: "primary" | "mint" | "sun" | "sky" }
> = {
  song: { label: "Дуу", tone: "primary" },
  poem: { label: "Шүлэг", tone: "mint" },
  folklore: { label: "Ардын аман зохиол", tone: "sun" },
  fairy_tale: { label: "Үлгэр", tone: "sky" },
};

export function SongsPoemsLibrary({ mode }: { mode: "teacher" | "parent" }) {
  const months = useSchoolMonths();
  const resources = useSongPoemResources();
  const toast = useToast();
  const [month, setMonth] = useState<SchoolMonthKey | null>(null);
  const [editing, setEditing] = useState<SongPoemResource | "new" | null>(null);
  const [editingMonth, setEditingMonth] = useState<SchoolMonth | null>(null);
  const [removing, setRemoving] = useState<SongPoemResource | null>(null);

  const selectedMonth = months.find((item) => item.key === month);
  const monthResources = useMemo(
    () => (month ? resources.filter((item) => item.month === month) : []),
    [month, resources],
  );

  if (!selectedMonth) {
    return (
      <>
        <section aria-label="Сарын хавтас" className="flex flex-col gap-4">
          {mode === "teacher" ? (
            <Card tone="sky" pad="compact" className="text-body leading-relaxed text-muted">
              Энэ нь фронт-эндийн туршилтын сан. Оруулсан зураг, файл энэ браузерын сессэд түр
              хадгалагдана; backend холбогдоход бүлгийн эцэг эхэд байнгын байдлаар хүрнэ.
            </Card>
          ) : null}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {months.map((item) => (
              <MonthBook
                key={item.key}
                month={item}
                count={resources.filter((resource) => resource.month === item.key).length}
                editable={mode === "teacher"}
                onOpen={() => setMonth(item.key)}
                onEdit={() => setEditingMonth(item)}
              />
            ))}
          </div>
        </section>

        {mode === "teacher" && editingMonth ? (
          <MonthBookFormDialog
            open
            month={editingMonth}
            onOpenChange={(open) => !open && setEditingMonth(null)}
            onSaved={({ label, subtitle }) => {
              updateSchoolMonth(editingMonth.key, { label, subtitle });
              toast.success("Номын хавтас шинэчлэгдлээ.");
              setEditingMonth(null);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="songs-poems-selected-month" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Сарын хавтас руу буцах"
            onClick={() => setMonth(null)}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <h2 id="songs-poems-selected-month" className="text-title font-semibold text-ink">
              {selectedMonth.label} — Дуу, шүлэг
            </h2>
            <p className="mt-0.5 text-caption text-muted">
              {monthResources.length} материал · {selectedMonth.subtitle}
            </p>
          </div>
        </div>

        {mode === "teacher" ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            Дуу, шүлэг нэмэх
          </Button>
        ) : null}
      </div>

      {monthResources.length === 0 ? (
        <div className="rounded-card border border-border-soft bg-surface px-6 py-12 text-center">
          <p className="text-body font-medium text-muted/70">Хоосон</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {monthResources.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              editable={mode === "teacher"}
              onEdit={() => setEditing(resource)}
              onRemove={() => setRemoving(resource)}
            />
          ))}
        </div>
      )}

      {mode === "teacher" && editing ? (
        <ResourceFormDialog
          open
          month={selectedMonth.key}
          resource={editing === "new" ? null : editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={(draft) => {
            if (editing === "new") {
              createSongPoemResource(draft);
              toast.success("Дуу, шүлэг сарын хавтаст нэмэгдлээ.");
            } else {
              updateSongPoemResource(editing.id, draft);
              toast.success("Дуу, шүлгийн мэдээлэл шинэчлэгдлээ.");
            }
            setEditing(null);
          }}
        />
      ) : null}

      {mode === "teacher" && removing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title="Дуу, шүлгийг устгах уу?"
          description={`«${removing.title}» материалыг ${selectedMonth.label}-ын хавтсаас устгана.`}
          confirmLabel="Устгах"
          tone="danger"
          onConfirm={() => {
            removeSongPoemResource(removing.id);
            toast.success("Материал устгагдлаа.");
            setRemoving(null);
          }}
        />
      ) : null}
    </section>
  );
}
function MonthBook({
  month,
  count,
  editable,
  onOpen,
  onEdit,
}: {
  month: SchoolMonth;
  count: number;
  editable: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${month.label} хавтас, ${count} материал`}
        onClick={onOpen}
        className={cn(
          "group relative min-h-[190px] w-full overflow-hidden rounded-card border border-white/80 bg-gradient-to-br p-4 pl-7 pr-12 text-left shadow-sm transition duration-200",
          "hover:-translate-y-1 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          month.cover,
          month.ink,
        )}
      >
        <span className={cn("absolute inset-y-0 left-0 w-4 shadow-inner", month.spine)} />
        <span className="mt-8 block text-heading font-bold leading-heading">{month.label}</span>
        <span className="mt-1 block text-caption font-medium opacity-75">{month.subtitle}</span>
        <span className="mt-5 inline-flex px-3 py-1 text-caption font-semibold">
          {count > 0 ? `${count} материал` : "Хоосон"}
        </span>
      </button>

      {editable ? (
        <RowMenu
          ariaLabel={`${month.label} хавтас — үйлдэл`}
          className="absolute right-2 top-2 z-10"
          triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
          items={[{ label: "Засах", onSelect: onEdit }]}
        />
      ) : null}
    </div>
  );
}

function MonthBookFormDialog({
  open,
  month,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  month: SchoolMonth;
  onOpenChange: (open: boolean) => void;
  onSaved: (values: Pick<SchoolMonth, "label" | "subtitle">) => void;
}) {
  const formId = useId();
  const [label, setLabel] = useState(month.label);
  const [subtitle, setSubtitle] = useState(month.subtitle);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(month.label);
    setSubtitle(month.subtitle);
    setProblem(null);
  }, [month, open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanLabel = label.trim();
    const cleanSubtitle = subtitle.trim();
    if (!cleanLabel) return setProblem("Сарын нэрийг оруулна уу.");
    if (!cleanSubtitle) return setProblem("Гарчгийг оруулна уу.");
    onSaved({ label: cleanLabel, subtitle: cleanSubtitle });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Номын хавтас засах"
      description="Номын нүүрэн дээр харагдах сар болон гарчгийг өөрчилнө."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button type="submit" form={formId} size="sm">
            Шинэчлэх
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <FormError message={problem} />
        <Field label="Сар" required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
              placeholder="Жишээ: 9-р сар"
            />
          )}
        </Field>
        <Field label="Гарчиг" required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={subtitle}
              onChange={(event) => setSubtitle(event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
              placeholder="Жишээ: Намрын эхлэл"
            />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}

function ResourceCard({
  resource,
  editable,
  onEdit,
  onRemove,
}: {
  resource: SongPoemResource;
  editable: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const Icon = resource.type === "song" ? Music2 : BookOpenText;
  const type = RESOURCE_TYPES[resource.type];
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="relative grid h-40 place-items-center overflow-hidden bg-gradient-to-br from-primary-soft via-surface to-mint">
        {resource.coverUrl ? (
          <img src={resource.coverUrl} alt="" className="h-full w-full object-contain p-4" />
        ) : (
          <Icon size={52} aria-hidden="true" className="text-primary/75" />
        )}
        <Badge tone={type.tone} className="absolute bottom-3 left-3">
          {type.label}
        </Badge>
        {editable ? (
          <RowMenu
            ariaLabel={`${resource.title} — үйлдэл`}
            className="absolute right-2 top-2 rounded-pill bg-surface/90 shadow-sm"
            triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
            items={[
              { label: "Засах", icon: <Pencil size={16} />, onSelect: onEdit },
              {
                label: "Устгах",
                icon: <Trash2 size={16} />,
                tone: "danger",
                separated: true,
                onSelect: onRemove,
              },
            ]}
          />
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-lead font-semibold text-ink">{resource.title}</h3>
          {resource.description ? (
            <p className="mt-1 text-body leading-relaxed text-muted">{resource.description}</p>
          ) : null}
        </div>

        {resource.fileUrl && resource.fileType?.startsWith("audio/") ? (
          <audio controls preload="metadata" src={resource.fileUrl} className="mt-auto w-full">
            Таны браузер аудио тоглуулах боломжгүй байна.
          </audio>
        ) : null}

        {resource.fileUrl && resource.fileType?.startsWith("image/") ? (
          <a href={resource.fileUrl} target="_blank" rel="noreferrer" className="mt-auto">
            <img
              src={resource.fileUrl}
              alt={`${resource.title} файлын зураг`}
              className="max-h-44 w-full rounded-row border border-border bg-sunken object-contain"
            />
          </a>
        ) : null}

        {resource.fileUrl &&
        !resource.fileType?.startsWith("audio/") &&
        !resource.fileType?.startsWith("image/") ? (
          <Button asChild variant="secondary" size="sm" block className="mt-auto">
            <a href={resource.fileUrl} target="_blank" rel="noreferrer" download={resource.fileName}>
              <FileDown aria-hidden="true" />
              Файл нээх
            </a>
          </Button>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-soft pt-3 text-caption text-muted">
          <span className="truncate">{resource.fileName ?? resource.coverFileName ?? "Тайлбар"}</span>
          <span className="shrink-0">{resource.updatedAt}</span>
        </div>
      </div>
    </Card>
  );
}

function ResourceFormDialog({
  open,
  month,
  resource,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  month: SchoolMonthKey;
  resource: SongPoemResource | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (draft: SongPoemDraft) => void;
}) {
  const formId = useId();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<SongPoemType>("song");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(resource?.title ?? "");
    setType(resource?.type ?? "song");
    setDescription(resource?.description ?? "");
    setCover(null);
    setAttachment(null);
    setProblem(null);
  }, [open, resource]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();
    if (!cleanTitle) return setProblem("Нэрийг оруулна уу.");
    if (!resource && !cover && !attachment) {
      return setProblem("Нүүр зураг эсвэл дуу, шүлгийн файлаас дор хаяж нэгийг сонгоно уу.");
    }
    if (cover && cover.size > MAX_IMAGE_BYTES) return setProblem("Нүүр зураг 5 MB-аас бага байна.");
    if (attachment && attachment.size > MAX_FILE_BYTES) {
      return setProblem("Дуу, шүлгийн файл 10 MB-аас бага байна.");
    }

    setSaving(true);
    setProblem(null);
    try {
      const coverUrl = cover ? await fileDataUrl(cover) : resource?.coverUrl;
      const fileUrl = attachment ? await fileDataUrl(attachment) : resource?.fileUrl;
      onSaved({
        month,
        title: cleanTitle,
        type,
        description: cleanDescription,
        coverUrl,
        coverFileName: cover?.name ?? resource?.coverFileName,
        fileUrl,
        fileName: attachment?.name ?? resource?.fileName,
        fileType: attachment?.type || resource?.fileType,
      });
    } catch {
      setProblem("Файлыг уншиж чадсангүй. Өөр файл сонгож дахин оролдоно уу.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={resource ? "Дуу, шүлэг засах" : "Дуу, шүлэг нэмэх"}
      busy={saving}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Болих
          </Button>
          <Button type="submit" form={formId} size="sm" disabled={saving}>
            {saving ? "Хадгалж байна…" : resource ? "Шинэчлэх" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <FormError message={problem} />

        <Field label="Нэр" required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
              placeholder="Жишээ: Алтан намар"
            />
          )}
        </Field>

        <Field label="Төрөл" required>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              value={type}
              onChange={(event) => setType(event.target.value as SongPoemType)}
              aria-describedby={describedBy}
              invalid={invalid}
            >
              <option value="song">Дуу</option>
              <option value="poem">Шүлэг</option>
              <option value="folklore">Ардын аман зохиол</option>
              <option value="fairy_tale">Үлгэр</option>
            </Select>
          )}
        </Field>

        <Field label="Тайлбар" hint="Заавал биш">
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
              placeholder="Хүүхдүүд юу сурсан, гэртээ хэрхэн давтахыг товч бичнэ."
            />
          )}
        </Field>

        <UploadField
          label="Нүүр зураг"
          hint="JPEG, PNG, WebP · 5 MB хүртэл"
          accept="image/jpeg,image/png,image/webp"
          file={cover}
          currentName={resource?.coverFileName}
          icon={<ImagePlus aria-hidden="true" />}
          onChange={setCover}
        />

        <UploadField
          label="Дуу, шүлгийн файл"
          hint="Аудио, зураг, PDF эсвэл Word · 10 MB хүртэл"
          accept="audio/*,image/*,application/pdf,.doc,.docx"
          file={attachment}
          currentName={resource?.fileName}
          icon={<FileUp aria-hidden="true" />}
          onChange={setAttachment}
        />
      </form>
    </FormDialog>
  );
}

function UploadField({
  label,
  hint,
  accept,
  file,
  currentName,
  icon,
  onChange,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  currentName?: string;
  icon: ReactNode;
  onChange: (file: File | null) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      {({ id, describedBy }) => (
        <div>
          <input
            id={id}
            type="file"
            accept={accept}
            aria-describedby={describedBy}
            className="sr-only"
            onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          />
          <Button asChild variant="secondary" size="sm">
            <label htmlFor={id} className="w-full cursor-pointer justify-start">
              {icon}
              <span className="truncate">{file?.name ?? currentName ?? "Файл сонгох"}</span>
            </label>
          </Button>
        </div>
      )}
    </Field>
  );
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
