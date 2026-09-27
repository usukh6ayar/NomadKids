"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  FolderPlus,
  ImagePlus,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { z } from "zod";
import { MAX_PHOTOS_PER_AGE_ALBUM_CATEGORY, type AgeAlbumSummary } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { MediaThumb } from "@/components/media/media-image";
import { cn } from "@/lib/utils";

export type AddedAlbumType = AgeAlbumSummary["customCategories"][number];

const typeSchema = z.object({ id: z.string(), name: z.string() });

/**
 * The photo types a family or a teacher added — client, 2026-09-18: "зургийн
 * төрөл нэмж 3 цэг дээр засаж устгаж болдог болго, үндсэн төрлүүдийг засаж
 * устгахгүй".
 *
 * ★ Rendered as `<li>`s into the same grid as the twelve built-in cards, so an
 * added type reads as one more card rather than a second section. Only these
 * carry the ⋮ menu; the twelve have no id and nothing to rename.
 *
 * ★★ A guardian sees the menu only on a type they added — the rule the API
 * enforces (`MediaService.editableAlbumCategory`), mirrored so the menu is
 * absent rather than present-and-404.
 */
export function AddedAlbumTypeCards({
  childId,
  age,
  types,
  canEdit,
  onUpload,
}: {
  childId: string;
  age: number;
  types: AddedAlbumType[];
  canEdit: boolean;
  onUpload: (type: AddedAlbumType) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { session, hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<AddedAlbumType | null>(null);
  const [deleting, setDeleting] = useState<AddedAlbumType | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.childAgeAlbum(childId, age) });
  const base = `/children/${childId}/media/album-categories`;

  const create = useMutation({
    mutationFn: (name: string) => mutate(base, typeSchema, { method: "POST", body: { age, name } }),
    onSuccess: async (type) => {
      await refresh();
      setAdding(false);
      toast.success(`"${type.name}" төрөл нэмэгдлээ.`);
    },
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      mutate(`${base}/${id}`, typeSchema, { method: "PATCH", body: { name } }),
    onSuccess: async () => {
      await refresh();
      setRenaming(null);
      toast.success("Төрлийн нэр хадгалагдлаа.");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => mutate(`${base}/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: async () => {
      await refresh();
      setDeleting(null);
      toast.success("Төрөл устгагдлаа.");
    },
    onError: (error) => {
      setDeleting(null);
      toast.error(errorMessage(error));
    },
  });

  const mayChange = (type: AddedAlbumType) =>
    canEdit && (isStaff || (Boolean(session?.user.id) && type.createdById === session?.user.id));

  return (
    <>
      {types.map((type) => {
        const full = type.count >= MAX_PHOTOS_PER_AGE_ALBUM_CATEGORY;
        return (
          <li key={type.id} className="flex">
            <Card className="card-interactive relative flex w-full flex-col overflow-hidden">
              <Link
                href={`?type=${type.id}#selected-album`}
                scroll={false}
                aria-label={`${type.name}, ${type.count} зураг`}
                className="group flex min-h-full flex-1 flex-col"
              >
                {type.thumbnailMediaId ? (
                  <MediaThumb
                    mediaId={type.thumbnailMediaId}
                    caption={type.name}
                    flush
                    className="aspect-[4/3]"
                  />
                ) : (
                  <span className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[#eef6ff] to-[#f3eefe] text-[#5c63a8]">
                    <ImagePlus size={34} aria-hidden="true" />
                  </span>
                )}
                <span className="flex flex-1 flex-col px-3.5 py-3">
                  <span className="min-h-10 break-words text-body font-semibold leading-snug text-ink">
                    {type.name}
                  </span>
                  <span className="mt-2 flex items-center justify-between text-caption text-muted">
                    <span className={cn("tabular-nums", full && "font-semibold text-ink")}>
                      {type.count}/{MAX_PHOTOS_PER_AGE_ALBUM_CATEGORY} зураг
                    </span>
                    <ChevronRight
                      size={17}
                      aria-hidden="true"
                      className="text-primary transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                  <span className="mt-auto h-[52px] pt-2" aria-hidden="true" />
                </span>
              </Link>

              {/* Outside the link: a button inside an `<a>` would also follow it. */}
              {canEdit ? (
                <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
                  {full ? (
                    <span className="rounded-pill bg-surface/95 px-2.5 py-1 text-caption font-semibold text-muted shadow-sm">
                      Дүүрсэн
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="icon"
                      className="rounded-pill bg-surface/95"
                      aria-label={`${type.name} ангилалд зураг нэмэх`}
                      onClick={() => onUpload(type)}
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  )}
                  {mayChange(type) ? (
                    <div className="rounded-pill bg-surface/95 shadow-sm">
                      <RowMenu
                        ariaLabel={`${type.name} төрлийн үйлдэл`}
                        triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
                        items={[
                          {
                            label: "Засах",
                            icon: <Pencil size={16} />,
                            onSelect: () => setRenaming(type),
                          },
                          {
                            label: "Устгах",
                            icon: <Trash2 size={16} />,
                            tone: "danger",
                            hint: type.count > 0 ? "Эхлээд доторх зургийг устгана" : undefined,
                            onSelect: () => setDeleting(type),
                          },
                        ]}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>
          </li>
        );
      })}

      {canEdit ? (
        <li className="flex">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border bg-surface px-3 text-center text-muted transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
          >
            <FolderPlus size={30} aria-hidden="true" />
            <span className="text-body font-semibold">Төрөл нэмэх</span>
            <span className="text-caption">Өөрийн зургийн төрлийг үүсгэнэ</span>
          </button>
        </li>
      ) : null}

      <TypeNameDialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) create.reset();
        }}
        title="Зургийн төрөл нэмэх"
        description={`${age} насны цомогт шинэ төрөл нэмнэ. Нэг төрөлд ${MAX_PHOTOS_PER_AGE_ALBUM_CATEGORY} хүртэл зураг орно.`}
        submitLabel="Нэмэх"
        pending={create.isPending}
        error={create.error ? errorMessage(create.error) : null}
        onSubmit={(name) => create.mutate(name)}
      />

      <TypeNameDialog
        key={renaming?.id ?? "none"}
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenaming(null);
            rename.reset();
          }
        }}
        title="Төрлийн нэр засах"
        initialName={renaming?.name ?? ""}
        submitLabel="Хадгалах"
        pending={rename.isPending}
        error={rename.error ? errorMessage(rename.error) : null}
        onSubmit={(name) => renaming && rename.mutate({ id: renaming.id, name })}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? null : setDeleting(null))}
        title="Төрөл устгах уу?"
        description={
          deleting && deleting.count > 0
            ? `"${deleting.name}" төрөлд ${deleting.count} зураг байна. Эхлээд зургуудыг устгаад дараа нь төрлийг устгана уу.`
            : `"${deleting?.name ?? ""}" төрлийг устгана.`
        }
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

function TypeNameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialName = "",
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initialName?: string;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const trimmed = name.trim();
  const localError = touched && trimmed.length === 0 ? "Төрлийн нэрийг бичнэ үү" : null;
  const formId = `album-type-${title}`;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName(initialName);
          setTouched(false);
        }
        onOpenChange(next);
      }}
      title={title}
      description={description}
      busy={pending}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Болих
          </Button>
          <Button type="submit" form={formId} size="sm" disabled={pending}>
            {pending ? "Хадгалж байна…" : submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (trimmed && !pending) onSubmit(trimmed);
        }}
      >
        <Field label="Төрлийн нэр" error={localError ?? error} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              maxLength={40}
              placeholder="Жишээ нь: Бассейн"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}
