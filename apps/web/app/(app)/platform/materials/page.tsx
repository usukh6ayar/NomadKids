"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { DemoBanner } from "@/components/feedback/feedback-parts";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { Art } from "@/components/ui/art";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { TableShell, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/api/errors";
import {
  AUTO_PREVIEW_PAGES,
  DEMO_MATERIALS,
  PREVIEW_STATUS_LABEL,
  type PreviewStatus,
  MATERIAL_LEVELS,
  fileTypeOf,
  materialPrice,
  platformMaterialsSchema,
  type MaterialLevel,
  type PlatformMaterial,
} from "@/lib/materials";
import { LEARNING_AREAS } from "@/lib/routine";

/**
 * Сургалтын хэрэглэгдэхүүн — the operator's catalog, 2026-10-09: what the
 * teachers' shop sells (`components/materials/teaching-materials.tsx`). The
 * platform's own content, so it sits behind `RequireSuperAdmin`, not a role.
 * Contract: `lib/materials.ts`.
 */
export default function PlatformMaterialsPage() {
  return (
    <RequireSuperAdmin>
      <PlatformMaterials />
    </RequireSuperAdmin>
  );
}

const KEY = ["platform", "materials"] as const;
const PREVIEW_TONE: Record<PreviewStatus, "neutral" | "sun" | "mint" | "danger"> = {
  MANUAL: "neutral",
  PENDING: "sun",
  READY: "mint",
  FAILED: "danger",
};
const NOT_READY = "Хэрэглэгдэхүүний сервер хараахан бэлэн болоогүй тул хадгалагдсангүй.";

