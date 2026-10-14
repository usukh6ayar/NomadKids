"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, Presentation, X } from "lucide-react";
import { qpayInvoiceAttemptSchema } from "@kinder/contracts";
import { QpayProgress } from "@/components/child/access-pay-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { FilterButton } from "@/components/ui/filter-chip";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { downloadUrl } from "@/lib/api/client";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import {
  MATERIAL_LEVELS,
  materialListSchema,
  materialPrice,
  ownedMaterialsSchema,
  platformMaterialsSchema,
  type Material,
  type MaterialLevel,
} from "@/lib/materials";
import { AREA_IMAGE, LEARNING_AREAS } from "@/lib/routine";
import { cn } from "@/lib/utils";
import { useDebounced } from "@/lib/use-debounced";

type View = "store" | "mine";

/**
 * Сургалтын хэрэглэгдэхүүн — a teacher's shop of ready-made lessons, and the
 * shelf of what they bought (client, 2026-10-09). Teachers only: the caller
 * shows this tab to a TEACHER and to nobody else. Contract: `lib/materials.ts`.
 */
export function TeachingMaterials() {
  // «Миний сан» first, and open — 2026-10-09, the client.
  const [view, setView] = useState<View>("mine");
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Сургалтын хэрэглэгдэхүүн"
        className="grid w-full max-w-xs grid-cols-2 gap-1 rounded-control bg-canvas p-1"
      >
        {(
          [
            ["mine", "Миний сан"],
            ["store", "Дэлгүүр"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={cn(
              "min-h-[40px] rounded-control text-body font-semibold transition-colors",
              view === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "store" ? <Store onOwned={() => setView("mine")} /> : <Mine />}
    </div>
  );
}

interface MaterialFilters {
  q: string;
  area: string;
  level: MaterialLevel | "";
}

/** Whether a material matches — for «Миний сан», and the shop's samples. */
function matches(m: Material, f: MaterialFilters): boolean {
  const needle = f.q.trim().toLowerCase();
  return (
    (!f.area || m.area === f.area) &&
    (!f.level || m.level === f.level) &&
    (!needle ||
      m.title.toLowerCase().includes(needle) ||
      (m.description ?? "").toLowerCase().includes(needle))
  );
}

/**
 * Search, and ⚙ for сургалтын чиглэл and түвшин — the same row on «Миний
 * сан» and «Дэлгүүр» (client, 2026-10-09), drawn with the product's quiet
 * shared pieces.
 */
function MaterialsToolbar({
  filters,
  onChange,
}: {
  filters: MaterialFilters;
  onChange: (next: MaterialFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const active = (filters.area ? 1 : 0) + (filters.level ? 1 : 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SearchField
          label="Хэрэглэгдэхүүн хайх"
          value={filters.q}
          onChange={(q) => onChange({ ...filters, q })}
          className="min-w-0"
        />
        <FilterButton
          expanded={open}
          controls={panelId}
          count={active}
          onClick={() => setOpen(!open)}
        />
      </div>
      <div id={panelId} hidden={!open} className={cn("flex-wrap gap-2", open && "flex")}>
        <div className="w-52">
          <Field label="Сургалтын чиглэлээр шүүх" labelHidden>
            {({ id }) => (
              <Select
                id={id}
                value={filters.area}
                onChange={(e) => onChange({ ...filters, area: e.target.value })}
              >
                <option value="">Бүх чиглэл</option>
                {LEARNING_AREAS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-40">
          <Field label="Түвшнээр шүүх" labelHidden>
            {({ id }) => (
              <Select
                id={id}
                value={filters.level}
                onChange={(e) =>
                  onChange({ ...filters, level: e.target.value as MaterialLevel | "" })
                }
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
      </div>
    </div>
  );
}

const NO_FILTERS: MaterialFilters = { q: "", area: "", level: "" };

/**
 * «Дэлгүүр» as the teachers see it, for the operator — 2026-10-14, the user:
 * "хүмүүс яаж харагдахыг харуул". The teachers' catalog route is theirs alone
 * (`@Roles("TEACHER")`), so this draws the platform's own catalog — the
 * materials on sale only — with the same cards, filters and sample pages.
 * Nothing can be bought here.
 */
export function StorePreview() {
  const [filters, setFilters] = useState<MaterialFilters>(NO_FILTERS);
  const [previewing, setPreviewing] = useState<Material | null>(null);
  const catalog = useQuery({
    queryKey: ["platform", "materials"],
    queryFn: () => get("/platform/materials", platformMaterialsSchema),
  });
  const items: Material[] = (catalog.data ?? [])
    .filter((m) => m.published)
    .map((m) => ({ ...m, owned: false }))
    .filter((m) => matches(m, filters));

  return (
    <section aria-label="Дэлгүүрийн харагдац" className="flex flex-col gap-3">
      <p className="rounded-control bg-canvas px-3.5 py-2.5 text-caption text-muted">
        Багш нар «Дэлгүүр»-ийг ингэж харна. Зөвхөн «Зарагдаж буй» хэрэглэгдэхүүн харагдана. Энд
        худалдан авах боломжгүй.
      </p>
      <MaterialsToolbar filters={filters} onChange={setFilters} />

      {catalog.isLoading ? <LoadingState rows={4} shape="cards" /> : null}
      {catalog.isError ? <ErrorState description={errorMessage(catalog.error)} /> : null}
      {catalog.data && items.length === 0 ? (
        <EmptyState
          title="Дэлгүүрт харагдах хэрэглэгдэхүүн алга"
          description="«Нэмэх»-ээр оруулж, «Зарагдаж буй» болгоход энд харагдана."
        />
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((material) => (
          <li key={material.id}>
            <MaterialCard material={material}>
              <span className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setPreviewing(material)}>
                  Урьдчилан харах
                </Button>
                <Button size="sm" disabled title="Урьдчилсан харагдац — худалдан авах боломжгүй">
                  Худалдаж авах
                </Button>
              </span>
            </MaterialCard>
          </li>
        ))}
      </ul>

      {previewing ? (
        <PreviewDialog material={previewing} onClose={() => setPreviewing(null)} />
      ) : null}
    </section>
  );
}

function Store({ onOwned }: { onOwned: () => void }) {
  const [filters, setFilters] = useState<MaterialFilters>(NO_FILTERS);
  const { area, level } = filters;
  const q = useDebounced(filters.q.trim());
  const [buying, setBuying] = useState<Material | null>(null);
  const [previewing, setPreviewing] = useState<Material | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const params = new URLSearchParams({ page: "1", pageSize: "50" });
  if (q) params.set("q", q);
  if (area) params.set("area", area);
  if (level) params.set("level", level);
  const catalog = useQuery({
    queryKey: ["materials", "catalog", q, area, level],
    queryFn: () => get(`/materials?${params}`, materialListSchema),
    retry: false,
  });
  // ★ No sample catalog on a 404 any more (2026-10-11): the API answers, so a
  // 404 means the route is not this person's — the error is shown as it is.
  const buy = (material: Material) => setBuying(material);
  const items = catalog.data?.items ?? [];

  return (
    <section aria-label="Дэлгүүр" className="flex flex-col gap-3">
      <MaterialsToolbar filters={filters} onChange={setFilters} />

      {catalog.isLoading ? <LoadingState rows={4} shape="cards" /> : null}
      {catalog.isError ? <ErrorState description={errorMessage(catalog.error)} /> : null}
      {!catalog.isLoading && items.length === 0 && catalog.data ? (
        <EmptyState
          title="Хэрэглэгдэхүүн олдсонгүй"
          description="Өөр үгээр хайх эсвэл шүүлтүүрээ өөрчилж үзээрэй."
        />
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((material) => (
          <li key={material.id}>
            <MaterialCard material={material}>
              <span className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setPreviewing(material)}>
                  Урьдчилан харах
                </Button>
                {material.owned ? (
                  <Button size="sm" variant="secondary" onClick={onOwned}>
                    Миний санд
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => buy(material)}>
                    Худалдаж авах
                  </Button>
                )}
              </span>
            </MaterialCard>
          </li>
        ))}
      </ul>

      {previewing ? (
        <PreviewDialog
          material={previewing}
          onClose={() => setPreviewing(null)}
          onBuy={
            previewing.owned
              ? undefined
              : () => {
                  const chosen = previewing;
                  setPreviewing(null);
                  buy(chosen);
                }
          }
        />
      ) : null}

      {buying ? (
        <BuyDialog
          material={buying}
          onClose={() => setBuying(null)}
          onPaid={() => {
            toast.success(`«${buying.title}» таны санд нэмэгдлээ.`);
            void queryClient.invalidateQueries({ queryKey: ["materials"] });
          }}
        />
      ) : null}
    </section>
  );
}

function Mine() {
  const [filters, setFilters] = useState<MaterialFilters>(NO_FILTERS);
  const owned = useQuery({
    queryKey: ["materials", "mine"],
    queryFn: () => get("/me/materials", ownedMaterialsSchema),
    retry: false,
  });
  const notReady = owned.isError && isNotFound(owned.error);
  const all = owned.data ?? [];
  // A teacher's own shelf is small: filtered here, not asked of the server.
  const items = all.filter((m) => matches(m, filters));

  return (
    <section aria-label="Миний сан" className="flex flex-col gap-3">
      {all.length > 0 ? <MaterialsToolbar filters={filters} onChange={setFilters} /> : null}
      {owned.isLoading ? <LoadingState rows={3} /> : null}
      {owned.isError && !notReady ? <ErrorState description={errorMessage(owned.error)} /> : null}
      {all.length > 0 && items.length === 0 ? (
        <EmptyState
          title="Тохирох хэрэглэгдэхүүн алга"
          description="Өөр үгээр хайх эсвэл шүүлтүүрээ өөрчилж үзээрэй."
        />
      ) : null}
      {notReady || (owned.data && all.length === 0) ? (
        <EmptyState
          title="Худалдаж авсан хэрэглэгдэхүүн алга"
          description="«Дэлгүүр»-ээс сонгоод худалдаж авбал энд нэмэгдэж, шууд татаж ашиглана."
        />
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((material) => (
          <li key={material.id}>
            <MaterialCard material={material} showPrice={false}>
              {/* A navigation, not a fetch: the server checks ownership and
                  redirects to a 5-minute presigned URL (`lib/materials.ts`). */}
              <Button asChild size="sm">
                <a href={downloadUrl(`/materials/${material.id}/download`)}>
                  <Download size={16} aria-hidden="true" /> Татах
                </a>
              </Button>
            </MaterialCard>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MaterialCard({
  material,
  showPrice = true,
  children,
}: {
  material: Material;
  showPrice?: boolean;
  children: React.ReactNode;
}) {
  const FileIcon = material.fileType === "PPT" ? Presentation : FileText;
  const cover = material.previewUrl ?? material.previewUrls[0] ?? null;
  const picture = cover ?? AREA_IMAGE[material.area] ?? null;
  return (
    <article
      aria-label={material.title}
      className="flex h-full flex-col gap-2 rounded-card border border-border-soft bg-surface p-3"
    >
      <div className="grid aspect-[16/9] place-items-center overflow-hidden rounded-row bg-canvas">
        {picture ? (
          <Image
            src={picture}
            alt=""
            width={160}
            height={90}
            unoptimized={Boolean(cover)}
            className={cn(cover ? "size-full object-cover" : "h-20 w-auto object-contain")}
          />
        ) : (
          <FileIcon size={32} aria-hidden="true" className="text-muted" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-compact">
        <Badge tone="neutral">
          <FileIcon size={12} aria-hidden="true" /> {material.fileType}
        </Badge>
        <span className="text-muted">{material.area}</span>
        {material.level ? <span className="text-muted">· {material.level} түвшин</span> : null}
        {material.pages ? <span className="text-muted">· {material.pages} хуудас</span> : null}
      </div>
      <h3 className="text-body font-semibold leading-snug text-ink">{material.title}</h3>
      {material.description ? (
        <p className="line-clamp-2 text-caption text-muted">{material.description}</p>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {showPrice ? (
          <span className="text-lead font-bold tabular-nums text-ink">
            {materialPrice(material.price)}
          </span>
        ) : (
          <span />
        )}
        {children}
      </div>
    </article>
  );
}

/**
 * The purchase — QPay's QR for one material, polled until it is paid, the
 * same steps and the same view as the access fee (`access-pay-dialog.tsx`).
 */
function BuyDialog({
  material,
  onClose,
  onPaid,
}: {
  material: Material;
  onClose: () => void;
  onPaid: () => void;
}) {
  const key = ["materials", material.id, "qpay"] as const;
  const queryClient = useQueryClient();
  const [started, setStarted] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      mutate(`/materials/${material.id}/qpay`, qpayInvoiceAttemptSchema, {
        method: "POST",
        body: {},
      }),
    onSuccess: (attempt) => {
      queryClient.setQueryData(key, attempt);
      setStarted(true);
    },
  });

  const { data: attempt } = useQuery({
    queryKey: key,
    queryFn: () => get(`/materials/${material.id}/qpay`, qpayInvoiceAttemptSchema),
    enabled: started,
    refetchInterval: (query) => (query.state.data?.status === "PENDING" ? 3000 : false),
  });

  const createOnce = useRef(false);
  useEffect(() => {
    if (createOnce.current) return;
    createOnce.current = true;
    create.mutate();
  }, [create]);

  const paidOnce = useRef(false);
  useEffect(() => {
    if (attempt?.status === "PAID" && !paidOnce.current) {
      paidOnce.current = true;
      onPaid();
    }
  }, [attempt, onPaid]);

  return (
    <Dialog.Root open onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-surface p-5 shadow-lg"
          aria-describedby="material-qpay-description"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-lead font-semibold text-ink">
                {material.title}
              </Dialog.Title>
              <Dialog.Description
                id="material-qpay-description"
                className="mt-1 text-body text-muted"
              >
                QR кодыг банкны аппаараа уншуулж төлнө үү.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Хаах">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>

          <FormError message={create.isError ? errorMessage(create.error) : null} />
          {create.isError ? null : (
            <QpayProgress
              attempt={attempt}
              pending={create.isPending}
              onRetry={() => create.mutate()}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * «Урьдчилан харах» — sample pages to page through, what is inside, and the
 * price, before a teacher buys (client, 2026-10-09). Pictures only: the file
 * itself is never sent before it is paid for (`lib/materials.ts`). The mark
 * across each page says what it is; a watermark baked in is the server's job.
 */
function PreviewDialog({
  material,
  onClose,
  onBuy,
}: {
  material: Material;
  onClose: () => void;
  /** Absent when the teacher already owns it. */
  onBuy?: () => void;
}) {
  const pages = material.previewUrls;
  const [index, setIndex] = useState(0);
  const page = pages[index];

  return (
    <Dialog.Root open onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-card border border-border bg-surface p-5 shadow-lg"
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-lead font-semibold text-ink">
              {material.title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Хаах">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>

          <figure className="flex flex-col gap-2">
            <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-row bg-canvas">
              {page ? (
                // A served preview picture, as `media-image.tsx` draws remote media.
                <img
                  src={page}
                  alt={`${material.title} — жишээ хуудас ${index + 1}`}
                  className="size-full object-contain"
                />
              ) : (
                <span className="flex flex-col items-center gap-2 px-6 text-center">
                  {AREA_IMAGE[material.area] ? (
                    <Image
                      src={AREA_IMAGE[material.area]!}
                      alt=""
                      width={96}
                      height={96}
                      className="size-24 object-contain"
                    />
                  ) : null}
                  <span className="text-caption text-muted">Жишээ хуудас удахгүй нэмэгдэнэ.</span>
                </span>
              )}
              {page ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 grid select-none place-items-center text-title font-bold text-ink/10 [transform:rotate(-24deg)]"
                >
                  NomadKids — жишээ
                </span>
              ) : null}
            </div>
            {pages.length > 1 ? (
              <figcaption className="flex items-center justify-center gap-3">
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label="Өмнөх хуудас"
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </Button>
                <span className="text-caption tabular-nums text-muted">
                  {index + 1} / {pages.length}
                </span>
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label="Дараагийн хуудас"
                  disabled={index === pages.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </Button>
              </figcaption>
            ) : null}
          </figure>

          <p className="text-caption text-muted">
            {material.fileType} · {material.area}
            {material.level ? ` · ${material.level} түвшин` : ""}
            {material.pages ? ` · ${material.pages} хуудас` : ""}
          </p>
          {material.description ? (
            <p className="text-body text-ink">{material.description}</p>
          ) : null}
          {material.contents.length > 0 ? (
            <section aria-label="Агуулга">
              <h3 className="mb-1 text-caption font-semibold text-ink">Агуулга</h3>
              <ol className="list-decimal pl-5 text-body text-ink">
                {material.contents.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </section>
          ) : null}

          <div className="mt-1 flex items-center justify-between gap-2 border-t border-border-soft pt-3">
            <span className="text-lead font-bold tabular-nums text-ink">
              {materialPrice(material.price)}
            </span>
            {onBuy ? (
              <Button onClick={onBuy}>Худалдаж авах</Button>
            ) : (
              <Badge tone="mint">Миний санд байгаа</Badge>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
