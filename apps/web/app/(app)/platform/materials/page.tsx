"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, List, MoreVertical, Pencil, Plus, RefreshCw, Store, Trash2 } from "lucide-react";
import { StorePreview } from "@/components/materials/teaching-materials";
import { OfficialDocumentsAdmin } from "@/components/platform/official-documents-admin";
import { useState } from "react";
import { z } from "zod";
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
import { SearchField } from "@/components/ui/search-field";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/api/errors";
import {
  AUTO_PREVIEW_PAGES,
  PREVIEW_STATUS_LABEL,
  type PreviewStatus,
  MATERIAL_LEVELS,
  fileTypeOf,
  materialPrice,
  platformMaterialsSchema,
  materialSharePath,
  type MaterialLevel,
  type PlatformMaterial,
} from "@/lib/materials";
import { LEARNING_AREAS } from "@/lib/routine";
import { todayLocal } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CANONICAL_ORIGIN } from "@/lib/canonical-host";

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

/*
 * ★ The learning area is optional — 2026-10-14, the user. The API still needs
 * one (`area` is required in the upload contract and the column), so an
 * unchosen area is sent as «Бусад»; making it truly optional is asked of the
 * admin. The shop has no picture for «Бусад» and falls back as it does for
 * any area without one.
 */
const OTHER_AREA = "Бусад";
const KEY = ["platform", "materials"] as const;
const PREVIEW_TONE: Record<PreviewStatus, "neutral" | "sun" | "mint" | "danger"> = {
  MANUAL: "neutral",
  PENDING: "sun",
  READY: "mint",
  FAILED: "danger",
};

