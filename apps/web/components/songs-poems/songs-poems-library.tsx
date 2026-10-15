"use client";

import {
  ArrowLeft,
  ExternalLink,
  FileText,
  FileUp,
  ImagePlus,
  Link2,
  MoreVertical,
  Music2,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import {
  useSongPoemLibrary,
  type SchoolMonth,
  type SchoolMonthKey,
  type SongPoemDraft,
  type SongPoemResource,
  type SongPoemSource,
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

export function SongsPoemsLibrary({
  mode,
  source,
}: {
  /**
   * ★ «admin» reads a group's library (2026-10-12, the user). The API lets the
   * group's own teacher write and the director read, so only a teacher edits.
   */
  mode: "teacher" | "parent" | "admin";
  /** `null` while the page is still working out which group or child. */
  source: SongPoemSource | null;
}) {
  const { months, resources, isLoading, error, actions } = useSongPoemLibrary(source);
  const editable = mode === "teacher";
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

  if (isLoading) return <LoadingState rows={3} shape="cards" />;
  if (error) return <ErrorState description={errorMessage(error)} />;

  if (!selectedMonth) {
    return (
      <>
        <section aria-label="Сарын хавтас" className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {months.map((item) => (
              <MonthBook
                key={item.key}
                month={item}
                count={resources.filter((resource) => resource.month === item.key).length}
                editable={editable}
                onOpen={() => setMonth(item.key)}
                onEdit={() => setEditingMonth(item)}
              />
            ))}
          </div>
        </section>

        {actions && editable && editingMonth ? (
          <MonthBookFormDialog
            open
            month={editingMonth}
            onOpenChange={(open) => !open && setEditingMonth(null)}
            onSaved={async ({ label, subtitle }) => {
              await actions.saveMonth(editingMonth.key, { label, subtitle });
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

        {editable ? (
          // «Нэмэх» on the button (2026-10-15, the user); the full name stays for
          // a screen reader.
          <Button size="sm" onClick={() => setEditing("new")} aria-label="Дуу, шүлэг нэмэх">
            <Plus aria-hidden="true" />
            Нэмэх
          </Button>
        ) : null}
      </div>

      {monthResources.length === 0 ? (
        <div className="rounded-card border border-border-soft bg-surface px-6 py-12 text-center">
          <p className="text-body font-medium text-muted/70">Хоосон</p>
        </div>
      ) : (
        <div className="flex max-w-3xl flex-col gap-4">
          {monthResources.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              editable={editable}
              onEdit={() => setEditing(resource)}
              onRemove={() => setRemoving(resource)}
            />
          ))}
        </div>
      )}

      {actions && editable && editing ? (
        <ResourceFormDialog
          open
          month={selectedMonth.key}
          resource={editing === "new" ? null : editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={async (draft) => {
            await actions.save(draft, editing === "new" ? undefined : editing.id);
            toast.success(
              editing === "new"
                ? "Дуу, шүлэг сарын хавтаст нэмэгдлээ."
                : "Дуу, шүлгийн мэдээлэл шинэчлэгдлээ.",
            );
            setEditing(null);
          }}
        />
      ) : null}

      {actions && editable && removing ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title="Дуу, шүлгийг устгах уу?"
          description={`«${removing.title}» материалыг ${selectedMonth.label}-ын хавтсаас устгана.`}
          confirmLabel="Устгах"
          tone="danger"
          onConfirm={async () => {
            try {
              await actions.remove(removing.id);
              toast.success("Материал устгагдлаа.");
            } catch (cause) {
              toast.error(errorMessage(cause));
            }
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
  onSaved: (values: Pick<SchoolMonth, "label" | "subtitle">) => Promise<void>;
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
    onSaved({ label: cleanLabel, subtitle: cleanSubtitle }).catch((cause) =>
      setProblem(errorMessage(cause)),
    );
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

/**
 * One item as a post — 2026-10-12, the user: the title, kind and date, the
 * description, then one media box. A PDF or a sound file is the same size as
 * a picture, and any of them opens large; a link opens in the same viewer.
 */
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
  const type = RESOURCE_TYPES[resource.type];
  const [viewer, setViewer] = useState<"media" | "link" | null>(null);
  const mediaUrl = resource.fileUrl ?? resource.coverUrl;
  const mediaName = resource.fileName ?? resource.coverFileName;
  const mediaType = resource.fileType ?? (resource.coverUrl ? "image/*" : undefined);
  const image = Boolean(mediaUrl && mediaType?.startsWith("image/"));
  const audio = Boolean(mediaUrl && mediaType?.startsWith("audio/"));
  const video = Boolean(mediaUrl && mediaType?.startsWith("video/"));

  return (
    <article className="flex flex-col gap-3 rounded-card border border-border-soft bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lead font-semibold text-ink">{resource.title}</h3>
          <div className="mt-1 flex items-center gap-2 text-caption text-muted">
            <Badge tone={type.tone}>{type.label}</Badge>
            <span>{resource.updatedAt}</span>
          </div>
        </div>
        {editable ? (
          <RowMenu
            ariaLabel={`${resource.title} — үйлдэл`}
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

      {resource.description ? (
        <p className="text-body leading-relaxed text-ink">{resource.description}</p>
      ) : null}

      {mediaUrl ? (
        <button
          type="button"
          aria-label={`${resource.title} — томоор харах`}
          onClick={() => setViewer("media")}
          className="relative grid max-h-[420px] min-h-44 w-full place-items-center overflow-hidden rounded-control bg-canvas"
        >
          {image ? (
            <img
              src={mediaUrl}
              alt={`${resource.title} зураг`}
              className="max-h-[420px] w-full object-contain"
            />
          ) : (
            <span className="flex flex-col items-center gap-2 px-4 py-8 text-primary">
              {audio || video ? (
                <Play size={42} aria-hidden="true" />
              ) : (
                <FileText size={42} aria-hidden="true" />
              )}
              <span className="max-w-full truncate text-body font-semibold text-ink">
                {mediaName || (audio ? "Сонсох" : "Файл харах")}
              </span>
            </span>
          )}
        </button>
      ) : null}

      {resource.linkUrl ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setViewer("link")}
          className="self-start"
        >
          <Play aria-hidden="true" /> Шууд сонсох
        </Button>
      ) : null}

      {viewer ? (
        <ResourceViewer
          title={resource.title}
          url={viewer === "link" ? resource.linkUrl! : mediaUrl!}
          type={viewer === "link" ? undefined : mediaType}
          fileName={viewer === "link" ? undefined : mediaName}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </article>
  );
}

function ResourceViewer({
  title,
  url,
  type,
  fileName,
  onClose,
}: {
  title: string;
  url: string;
  type?: string;
  fileName?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const isImage = type?.startsWith("image/") || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
  const isAudio = type?.startsWith("audio/") || /\.(mp3|wav|m4a|ogg)(\?|$)/i.test(url);
  const isVideo = type?.startsWith("video/") || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/80 p-3 sm:p-6"
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-full w-full max-w-4xl flex-col gap-3">
        <Button
          variant="secondary"
          size="icon"
          className="ml-auto"
          onClick={onClose}
          aria-label="Хаах"
        >
          <X aria-hidden="true" />
        </Button>
        <div className="flex min-h-64 flex-1 items-center justify-center overflow-hidden rounded-card bg-surface p-3 shadow-lg sm:p-5">
          {isImage ? (
            <img
              src={url}
              alt={title}
              className="max-h-[calc(100vh-8rem)] max-w-full object-contain"
            />
          ) : isAudio ? (
            <div className="flex w-full max-w-xl flex-col items-center gap-5 p-4">
              <Music2 size={64} aria-hidden="true" className="text-primary" />
              <h3 className="text-title font-semibold text-ink">{title}</h3>
              <audio controls autoPlay src={url} className="w-full">
                Таны браузер аудио тоглуулах боломжгүй байна.
              </audio>
            </div>
          ) : isVideo ? (
            <video controls autoPlay src={url} className="max-h-[calc(100vh-8rem)] max-w-full">
              Таны браузер видео тоглуулах боломжгүй байна.
            </video>
          ) : embeddableLink(url) ? (
            <iframe
              src={embeddableLink(url)!}
              title={fileName || title}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="h-[75vh] w-full rounded-control bg-white"
            />
          ) : (
            <div className="flex max-w-lg flex-col items-center gap-4 p-6 text-center">
              <Link2 size={56} aria-hidden="true" className="text-primary" />
              <h3 className="text-title font-semibold text-ink">{title}</h3>
              <Button asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" /> Нээх
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function embeddableLink(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = url.searchParams.get("v") ?? url.pathname.match(/^\/shorts\/([^/]+)/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === "drive.google.com") {
      const match = url.pathname.match(/\/file\/d\/([^/]+)/);
      return match?.[1] ? `https://drive.google.com/file/d/${match[1]}/preview` : null;
    }
    return null;
  } catch {
    return null;
  }
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
  onSaved: (draft: SongPoemDraft) => Promise<void>;
}) {
  const formId = useId();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<SongPoemType>("song");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(resource?.title ?? "");
    setType(resource?.type ?? "song");
    setDescription(resource?.description ?? "");
    setLinkUrl(resource?.linkUrl ?? "");
    setAttachment(null);
    setProblem(null);
  }, [open, resource]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();
    const cleanLink = linkUrl.trim();
    if (!cleanTitle) return setProblem("Нэрийг оруулна уу.");
    if (!resource && !attachment && !cleanLink) {
      return setProblem("Зураг, файл эсвэл линкээс нэгийг оруулна уу.");
    }
    if (attachment?.type.startsWith("video/")) {
      return setProblem("Видео файл оруулах боломжгүй.");
    }
    if (attachment && attachment.size > MAX_FILE_BYTES) {
      return setProblem("Файл 10 MB-аас бага байна.");
    }
    if (attachment?.type.startsWith("image/") && attachment.size > MAX_IMAGE_BYTES)
      return setProblem("Зураг 5 MB-аас бага байна.");

    setSaving(true);
    setProblem(null);
    try {
      // One attachment — a picture, a sound or a document — sent as the file.
      // A file not chosen again is kept by the server.
      await onSaved({
        month,
        title: cleanTitle,
        type,
        description: cleanDescription,
        linkUrl: cleanLink || undefined,
        cover: null,
        file: attachment,
      });
    } catch (cause) {
      setProblem(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={resource ? "Засах" : "Нэмэх"}
      busy={saving}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
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

        <div className="grid grid-cols-2 gap-3">
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
          <Field label="Нэр" required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
                placeholder="Алтан намар"
              />
            )}
          </Field>
        </div>

        <Field label="Тайлбар" optional>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              maxLength={160}
              className="h-9 px-3 text-compact"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
              placeholder="Товч тайлбар"
            />
          )}
        </Field>

        <Field label="Линк" optional>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="url"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
              placeholder="https://"
            />
          )}
        </Field>

        <div role="group" className="grid grid-cols-2 gap-3" aria-label="Медиа оруулах">
          <UploadField
            label="Зураг"
            accept="image/jpeg,image/png,image/webp"
            file={attachment?.type.startsWith("image/") ? attachment : null}
            currentName={resource?.fileType?.startsWith("image/") ? resource.fileName : undefined}
            icon={<ImagePlus aria-hidden="true" />}
            onChange={setAttachment}
          />
          <UploadField
            label="Файл"
            accept="audio/*,application/pdf,.doc,.docx,.mp3,.wav,.m4a,.ogg"
            file={attachment && !attachment.type.startsWith("image/") ? attachment : null}
            currentName={
              resource?.fileType && !resource.fileType.startsWith("image/")
                ? resource.fileName
                : undefined
            }
            icon={<FileUp aria-hidden="true" />}
            onChange={setAttachment}
          />
        </div>
        {attachment ? <p className="truncate text-caption text-muted">{attachment.name}</p> : null}
      </form>
    </FormDialog>
  );
}

function UploadField({
  label,
  accept,
  file,
  currentName,
  icon,
  onChange,
}: {
  label: string;
  accept: string;
  file: File | null;
  currentName?: string;
  icon: ReactNode;
  onChange: (file: File | null) => void;
}) {
  return (
    <Field label={label}>
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
              <span className="truncate">{file?.name ?? currentName ?? label}</span>
            </label>
          </Button>
        </div>
      )}
    </Field>
  );
}