function PlatformMaterials() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PlatformMaterial | "new" | null>(null);
  const [removing, setRemoving] = useState<PlatformMaterial | null>(null);
  const list = useQuery({
    queryKey: KEY,
    queryFn: () => get("/platform/materials", platformMaterialsSchema),
    retry: false,
    // While the server is still drawing sample pages, look again every 5 s.
    refetchInterval: (query) =>
      query.state.data?.some((m) => m.previewStatus === "PENDING") ? 5000 : false,
  });
  const demo = list.isError && isNotFound(list.error);
  const items: PlatformMaterial[] = demo
    ? DEMO_MATERIALS.map(({ owned: _owned, ...m }) => ({
        ...m,
        published: true,
        sales: 0,
        previewStatus: "MANUAL" as const,
      }))
    : (list.data ?? []);

  const regenerate = useMutation({
    mutationFn: (id: string) =>
      mutate(`/platform/materials/${id}/previews/regenerate`, z.unknown(), { method: "POST" }),
    onSuccess: () => {
      toast.success("Жишээ хуудсыг дахин үүсгэж байна.");
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => toast.error(isNotFound(error) ? NOT_READY : errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      mutate(`/platform/materials/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Дэлгүүрээс хасагдлаа.");
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => toast.error(isNotFound(error) ? NOT_READY : errorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-4">
      <PlatformPageHeading
        title="Сургалтын хэрэглэгдэхүүн"
        lede="Багш нарт зарах бэлэн үзүүлэн, хичээлүүд."
        mark={<Art name="adminCurriculum" size={44} />}
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden="true" /> Нэмэх
          </Button>
        }
      />

      {demo ? (
        <DemoBanner>
          Жишээ жагсаалт харагдаж байна. Сервер холбогдоход жинхэнэ каталог гарна.
        </DemoBanner>
      ) : null}
      {list.isLoading ? <LoadingState rows={5} /> : null}
      {list.isError && !demo ? <ErrorState description={errorMessage(list.error)} /> : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          title="Хэрэглэгдэхүүн нэмээгүй байна"
          description="«Нэмэх»-ээр PDF эсвэл PowerPoint файлаа оруулна уу."
        />
      ) : null}

      {items.length > 0 ? (
        <TableShell caption="Сургалтын хэрэглэгдэхүүний каталог" minWidth="min-w-[720px]">
          <thead>
            <tr>
              <Th>Нэр</Th>
              <Th>Чиглэл</Th>
              <Th>Түвшин</Th>
              <Th>Төрөл</Th>
              <Th numeric>Үнэ</Th>
              <Th numeric>Борлуулалт</Th>
              <Th>Жишээ хуудас</Th>
              <Th>Төлөв</Th>
              <Th className="w-10">
                <span className="sr-only">Үйлдэл</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium text-ink">{m.title}</Td>
                <Td>{m.area}</Td>
                <Td>{m.level ?? "—"}</Td>
                <Td>{m.fileType}</Td>
                <Td numeric>{materialPrice(m.price)}</Td>
                <Td numeric>{m.sales}</Td>
                <Td>
                  <Badge tone={PREVIEW_TONE[m.previewStatus]}>
                    {PREVIEW_STATUS_LABEL[m.previewStatus]}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={m.published ? "mint" : "neutral"}>
                    {m.published ? "Зарагдаж буй" : "Нуусан"}
                  </Badge>
                </Td>
                <Td>
                  <RowMenu
                    ariaLabel={`${m.title} — үйлдэл`}
                    triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
                    items={[
                      { label: "Засах", icon: <Pencil size={16} />, onSelect: () => setEditing(m) },
                      {
                        label: "Жишээ хуудас дахин үүсгэх",
                        icon: <RefreshCw size={16} />,
                        hint: `Эхний ${AUTO_PREVIEW_PAGES} хуудаснаас`,
                        onSelect: () => (demo ? toast.error(NOT_READY) : regenerate.mutate(m.id)),
                      },
                      {
                        label: "Устгах",
                        icon: <Trash2 size={16} />,
                        tone: "danger",
                        onSelect: () => setRemoving(m),
                      },
                    ]}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      ) : null}

      {editing ? (
        <MaterialDialog
          material={editing === "new" ? null : editing}
          demo={demo}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: KEY });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => (next ? undefined : setRemoving(null))}
        title="Дэлгүүрээс хасах уу?"
        description="Худалдаж авсан багш нар санд нь хадгалсаар байна."
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => {
          if (!removing) return;
          if (demo) {
            toast.error(NOT_READY);
            setRemoving(null);
            return;
          }
          remove.mutate(removing.id);
        }}
      />
    </div>
  );
}

function MaterialDialog({
  material,
  demo,
  onClose,
  onSaved,
}: {
  material: PlatformMaterial | null;
  demo: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(material?.title ?? "");
  const [description, setDescription] = useState(material?.description ?? "");
  const [area, setArea] = useState(material?.area ?? "");
  const [level, setLevel] = useState<MaterialLevel | "">(material?.level ?? "");
  const [price, setPrice] = useState(material ? String(material.price) : "");
  const [published, setPublished] = useState(material?.published ?? true);
  const [file, setFile] = useState<File | null>(null);
  /** Up to six sample pages; the first is the shop card's cover. */
  const [previews, setPreviews] = useState<File[]>([]);
  /**
   * ★ Phase 2: let the server draw the sample pages from the file itself —
   * on for a new upload, since it needs nothing from the operator.
   */
  const [autoPreview, setAutoPreview] = useState(
    material ? material.previewStatus !== "MANUAL" : true,
  );
  const [contents, setContents] = useState((material?.contents ?? []).join("\n"));
  const [problem, setProblem] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("title", title.trim());
      if (description.trim()) form.set("description", description.trim());
      form.set("area", area);
      if (level) form.set("level", level);
      form.set("price", String(Number(price)));
      form.set("published", String(published));
      if (file) form.set("file", file);
      form.set("autoPreview", String(autoPreview));
      if (!autoPreview) for (const picture of previews) form.append("previews", picture);
      for (const line of contents
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)) {
        form.append("contents", line);
      }
      return mutate(
        material ? `/platform/materials/${material.id}` : "/platform/materials",
        z.unknown(),
        { method: material ? "PUT" : "POST", body: form },
      );
    },
    onSuccess: () => {
      toast.success("Хэрэглэгдэхүүн хадгалагдлаа.");
      onSaved();
    },
    onError: (error) => {
      if (isNotFound(error)) toast.error(NOT_READY);
    },
  });
  const errors = fieldErrors(save.error);

  function submit() {
    if (!title.trim() || !area) return setProblem("Нэр, сургалтын чиглэлээ оруулна уу.");
    if (!/^\d+$/.test(price.trim())) return setProblem("Үнийг бүхэл төгрөгөөр оруулна уу.");
    if (!material && !file) return setProblem("PDF эсвэл PowerPoint файлаа сонгоно уу.");
    if (file && !fileTypeOf(file.name)) return setProblem("Зөвхөн PDF, PPT, PPTX файл оруулна.");
    if (previews.length > 6) return setProblem("Урьдчилан харах зураг 6 хүртэл байна.");
    setProblem("");
    if (demo) {
      toast.error(NOT_READY);
      return;
    }
    save.mutate();
  }

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={material ? "Хэрэглэгдэхүүн засах" : "Хэрэглэгдэхүүн нэмэх"}
      busy={save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Цуцлах
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError
          message={
            problem ||
            (save.isError && !isNotFound(save.error) && Object.keys(errors).length === 0
              ? errorMessage(save.error)
              : null)
          }
        />
        <Field label="Нэр" error={errors.title} required>
          {({ id }) => (
            <Input
              id={id}
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="Тайлбар" error={errors.description}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={2}
              maxLength={400}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Сургалтын чиглэл" error={errors.area} required>
            {({ id }) => (
              <Select id={id} value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">Сонгоно уу</option>
                {LEARNING_AREAS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Түвшин" error={errors.level}>
            {({ id }) => (
              <Select
                id={id}
                value={level}
                onChange={(e) => setLevel(e.target.value as MaterialLevel | "")}
              >
                <option value="">Бүх түвшин</option>
                {MATERIAL_LEVELS.map((key) => (
                  <option key={key} value={key}>
                    {key} түвшин
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Үнэ (₮)" error={errors.price} hint="0 бол үнэгүй" required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={material ? "Файл солих (PDF, PPT)" : "Файл (PDF, PPT)"}
          error={errors.file}
          hint={material?.fileName ? `Одоогийн: ${material.fileName}` : undefined}
          required={!material}
        >
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="file"
              accept=".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="text-caption"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          )}
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-caption font-semibold text-ink">Жишээ хуудас</legend>
          {(
            [
              [true, `Автоматаар үүсгэх (эхний ${AUTO_PREVIEW_PAGES} хуудаснаас)`],
              [false, "Зургаа өөрөө оруулах"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={label}
              className="flex min-h-[36px] cursor-pointer items-center gap-2 text-body text-ink"
            >
              <input
                type="radio"
                name="preview-source"
                checked={autoPreview === value}
                onChange={() => setAutoPreview(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {autoPreview ? null : (
          <Field
            label="Урьдчилан харах хуудас (6 хүртэл зураг)"
            error={errors.previews}
            hint={
              previews.length
                ? `${previews.length} зураг сонгосон — эхнийх нь нүүр зураг болно`
                : material?.previewUrls.length
                  ? `Одоогийн: ${material.previewUrls.length} зураг. Шинээр сонговол солигдоно.`
                  : "Худалдаж авахаас өмнө багш харах жишээ хуудсууд"
            }
          >
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                type="file"
                accept="image/*"
                multiple
                className="text-caption"
                onChange={(e) => setPreviews(Array.from(e.target.files ?? []))}
              />
            )}
          </Field>
        )}
        <Field label="Агуулга" error={errors.contents} hint="Мөр бүрт нэг сэдэв">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              value={contents}
              placeholder={"1–5 хүртэл тоолох\nИх, бага харьцуулах"}
              onChange={(e) => setContents(e.target.value)}
            />
          )}
        </Field>
        <Checkbox
          label="Дэлгүүрт зарах"
          checked={published}
          onChange={(e) => setPublished(e.target.checked)}
        />
      </div>
    </FormDialog>
  );
}
