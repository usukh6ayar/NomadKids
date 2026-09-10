"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import { observationSchema, type ChildDetail } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { SharedMomentsTeaser } from "@/components/child/child-observations";
import { GradientUnderline } from "@/components/child/portfolio-hero";
import {
  ACCEPTED_TYPES,
  MAX_UPLOAD_BYTES,
  uploadChildPhotos,
} from "@/components/media/photo-upload";
import { Art } from "@/components/ui/art";
import type { GradientTone } from "@/lib/gradient-tones";
import type { Tone } from "@/components/ui/tone";
import { todayLocal } from "@/lib/format";

/**
 * The three growth-note sections — client reference screenshot, 2026-08-30.
 *
 * All three submit through the parent's endpoint with a persisted type code,
 * so the same distinction powers the category filters below.
 */
const BUCKETS = [
  {
    key: "observation",
    label: "Ажиглалт",
    verb: "Ажиглалт нэмэх",
    tone: "green" as GradientTone,
    art: "observation" as const,
  },
  {
    key: "conversation",
    label: "Ярилцлага",
    verb: "Ярилцлага нэмэх",
    tone: "blue" as GradientTone,
    art: "conversation" as const,
  },
  {
    key: "artwork",
    label: "Бүтээл",
    verb: "Бүтээл нэмэх",
    tone: "orange" as GradientTone,
    art: "artwork" as const,
  },
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

const CATEGORY_CODE: Record<BucketKey, "daily" | "conversation" | "artwork"> = {
  observation: "daily",
  conversation: "conversation",
  artwork: "artwork",
};

/** The closest match in `Card`'s own tone vocabulary — it has no green/blue/orange as such. */
const CARD_TONE_FOR_BUCKET: Record<GradientTone, Tone> = {
  green: "mint",
  blue: "sky",
  orange: "peach",
  purple: "cornflower",
  pink: "peach",
};

/**
 * The parent's "Хөгжил" page — replaces the tabbed Насны онцлог / Ажиглалт /
 * Бүтээл view for guardians only (`growth/page.tsx` still shows that
 * unchanged to staff, who still fill in the age-2–5 profile fields RFP §4.3
 * requires). A parent's job here is narrower: share what happened, and see
 * what the teacher has shared back.
 *
 * ★ `ChildMilestones` ("Онцгой үйл явдал") and the assessments-based
 * "Хүүхдийн тэмдэглэлүүд" both came off this page on 2026-09-04, on the
 * client's instruction. `SharedMomentsTeaser` (`child-observations.tsx`)
 * replaces the latter — the client's own description of what should sit
 * here, "багшийн зурагтай коммент, багшийн бичсэн, эцэг эхийн бичсэн нь
 * улирлаараа", is closer to a photo-grouped-by-quarter view over
 * `Observation` than it ever was to the assessment scores the old teaser
 * actually showed. Milestones has no replacement UI anywhere in the app as
 * of this change — the data and its PDF export are untouched, only every
 * screen that could create or edit one is gone; a future pass gets to decide
 * where it resurfaces rather than this one guessing.
 */
export function ParentGrowthLauncher({ child }: { child: ChildDetail }) {
  const [activeBucket, setActiveBucket] = useState<BucketKey>("observation");
  const [composerOpen, setComposerOpen] = useState(false);
  const bucket = BUCKETS.find((item) => item.key === activeBucket)!;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        title="Хүүхдийн явцын үнэлгээ"
        lede="Хүүхдийн хөгжилд гарч буй ахиц дэвшлийг багш, эцэг эх хамтран тэмдэглэнэ"
        className="mb-0"
      />

      <div className="grid grid-cols-3 gap-2.5">
        {BUCKETS.map((bucket) => (
          <CategoryBar
            key={bucket.key}
            bucket={bucket}
            active={activeBucket === bucket.key}
            onClick={() => {
              setActiveBucket(bucket.key);
              setComposerOpen(false);
            }}
          />
        ))}
      </div>

      <SharedMomentsTeaser
        childId={child.id}
        categoryCode={CATEGORY_CODE[activeBucket]}
        title={bucket.label}
        onAdd={() => setComposerOpen(true)}
        composer={
          composerOpen ? (
            <QuickShareForm
              childId={child.id}
              bucket={bucket}
              onClose={() => setComposerOpen(false)}
            />
          ) : null
        }
      />
    </div>
  );
}

function CategoryBar({
  bucket,
  active,
  onClick,
}: {
  bucket: (typeof BUCKETS)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "primary" : "secondary"}
      size="md"
      block
      aria-expanded={active}
      onClick={onClick}
      className="justify-start px-3"
    >
      <Art name={bucket.art} size={32} className="size-8 shrink-0 object-contain" />
      <span className="min-w-0 flex-1 truncate">{bucket.label}</span>
    </Button>
  );
}