function PlatformMaterials() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PlatformMaterial | "new" | null>(null);
  const [removing, setRemoving] = useState<PlatformMaterial | null>(null);
  /** «Дэлгүүр» — the shop as the teachers see it (2026-10-14, the user). */
  const [shop, setShop] = useState(false);
  /** «Үндсэн баримт бичиг» beside the materials — 2026-10-20, the user. */
  const [tab, setTab] = useState<"materials" | "documents">("materials");
  const [search, setSearch] = useState("");
  const copyLink = (m: PlatformMaterial) => {
    // A production build must never put localhost into a link, even when its
    // public-site build argument was omitted or the page is served by an old
    // preview host. Local development still copies its own origin for testing.
    const origin =
      process.env.NODE_ENV === "production" ? CANONICAL_ORIGIN : window.location.origin;
    const url = `${origin}${materialSharePath(m.id, "nk")}`;
    void navigator.clipboard.writeText(url).then(
      () =>
        toast.success(
          m.published
            ? "Холбоос хуулагдлаа."
            : "Холбоос хуулагдлаа. Нуусан тул «Зарагдаж буй» болгох хүртэл нээгдэхгүй.",
        ),
      () => toast.error(`Хуулж чадсангүй: ${url}`),
    );
  };
  const list = useQuery({
    queryKey: KEY,
    queryFn: () => get("/platform/materials", platformMaterialsSchema),
    retry: false,
    // While the server is still drawing sample pages, look again every 5 s.
    refetchInterval: (query) =>
      query.state.data?.some((m) => m.previewStatus === "PENDING") ? 5000 : false,
  });
  // ★ No sample catalog on a 404 any more (2026-10-11): the API answers, so an
  // error is shown as the error it is.
  const all: PlatformMaterial[] = list.data ?? [];
  // Нэрээр хайх — 2026-10-20, the user. The catalog is one bounded read already.
  const term = search.trim().toLocaleLowerCase("mn");
  const items = term ? all.filter((m) => m.title.toLocaleLowerCase("mn").includes(term)) : all;

  const regenerate = useMutation({
    mutationFn: (id: string) =>
      mutate(`/platform/materials/${id}/previews/regenerate`, z.unknown(), { method: "POST" }),
    onSuccess: () => {
      toast.success("Жишээ хуудсыг дахин үүсгэж байна.");
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      mutate(`/platform/materials/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Дэлгүүрээс хасагдлаа.");
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-4">
      <PlatformPageHeading
        title="Сургалтын хэрэглэгдэхүүн"
        lede={
          tab === "documents"
            ? "Яамны хөтөлбөр, журам — бүх цэцэрлэгийн багш нарт үнэгүй."
            : "Багш нарт зарах бэлэн үзүүлэн, хичээлүүд."
        }
        mark={<Art name="adminCurriculum" size={44} />}
        actions={
          tab === "documents" ? null : (
            <span className="flex gap-2">
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus size={16} aria-hidden="true" /> Нэмэх
              </Button>
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={shop}
                onClick={() => setShop((open) => !open)}
              >
                {shop ? (
                  <>
                    <List size={16} aria-hidden="true" /> Каталог
                  </>
                ) : (
                  <>
                    <Store size={16} aria-hidden="true" /> Дэлгүүр
                  </>
                )}
              </Button>
            </span>
          )
        }
      />

      <div
        role="tablist"
        aria-label="Платформын агуулга"
        className="grid w-full max-w-md grid-cols-2 gap-1 rounded-control bg-canvas p-1"
      >
        {(
          [
            ["materials", "Сургалтын хэрэглэгдэхүүн"],
            ["documents", "Үндсэн баримт бичиг"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "min-h-[40px] rounded-control px-2 text-caption font-semibold transition-colors sm:text-body",
              tab === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "documents" ? (
        <OfficialDocumentsAdmin />
      ) : shop ? (
        <StorePreview />
      ) : (
        <>
          {list.isLoading ? <LoadingState rows={5} /> : null}
          {list.isError ? <ErrorState description={errorMessage(list.error)} /> : null}
          {all.length > 0 ? (
            <SearchField
              label="Хэрэглэгдэхүүн хайх"
              placeholder="Нэрээр хайх..."
              value={search}
              onChange={setSearch}
            />
          ) : null}
          {list.data && all.length > 0 && items.length === 0 ? (
            <EmptyState
              title="Олдсонгүй"
              description={`«${search.trim()}» нэртэй хэрэглэгдэхүүн алга.`}
            />
          ) : null}
          {list.data && all.length === 0 ? (
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
                  <Th numeric>Орлого</Th>
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
                    <Td numeric>
                      {m.revenue === null || m.revenue === undefined
                        ? "—"
                        : `${m.revenue.toLocaleString("en-US")}₮`}
                    </Td>
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
                          {
                            label: "Засах",
                            icon: <Pencil size={16} />,
                            onSelect: () => setEditing(m),
                          },
                          // A page anyone can open, to share — 2026-10-14, the user.
                          {
                            label: "Холбоос хуулах",
                            icon: <Link2 size={16} />,
                            hint: m.published ? undefined : "Нуусан — нээхэд харагдахгүй",
                            onSelect: () => copyLink(m),
                          },
                          {
                            label: "Жишээ хуудас дахин үүсгэх",
                            icon: <RefreshCw size={16} />,
                            hint: `Эхний ${AUTO_PREVIEW_PAGES} хуудаснаас`,
                            onSelect: () => regenerate.mutate(m.id),
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
        </>
      )}

      {editing ? (
        <MaterialDialog
          material={editing === "new" ? null : editing}
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
        description={
          removing && removing.sales > 0
            ? `Худалдаж авсан ${removing.sales} багш материалаа хадгалсаар байна — зөвхөн дэлгүүрээс хасагдана.`
            : "Дэлгүүрээс хасагдана. Одоогоор хэн ч худалдаж аваагүй."
        }
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(removing.id);
        }}
      />
    </div>
  );
}

function MaterialDialog({
  material,
  onClose,
  onSaved,
}: {
  material: PlatformMaterial | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(material?.title ?? "");
  const [description, setDescription] = useState(material?.description ?? "");
  // «Бусад» is what an unchosen area is kept as — shown as unchosen here.
  const [area, setArea] = useState(
    material?.area && material.area !== OTHER_AREA ? material.area : "",
  );
  const [level, setLevel] = useState<MaterialLevel | "">(material?.level ?? "");
  const [price, setPrice] = useState(material && material.price > 0 ? String(material.price) : "");
  /*
   * ★ «Үнэгүй» and «Хямдрал» — 2026-10-14, the user. Free sends a price of 0.
   * A discount (a lower price, until a day) is sent as `discountPrice` /
   * `discountEndsOn`, kept and charged since #273.
   *
   * ★★ The form opens on the stored discount (2026-10-26). It opened unticked,
   * and a save sends no discount — which the API reads as "remove it" — so
   * editing a title silently ended a running discount. One that has already
   * ended opens unticked: it no longer runs, and sending its past end day back
   * would be refused.
   */
  const [free, setFree] = useState(material ? material.price === 0 : false);
  const running =
    typeof material?.discountPrice === "number" &&
    (!material.discountEndsOn || material.discountEndsOn >= todayLocal());
  const [discounted, setDiscounted] = useState(running);
  const [discountPrice, setDiscountPrice] = useState(
    running ? String(material!.discountPrice) : "",
  );
  const [discountEndsOn, setDiscountEndsOn] = useState(
    running ? (material!.discountEndsOn ?? "") : "",
  );
  const full = Number(price);
  const cut = Number(discountPrice);
  const percent =
    discounted && full > 0 && cut > 0 && cut < full ? Math.round((1 - cut / full) * 100) : null;
  const [published, setPublished] = useState(material?.published ?? true);
  const [file, setFile] = useState<File | null>(null);
  /** Up to six sample pages; the first is the shop card's cover. */
  const [previews, setPreviews] = useState<File[]>([]);
  /**
   * ★ Let the server draw the sample pages from the file itself — it can
   * since 2026-10-12 (poppler and LibreOffice in the worker image). Still off
   * by default for a new material: the operator's own pictures are the
   * default (the user, 2026-10-12), and with this on they are not sent.
   */
  const [autoPreview, setAutoPreview] = useState(
    material ? material.previewStatus !== "MANUAL" : false,
  );
  const [contents, setContents] = useState((material?.contents ?? []).join("\n"));
  const [problem, setProblem] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("title", title.trim());
      if (description.trim()) form.set("description", description.trim());
      form.set("area", area || OTHER_AREA);
      if (level) form.set("level", level);
      form.set("price", free ? "0" : String(Number(price)));
      if (!free && discounted) {
        form.set("discountPrice", String(Number(discountPrice)));
        if (discountEndsOn) form.set("discountEndsOn", discountEndsOn);
      }
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
    // A field's own error sits under the field; anything else is said once.
    onError: (error) => {
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  const errors = fieldErrors(save.error);

  function submit() {
    if (!title.trim()) return setProblem("Нэрээ оруулна уу.");
    if (!free && !/^\d+$/.test(price.trim()))
      return setProblem("Үнийг бүхэл төгрөгөөр оруулна уу.");
    if (!free && Number(price) === 0) return setProblem("Үнэ 0 бол «Үнэгүй»-г сонгоно уу.");
    if (!free && discounted && !(/^\d+$/.test(discountPrice.trim()) && cut > 0 && cut < full))
      return setProblem("Хямдралтай үнэ үндсэн үнээс бага, бүхэл төгрөг байна.");
    if (!material && !file) return setProblem("PDF эсвэл PowerPoint файлаа сонгоно уу.");
    if (file && !fileTypeOf(file.name)) return setProblem("Зөвхөн PDF, PPT, PPTX файл оруулна.");
    if (previews.length > 6) return setProblem("Урьдчилан харах зураг 6 хүртэл байна.");
    setProblem("");
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
          <Field label="Сургалтын чиглэл" error={errors.area} hint="Заавал биш">
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                <option value="">Сонгоогүй</option>
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
        <fieldset className="flex flex-col gap-3 rounded-control border border-border p-3">
          <legend className="px-1 text-caption font-semibold text-ink">Үнэ</legend>
          <div role="radiogroup" aria-label="Үнийн төрөл" className="flex gap-4 text-body">
            {(
              [
                [false, "Үнэтэй"],
                [true, "Үнэгүй"],
              ] as const
            ).map(([value, label]) => (
              <label key={label} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="material-price-kind"
                  className="size-4"
                  checked={free === value}
                  onChange={() => setFree(value)}
                />
                {label}
              </label>
            ))}
          </div>

          {free ? (
            <p className="text-caption text-muted">Багш нар үнэгүй татаж авна.</p>
          ) : (
            <>
              <Field label="Үнэ (₮)" error={errors.price} required>
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
              <Checkbox
                label="Хямдрал зарлах"
                checked={discounted}
                onChange={(e) => setDiscounted(e.target.checked)}
              />
              {discounted ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Хямдралтай үнэ (₮)"
                    hint={percent !== null ? `${percent}% хямдрал` : undefined}
                    required
                  >
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        inputMode="numeric"
                        value={discountPrice}
                        onChange={(e) => setDiscountPrice(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Дуусах огноо" hint="Хоосон бол хугацаагүй">
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        type="date"
                        value={discountEndsOn}
                        onChange={(e) => setDiscountEndsOn(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
              ) : null}
            </>
          )}
        </fieldset>
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