/** One save creates the note first, then attaches every pre-selected photo. */
function QuickShareForm({
  childId,
  bucket,
  onClose,
}: {
  childId: string;
  bucket: (typeof BUCKETS)[number];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [observedOn, setObservedOn] = useState(todayLocal());
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: async () => {
      const situation = [title.trim(), content.trim()].filter(Boolean).join("\n\n") || undefined;
      const observation = await mutate(
        `/children/${childId}/parent-observations`,
        observationSchema,
        {
          method: "POST",
          body: { observedOn, situation, categoryCode: CATEGORY_CODE[bucket.key] },
        },
      );

      let photoWarning: string | null = null;
      if (files.length > 0) {
        try {
          const uploaded = await uploadChildPhotos({
            childId,
            files,
            observationId: observation.id,
            purpose: "OBSERVATION",
          });
          if (uploaded.failed.length > 0) {
            photoWarning = uploaded.failed.map((file) => `${file.name}: ${file.reason}`).join("; ");
          }
        } catch (error) {
          // The note already exists at this point. Return it instead of making
          // a second press create a duplicate; the warning names the photo step.
          photoWarning = errorMessage(error);
        }
      }

      return { observation, photoWarning };
    },
    onSuccess: async ({ photoWarning }) => {
      await queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      toast.success("Тэмдэглэл хадгалагдлаа.");
      if (photoWarning) toast.error(`Тэмдэглэл хадгалагдсан ч зураг орсонгүй: ${photoWarning}`);
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  return (
    <Card pad="roomy" tone={CARD_TONE_FOR_BUCKET[bucket.tone]}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lead font-semibold text-ink">{bucket.verb}</h2>
          <GradientUnderline className="mt-1" />
          <p className="mt-2 text-body text-muted">Аав, ээжийн ажигласан мөчийг тэмдэглээрэй.</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Хаах" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </Button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending) save.mutate();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <FormError
          message={
            save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
          }
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Огноо" error={errors.observedOn} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="date"
                value={observedOn}
                max={todayLocal()}
                onChange={(e) => setObservedOn(e.target.value)}
                required
              />
            )}
          </Field>

          <Field label="Улирал">
            {({ id }) => (
              <Select
                id={id}
                value={String(termNumberForDate(observedOn))}
                onChange={(event) => {
                  setObservedOn(
                    firstAvailableDateForTerm(Number(event.target.value), todayLocal()),
                  );
                }}
              >
                {[1, 2, 3].map((number) => (
                  <option
                    key={number}
                    value={number}
                    disabled={firstDateForTerm(number, todayLocal()) > todayLocal()}
                  >
                    {number}-р улирал
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Гарчиг">
            {({ id }) => (
              <Input
                id={id}
                value={title}
                placeholder="Жишээ: Өнөөдрийн хөөрхөн мөч"
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Агуулга" error={errors.situation}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={content}
              placeholder="Юу хийсэн, ямар шинэ зүйл ажиглагдсан бэ?"
              onChange={(e) => setContent(e.target.value)}
            />
          )}
        </Field>

        <div>
          <span className="mb-1.5 block text-body font-medium text-ink">Зураг / баримт</span>
          <FormError message={fileError} />
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            className="sr-only"
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              const tooBig = selected.filter((file) => file.size > MAX_UPLOAD_BYTES);
              setFileError(
                tooBig.length > 0
                  ? `${tooBig.map((file) => file.name).join(", ")} хэт том байна.`
                  : null,
              );
              setFiles((current) => [
                ...current,
                ...selected.filter((file) => file.size <= MAX_UPLOAD_BYTES),
              ]);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2 rounded-control border border-dashed border-border bg-canvas p-3">
            <Button asChild variant="secondary" disabled={save.isPending}>
              <label htmlFor={inputId} className="cursor-pointer">
                <ImagePlus size={18} aria-hidden="true" />
                Зураг сонгох
              </label>
            </Button>
            <span className="text-caption text-muted">
              {files.length > 0 ? `${files.length} зураг сонгосон` : "JPEG, PNG эсвэл WebP"}
            </span>
          </div>
          {files.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${file.lastModified}-${index}`}
                  className="flex items-center gap-2 text-caption text-ink"
                >
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${file.name} зургийг хасах`}
                    onClick={() =>
                      setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Болих
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Academic-year quarters: Sep–Dec, Jan–Mar, Apr–Aug. */
export function termNumberForDate(day: string): 1 | 2 | 3 {
  const month = Number(day.slice(5, 7));
  if (month >= 9) return 1;
  if (month <= 3) return 2;
  return 3;
}

function firstDateForTerm(term: number, today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const schoolYearStart = month >= 9 ? year : year - 1;
  if (term === 1) return `${schoolYearStart}-09-01`;
  if (term === 2) return `${schoolYearStart + 1}-01-01`;
  return `${schoolYearStart + 1}-04-01`;
}

function firstAvailableDateForTerm(term: number, today: string): string {
  const first = firstDateForTerm(term, today);
  return first > today ? today : first;
}
