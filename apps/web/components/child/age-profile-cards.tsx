"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, ChevronRight, MoreVertical, Pencil, X } from "lucide-react";
import {
  ageProfileSchema,
  mediaSchema,
  type AgeProfile,
  type FamilyMemory,
  type Media,
} from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { Art, type ArtName } from "@/components/ui/art";
import {
  CHARACTER_TRAITS,
  FAVORITE_FIELDS,
  ageSectionCompletion,
  familyLearningCategories,
  kindergartenSkillCategories,
  type PortfolioAge,
} from "@/lib/age-development";
import {
  FamilyMemberSelector,
  MemoryList,
  MemoryPhotoPicker,
  MemoryPreview,
  draftFrom,
  emptyDraft,
  type MemoryDraft,
} from "@/components/child/family-memories";
import { todayLocal } from "@/lib/format";
import type { GradientTone } from "@/lib/gradient-tones";
import { cn } from "@/lib/utils";

type Profile = AgeProfile | undefined;
type PatchBody = Record<string, string | null | string[] | Record<string, string> | FamilyMemory[]>;

const CARD_FOR_TONE: Record<GradientTone, string> = {
  green: "border-[#deefe3] bg-[linear-gradient(135deg,#fbfffc_0%,#effaf1_100%)]",
  blue: "border-[#dfeef8] bg-[linear-gradient(135deg,#fbfeff_0%,#eef8ff_100%)]",
  orange: "border-[#f4ead1] bg-[linear-gradient(135deg,#fffef9_0%,#fff7de_100%)]",
  purple: "border-[#e8e4f8] bg-[linear-gradient(135deg,#fdfcff_0%,#f3f0ff_100%)]",
  pink: "border-[#f8e4e3] bg-[linear-gradient(135deg,#fffafa_0%,#fff0ef_100%)]",
};

/**
 * Each card sends only its own columns. The API's partial upsert leaves all
 * other sections untouched, while a failed request keeps the draft open.
 */
function useAgeProfileSave(childId: string, age: PortfolioAge, onSaved: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (body: PatchBody) =>
      mutate(`/children/${childId}/age-profiles/${age}`, ageProfileSchema, {
        method: "PATCH",
        body,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData<AgeProfile[]>(qk.ageProfiles(childId), (current = []) => {
        const existing = current.find((item) => item.age === age);
        const next = { ...existing, ...saved };
        return existing
          ? current.map((item) => (item.age === age ? next : item))
          : [...current, next].sort((a, b) => a.age - b.age);
      });
      toast.success(`${age} насны мэдээлэл хадгалагдлаа.`);
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** Compact index card: details open on the card and editing starts from ⋮. */
function ProfileCard({
  title,
  tone,
  hasContent,
  emptyPrompt,
  onEdit,
  art,
  wide = false,
  children,
}: {
  title: string;
  tone: GradientTone;
  hasContent: boolean;
  emptyPrompt: string;
  onEdit: () => void;
  art: ArtName;
  wide?: boolean;
  children: ReactNode;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <Dialog.Root open={detailsOpen} onOpenChange={setDetailsOpen}>
      <Card
        className={cn(
          "relative h-full min-h-[132px] overflow-visible border transition-shadow hover:shadow-md",
          CARD_FOR_TONE[tone],
          wide && "min-h-[124px]",
        )}
        data-testid={`age-profile-card-${art}`}
      >
        <div className="flex h-full min-h-[inherit] items-stretch p-2 sm:p-3">
          <button
            type="button"
            aria-label={`${title} ${hasContent ? "дэлгэрэнгүй" : "тэмдэглэх"}`}
            className={cn(
              "card-interactive relative grid min-w-0 flex-1 cursor-pointer grid-cols-[56px_minmax(0,1fr)] items-center gap-2 rounded-row p-1.5 pr-7 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:grid-cols-[72px_minmax(0,1fr)] sm:gap-3 sm:p-2 sm:pr-9",
              wide && "grid-cols-[92px_minmax(0,1fr)] sm:grid-cols-[124px_minmax(0,1fr)]",
            )}
            onClick={() => (hasContent ? setDetailsOpen(true) : onEdit())}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-14 shrink-0 place-items-center sm:size-[72px]",
                wide && "h-24 w-[92px] sm:h-28 sm:w-[124px]",
              )}
            >
              <Art
                name={art}
                size={wide ? 132 : 80}
                className={cn(
                  "size-16 max-w-none object-contain sm:size-20",
                  wide && "h-24 w-[108px] sm:h-32 sm:w-36",
                )}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span
                role="heading"
                aria-level={3}
                className="block text-caption font-bold leading-snug text-ink sm:text-body"
              >
                {title}
              </span>
              <span className="sr-only">{hasContent ? "Мэдээлэл бүртгэгдсэн" : emptyPrompt}</span>
            </span>
            <span className="absolute bottom-1.5 right-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-pill bg-white/75 text-primary shadow-sm sm:bottom-2 sm:right-2 sm:size-8">
              <ChevronRight size={18} aria-hidden="true" />
            </span>
          </button>
          <div className="absolute right-1 top-1 z-10 scale-75 sm:right-1.5 sm:top-1.5 sm:scale-90">
            <RowMenu
              ariaLabel={`${title} үйлдэл`}
              triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
              items={[{ label: "Засах", icon: <Pencil size={16} />, onSelect: onEdit }]}
            />
          </div>
        </div>
      </Card>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          aria-label={`${title} мэдээлэл`}
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[620px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-card border border-border bg-surface p-5 shadow-lg md:p-6"
        >
          <div className="mb-5 flex items-start justify-between gap-3">
            <Dialog.Title className="text-lead font-semibold text-ink">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Хаах">
                <X size={18} aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          {hasContent ? children : <p className="text-body text-muted">{emptyPrompt}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DialogActions({
  formId,
  busy,
  onCancel,
}: {
  formId: string;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onCancel}>
        Болих
      </Button>
      <Button type="submit" form={formId} size="sm" disabled={busy}>
        {busy ? "Хадгалж байна…" : "Хадгалах"}
      </Button>
    </>
  );
}

function ValuesList({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-row bg-sunken px-3 py-2.5">
          <dt className="text-caption text-muted">{row.label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-body text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FavoritesCard({
  childId,
  age,
  profile,
}: {
  childId: string;
  age: PortfolioAge;
  profile: Profile;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const reset = useCallback(() => {
    setForm(Object.fromEntries(FAVORITE_FIELDS.map(({ key }) => [key, profile?.[key] ?? ""])));
  }, [profile]);
  useEffect(reset, [reset]);

  const close = () => {
    setOpen(false);
    reset();
  };
  const save = useAgeProfileSave(childId, age, close);
  const errors = fieldErrors(save.error);
  const rows = FAVORITE_FIELDS.flatMap(({ key, label }) => {
    const value = profile?.[key]?.trim();
    return value ? [{ label, value }] : [];
  });
  const formId = `favorites-${age}-form`;

  return (
    <>
      <ProfileCard
        title="Миний дуртай бүх зүйлс"
        tone="pink"
        hasContent={rows.length > 0}
        emptyPrompt={`${age} насандаа хамгийн дуртай ямар тоглоомтой байсан бэ?`}
        art="ageFavorite"
        onEdit={() => {
          reset();
          setOpen(true);
        }}
      >
        <ValuesList rows={rows} />
      </ProfileCard>
      <FormDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        busy={save.isPending}
        title="Миний дуртай бүх зүйлс"
        description={`${age} насны дуртай зүйлсээ хүссэнээрээ бөглөнө үү.`}
        footer={<DialogActions formId={formId} busy={save.isPending} onCancel={close} />}
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (save.isPending) return;
            save.mutate(
              Object.fromEntries(
                FAVORITE_FIELDS.map(({ key }) => [key, form[key]?.trim() || null]),
              ),
            );
          }}
        >
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          <div className="grid gap-4 sm:grid-cols-2">
            {FAVORITE_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label} error={errors[key]}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={form[key] ?? ""}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                )}
              </Field>
            ))}
          </div>
        </form>
      </FormDialog>
    </>
  );
}

type SkillCategory = { id: string; label: string; options: string[] };

function SkillsSectionCard({
  childId,
  age,
  profile,
  title,
  emptyPrompt,
  categories,
  selectedKey,
  notesKey,
  otherKey,
  legacyKey,
  disclaimer,
  art,
  tone,
}: {
  childId: string;
  age: PortfolioAge;
  profile: Profile;
  title: string;
  emptyPrompt: string;
  categories: SkillCategory[];
  selectedKey: "kindergartenSkills" | "familyLearningSkills";
  notesKey: "kindergartenSkillNotes" | "familyLearningNotes";
  otherKey: "kindergartenOtherSkill" | "familyLearningOther";
  legacyKey: "newSkills" | "familyMembers";
  disclaimer?: string;
  art: ArtName;
  tone: GradientTone;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [other, setOther] = useState("");
  const reset = useCallback(() => {
    setSelected(profile?.[selectedKey] ?? []);
    setNotes(profile?.[notesKey] ?? {});
    setOther(profile?.[otherKey] ?? profile?.[legacyKey] ?? "");
  }, [legacyKey, notesKey, otherKey, profile, selectedKey]);
  useEffect(reset, [reset]);

  const close = () => {
    setOpen(false);
    reset();
  };
  const save = useAgeProfileSave(childId, age, close);
  const errors = fieldErrors(save.error);
  const storedSelected = profile?.[selectedKey] ?? [];
  const storedNotes = profile?.[notesKey] ?? {};
  const storedOther = profile?.[otherKey] ?? profile?.[legacyKey] ?? "";
  const rows = [
    ...(storedSelected.length
      ? [{ label: "Сонгосон чадвар", value: storedSelected.join(", ") }]
      : []),
    ...categories.flatMap((category) => {
      const value = storedNotes[category.id]?.trim();
      return value ? [{ label: `${category.label} — Нэмэлт тайлбар`, value }] : [];
    }),
    ...(storedOther.trim() ? [{ label: "Өөр сурсан зүйл", value: storedOther }] : []),
  ];
  const formId = `${selectedKey}-${age}-form`;

  return (
    <>
      <ProfileCard
        title={title}
        tone={tone}
        hasContent={rows.length > 0}
        emptyPrompt={emptyPrompt}
        art={art}
        onEdit={() => {
          reset();
          setOpen(true);
        }}
      >
        <ValuesList rows={rows} />
        {disclaimer ? (
          <p className="mt-4 text-caption leading-relaxed text-muted">{disclaimer}</p>
        ) : null}
      </ProfileCard>
      <FormDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        busy={save.isPending}
        title={title}
        description={`${age} насны ажиглалтыг олон сонголтоор тэмдэглэнэ үү.`}
        footer={<DialogActions formId={formId} busy={save.isPending} onCancel={close} />}
      >
        <form
          id={formId}
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (save.isPending) return;
            save.mutate({
              [selectedKey]: selected,
              [notesKey]: Object.fromEntries(
                Object.entries(notes)
                  .map(([key, value]) => [key, value.trim()])
                  .filter(([, value]) => value),
              ),
              [otherKey]: other.trim() || null,
            });
          }}
        >
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          {categories.map((category) => (
            <fieldset key={category.id} className="rounded-row border border-border p-3.5">
              <legend className="px-1 text-body font-semibold text-ink">{category.label}</legend>
              <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
                {category.options.map((option) => (
                  <Checkbox
                    key={option}
                    label={option}
                    checked={selected.includes(option)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(option)
                          ? current.filter((item) => item !== option)
                          : [...current, option],
                      )
                    }
                  />
                ))}
              </div>
              <Field label="Нэмэлт тайлбар" className="mt-3" error={errors[notesKey]}>
                {({ id, describedBy, invalid }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={notes[category.id] ?? ""}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [category.id]: event.target.value }))
                    }
                  />
                )}
              </Field>
            </fieldset>
          ))}
          <Field label="Өөр сурсан зүйл нэмэх" error={errors[otherKey]}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={other}
                onChange={(event) => setOther(event.target.value)}
              />
            )}
          </Field>
          {disclaimer ? (
            <p className="rounded-row bg-primary-soft px-3.5 py-3 text-caption leading-relaxed text-muted">
              {disclaimer}
            </p>
          ) : null}
        </form>
      </FormDialog>
    </>
  );
}

const OBSERVATION_DISCLAIMER =
  "Эдгээр нь ажиглалтаа тэмдэглэх сонголтууд бөгөөд хүүхэд бүр заавал эзэмшсэн байх үнэлгээний стандарт биш. Сонгоогүй чадварыг хоцрогдол гэж үнэлэхгүй.";

export function KindergartenSkillsCard({
  childId,
  age,
  profile,
}: {
  childId: string;
  age: PortfolioAge;
  profile: Profile;
}) {
  return (
    <SkillsSectionCard
      childId={childId}
      age={age}
      profile={profile}
      title="Миний цэцэрлэгтээ сурсан зүйлс"
      emptyPrompt={`${age} насандаа цэцэрлэгтээ ямар шинэ зүйл сурсан бэ?`}
      categories={kindergartenSkillCategories(age)}
      selectedKey="kindergartenSkills"
      notesKey="kindergartenSkillNotes"
      otherKey="kindergartenOtherSkill"
      legacyKey="newSkills"
      disclaimer={OBSERVATION_DISCLAIMER}
      art="ageKindergartenLearning"
      tone="green"
    />
  );
}

export function FamilyLearningCard({
  childId,
  age,
  profile,
}: {
  childId: string;
  age: PortfolioAge;
  profile: Profile;
}) {
  return (
    <SkillsSectionCard
      childId={childId}
      age={age}
      profile={profile}
      title="Миний гэр бүлээсээ суралцсан зүйлс"
      emptyPrompt={`${age} насандаа гэр бүлээсээ юу сурсан бэ?`}
      categories={familyLearningCategories(age)}
      selectedKey="familyLearningSkills"
      notesKey="familyLearningNotes"
      otherKey="familyLearningOther"
      legacyKey="familyMembers"
      art="ageFamilyLearning"
      tone="purple"
    />
  );
}

export function CharacterCard({
  childId,
  age,
  profile,
}: {
  childId: string;
  age: PortfolioAge;
  profile: Profile;
}) {
  const [open, setOpen] = useState(false);
  const [traits, setTraits] = useState<string[]>([]);
  const [observation, setObservation] = useState("");
  const reset = useCallback(() => {
    setTraits(profile?.characterTraits ?? []);
    setObservation(
      profile?.characterObservation ??
        [profile?.personality, profile?.emotionalTraits].filter(Boolean).join("\n"),
    );
  }, [profile]);
  useEffect(reset, [reset]);

  const close = () => {
    setOpen(false);
    reset();
  };
  const save = useAgeProfileSave(childId, age, close);
  const errors = fieldErrors(save.error);
  const storedObservation =
    profile?.characterObservation ??
    [profile?.personality, profile?.emotionalTraits].filter(Boolean).join("\n");
  const rows = [
    ...(profile?.characterTraits.length
      ? [{ label: "Сонгосон ажиглалт", value: profile.characterTraits.join(", ") }]
      : []),
    ...(storedObservation.trim()
      ? [{ label: `Миний ${age} насны зан араншин`, value: storedObservation }]
      : []),
  ];
  const formId = `character-${age}-form`;

  return (
    <>
      <ProfileCard
        title="Миний зан араншин"
        tone="blue"
        hasContent={rows.length > 0}
        emptyPrompt={`${age} насныхаа зан араншинг ажиглан тэмдэглээрэй.`}
        art="ageCharacter"
        onEdit={() => {
          reset();
          setOpen(true);
        }}
      >
        <ValuesList rows={rows} />
        <p className="mt-4 text-caption leading-relaxed text-muted">
          Сонголтууд нь тухайн үеийн эцэг эхийн ажиглалт бөгөөд оноо, онош эсвэл хүүхдийн тогтмол
          шошго биш.
        </p>
      </ProfileCard>
      <FormDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        busy={save.isPending}
        title="Миний зан араншин"
        description="Тухайн үеийн ажиглалтаас хэд хэдийг сонгож болно."
        footer={<DialogActions formId={formId} busy={save.isPending} onCancel={close} />}
      >
        <form
          id={formId}
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending) {
              save.mutate({
                characterTraits: traits,
                characterObservation: observation.trim() || null,
              });
            }
          }}
        >
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          <fieldset>
            <legend className="text-body font-semibold text-ink">Зан араншингийн ажиглалт</legend>
            <div className="mt-2 grid gap-x-4 sm:grid-cols-2">
              {CHARACTER_TRAITS.map((trait) => (
                <Checkbox
                  key={trait}
                  label={trait}
                  checked={traits.includes(trait)}
                  onChange={() =>
                    setTraits((current) =>
                      current.includes(trait)
                        ? current.filter((item) => item !== trait)
                        : [...current, trait],
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
          <Field label={`Миний ${age} насны зан араншин`} error={errors.characterObservation}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={observation}
                onChange={(event) => setObservation(event.target.value)}
              />
            )}
          </Field>
          <p className="rounded-row bg-primary-soft px-3.5 py-3 text-caption leading-relaxed text-muted">
            Энэ мэдээллийг оноо, онош эсвэл хүүхдийн тогтмол шошго болгон ашиглахгүй.
          </p>
        </form>
      </FormDialog>
    </>
  );
}

/** Bounds mirrored from `updateAgeProfileSchema` — a counter that lies is worse than none. */
const MEMORY_TITLE_MAX = 120;
const MEMORY_DESCRIPTION_MAX = 1000;

/** A live count under a bounded field. Turns amber near the ceiling, not at it. */
function CharCounter({ value, max }: { value: string; max: number }) {
  return (
    <p
      aria-hidden="true"
      className={cn(
        "text-right text-caption tabular-nums",
        value.length > max * 0.9 ? "text-peach-ink" : "text-muted",
      )}
    >
      {value.length}/{max}
    </p>
  );
}

/**
 * "Гэр бүл" — the family section, and the memory builder added 2026-09-10 at
 * the client's request.
 *
 * ★ The section is now a memory builder and nothing else — client, 2026-09-10,
 * in two steps: first the five-card member picker, then the "Хамтдаа хийх
 * дуртай зүйлс" box.
 *
 * Neither stored field was dropped, and neither is wiped:
 *
 *   · `familyMemberTypes` is **derived** from the memories — `derivedMembers`.
 *   · `familyDescription` is **omitted from the PATCH**. A partial upsert
 *     leaves an absent field alone, so whatever a parent wrote before the box
 *     was removed is still there, still rendered by the detail card, the age
 *     comparison and the keepsake card. It is deliberately *not* derived from
 *     the memories: "what this family likes doing together" is not the sum of
 *     four captions, and inventing it would be the mock-data problem this
 *     codebase refuses.
 *
 * Both are read-only remnants now. If the client wants them gone from the
 * read views too, that is a deletion of stored data and its own decision —
 * not something to infer from a request to remove a text box.
 *
 * ★★ What is new is `familyMemories`, empty until somebody fills it.
 *
 * ★★ A memory's photograph is an ordinary album row.
 *
 * `MemoryPhotoUpload` posts it to `POST /children/:id/media` with
 * `category=FAMILY` and this `age`, which is precisely what
 * `portfolio/gallery/:age` reads — so a picture added here appears in that
 * age's "Миний гэр бүл" album with no second write and no second model. The
 * memory stores the id and nothing else about the file.
 *
 * ★★★ Saving only ever *fills* a photograph's blanks — see `syncMemoryMedia`.
 *
 * A picture chosen from the archive may already be filed under "Аялал,
 * зугаалга" with a caption of its own, and quietly re-filing it under the
 * family album because it was reused in a memory would move a photograph the
 * parent never asked to move. An empty facet is filled; a set one is left
 * alone.
 */
export function FamilyCard({
  childId,
  age,
  profile,
}: {
  childId: string;
  age: PortfolioAge;
  profile: Profile;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [memories, setMemories] = useState<FamilyMemory[]>([]);
  const [draft, setDraft] = useState<MemoryDraft>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /**
   * The delete awaiting a "Тийм", and **where it was raised**.
   *
   * The list and the preview both draw a memory and both offer to remove it,
   * so an id alone put the same "Устгах уу? Тийм / Үгүй" strip in two places
   * at once. The confirmation belongs where the question was asked.
   */
  const [confirming, setConfirming] = useState<{ id: string; where: "list" | "preview" } | null>(
    null,
  );
  const [memoryErrors, setMemoryErrors] = useState<Record<string, string>>({});

  /**
   * What is known about each photograph's album facets.
   *
   * A ref, not state: nothing renders from it. It exists so the save can tell
   * "this photo has no age yet" from "this photo is already filed elsewhere",
   * and it is filled by the archive listing and by every upload.
   */
  const knownMedia = useRef(new Map<string, Media>());

  const reset = useCallback(() => {
    setMemories(profile?.familyMemories ?? []);
    setDraft(emptyDraft());
    setEditingId(null);
    setPreviewId(null);
    setConfirming(null);
    setMemoryErrors({});
  }, [profile]);
  useEffect(reset, [reset]);

  const close = () => {
    setOpen(false);
    reset();
  };
  const save = useAgeProfileSave(childId, age, close);
  const errors = fieldErrors(save.error);
  const formId = `family-${age}-form`;

  const storedMemories = profile?.familyMemories ?? [];
  const rows = [
    ...(profile?.familyMemberTypes.length
      ? [{ label: "Гэр бүлийн гишүүд", value: profile.familyMemberTypes.join(", ") }]
      : []),
    ...(profile?.familyDescription?.trim()
      ? [
          {
            label: "Хамтдаа хийх дуртай зүйлс",
            value: profile.familyDescription,
          },
        ]
      : []),
  ];

  /**
   * Stable across renders: `MemoryArchive` reports its listing from an effect,
   * and a new function identity every render would re-run that effect every
   * render.
   */
  const rememberMedia = useCallback((items: Media[]) => {
    for (const item of items) knownMedia.current.set(item.id, item);
  }, []);

  /**
   * Fills in the album facets a memory's photograph is still missing.
   *
   * Runs after the profile save, not before: the memory is the thing the
   * parent pressed "Хадгалах" for, and a failed `PATCH /media/:id` must not
   * take it down with it. Each photo is attempted independently and a failure
   * is swallowed — the picture is already in the album either way, since
   * `category` and `age` went in at upload time; this only adds the caption
   * and the date the memory now knows, and re-files an untagged archive photo.
   */
  const syncMemoryMedia = async (list: FamilyMemory[]) => {
    let touched = false;

    for (const memory of list) {
      const media = memory.mediaId ? knownMedia.current.get(memory.mediaId) : undefined;
      if (!media) continue;

      const patch: Record<string, string | number> = {};
      const title = memory.title.trim();
      if (title && !media.caption?.trim()) patch.caption = title.slice(0, 255);
      if (memory.date && !media.takenAt) patch.takenAt = memory.date;
      if (media.age === null || media.age === undefined) patch.age = age;
      if (!media.category) patch.category = "FAMILY";
      if (Object.keys(patch).length === 0) continue;

      const updated = await mutate(`/media/${media.id}`, mediaSchema, {
        method: "PATCH",
        body: patch,
      }).catch(() => null);
      if (updated) knownMedia.current.set(updated.id, updated);
      touched = true;
    }

    // `["child", id, "media"]` is a structural prefix of every filtered
    // gallery key *and* of `childAgeAlbum`, so one invalidation refreshes the
    // archive strip above and the age album this photo just joined.
    if (touched) void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
  };

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const draftHasContent = Boolean(
    draft.mediaId || draft.title.trim() || draft.description.trim() || draft.date,
  );
  const showingDraft = Boolean(editingId) || draftHasContent;
  const previewMemory = showingDraft
    ? draft
    : (memories.find((item) => item.id === previewId) ?? memories[0] ?? null);

  /**
   * Moves the draft into the list, or reports why it cannot.
   *
   * Returns the new list rather than only setting state, because the dialog's
   * own "Хадгалах" commits an unfinished draft first and needs the result in
   * the same tick — `memories` would still hold the previous value.
   */
  const commitDraft = (): FamilyMemory[] | null => {
    const title = draft.title.trim();
    const found: Record<string, string> = {};
    if (draft.members.length === 0) found.members = "Хэнтэй хамт байсныг сонгоно уу.";
    if (!title) found.title = "Дурсамжийн нэрийг бичнэ үү.";
    if (draft.date && draft.date > todayLocal()) found.date = "Огноо ирээдүйд байж болохгүй.";

    if (Object.keys(found).length > 0) {
      setMemoryErrors(found);
      return null;
    }

    const existing = memories.find((item) => item.id === draft.id);
    const stored: FamilyMemory = {
      id: draft.id,
      mediaId: draft.mediaId,
      members: draft.members,
      title,
      description: draft.description.trim() || null,
      date: draft.date || null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    const next = existing
      ? memories.map((item) => (item.id === stored.id ? stored : item))
      : [stored, ...memories];

    setMemories(next);
    setPreviewId(stored.id);
    setEditingId(null);
    setDraft(emptyDraft());
    setMemoryErrors({});
    return next;
  };

  const cancelDraft = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setMemoryErrors({});
  };

  const editMemory = (memory: FamilyMemory) => {
    setDraft(draftFrom(memory));
    setEditingId(memory.id);
    setPreviewId(memory.id);
    setConfirming(null);
    setMemoryErrors({});
  };

  const deleteMemory = (memory: FamilyMemory) => {
    setMemories((current) => current.filter((item) => item.id !== memory.id));
    setConfirming(null);
    if (previewId === memory.id) setPreviewId(null);
    if (editingId === memory.id) cancelDraft();
  };

  /**
   * "Гэр бүлийн гишүүд" — derived from the memories, not ticked a second time.
   *
   * ★ The section used to open with its own five-card picker, above the one
   * each memory carries. Two pickers for the same five strings in one dialog,
   * and the client asked for the upper one to go (2026-09-10). The stored
   * field stays — the detail card, the age comparison and the keepsake card
   * all read it — so it is now answered by the memories themselves: the people
   * a year's memories name *are* that year's family members.
   *
   * ★★ With no memories it returns what is already stored, rather than `[]`.
   *
   * Otherwise the first save of a description on a record filled in before
   * this change would silently wipe a parent's earlier selection — a field
   * losing its editor must not also lose its data.
   */
  const derivedMembers = (list: FamilyMemory[]): string[] => {
    const named = Array.from(new Set(list.flatMap((memory) => memory.members)));
    return named.length > 0 ? named : (profile?.familyMemberTypes ?? []);
  };

  const submit = () => {
    if (save.isPending) return;

    // An unfinished draft is the parent's work too. Committing it here is what
    // stops "Хадгалах" from silently throwing away a memory they had typed but
    // not yet added; if it does not validate, the save waits and says why.
    let list = memories;
    if (showingDraft) {
      const committed = commitDraft();
      if (!committed) return;
      list = committed;
    }

    save.mutate(
      {
        familyMemberTypes: derivedMembers(list),
        familyMemories: list,
      },
      { onSuccess: () => void syncMemoryMedia(list) },
    );
  };

  return (
    <>
      <ProfileCard
        title="Миний гэр бүл"
        tone="orange"
        hasContent={rows.length > 0 || storedMemories.length > 0}
        emptyPrompt="Гэр бүлийнхээ тухай нандин дурсамжаа тэмдэглээрэй."
        art="ageFamily"
        wide
        onEdit={() => {
          reset();
          setOpen(true);
        }}
      >
        <ValuesList rows={rows} />
        {storedMemories.length > 0 ? (
          <section aria-labelledby={`family-${age}-memories`} className="mt-4">
            <h3 id={`family-${age}-memories`} className="mb-2 text-body font-semibold text-ink">
              Гэр бүлийн дурсамж
            </h3>
            <MemoryList memories={storedMemories} />
          </section>
        ) : null}
      </ProfileCard>

      <FormDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        busy={save.isPending}
        size="wide"
        title="Миний гэр бүл"
        description={`${age} насны гэр бүлийн мэдээлэл.`}
        footer={<DialogActions formId={formId} busy={save.isPending} onCancel={close} />}
      >
        <form
          id={formId}
          className="flex min-w-0 flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormError message={save.isError ? errorMessage(save.error) : null} />

          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <section
                aria-labelledby={`${formId}-memory-heading`}
                className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-sunken p-3 md:p-4"
              >
                <div>
                  <h3
                    id={`${formId}-memory-heading`}
                    className="flex items-center gap-2 text-body font-semibold text-ink"
                  >
                    <Camera size={17} aria-hidden="true" className="text-primary" />
                    Гэр бүлийн дурсамж
                  </h3>
                  <p className="mt-1 text-caption leading-relaxed text-muted">
                    Нэмсэн зураг {age} насны цомгийн «Миний гэр бүл» хэсэгт бас орно.
                  </p>
                </div>

                <FormError message={errors.familyMemories ?? null} />

                <MemoryPhotoPicker
                  childId={childId}
                  age={age}
                  selectedMediaId={draft.mediaId}
                  onLoaded={rememberMedia}
                  onSelect={(media) => {
                    rememberMedia([media]);
                    setDraft((current) => ({
                      ...current,
                      mediaId: current.mediaId === media.id ? null : media.id,
                    }));
                  }}
                />

                <FamilyMemberSelector
                  legend="Хэнтэй хамт байсан бэ?"
                  compact
                  selected={draft.members}
                  onToggle={(member) =>
                    setDraft((current) => ({
                      ...current,
                      members: toggle(current.members, member),
                    }))
                  }
                  error={memoryErrors.members}
                />

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
                  <Field label="Дурсамжийн нэр" required error={memoryErrors.title}>
                    {({ id, describedBy, invalid }) => (
                      <>
                        <Input
                          id={id}
                          aria-describedby={describedBy}
                          invalid={invalid}
                          maxLength={MEMORY_TITLE_MAX}
                          placeholder="Жишээ: 2 насандаа эмээтэйгээ парк орсон"
                          value={draft.title}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, title: event.target.value }))
                          }
                          // Enter here means "add this memory", not "save the whole
                          // section" — the form's own submit is the dialog's button.
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            commitDraft();
                          }}
                        />
                        <CharCounter value={draft.title} max={MEMORY_TITLE_MAX} />
                      </>
                    )}
                  </Field>

                  <Field label="Огноо" error={memoryErrors.date}>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        type="date"
                        aria-describedby={describedBy}
                        invalid={invalid}
                        max={todayLocal()}
                        value={draft.date}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, date: event.target.value }))
                        }
                      />
                    )}
                  </Field>
                </div>

                <Field label="Дурсамжийн тайлбар">
                  {({ id, describedBy, invalid }) => (
                    <>
                      <Textarea
                        id={id}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        maxLength={MEMORY_DESCRIPTION_MAX}
                        placeholder="Парканд эмээтэйгээ хамт зугаалж, цэцэг үзэж, жижигхэн алхсан дурсамж."
                        value={draft.description}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, description: event.target.value }))
                        }
                      />
                      <CharCounter value={draft.description} max={MEMORY_DESCRIPTION_MAX} />
                    </>
                  )}
                </Field>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-caption text-muted">«Хадгалах» дарж бүгдийг хадгална.</p>

                  <div className="flex flex-wrap items-center gap-2">
                    {/*
                      Not "Болих". The dialog's own footer already has a
                      button by that name, and it closes the whole section — two
                      controls one word apart, one of which discards a sentence
                      and the other an afternoon's work.
                    */}
                    {showingDraft ? (
                      <Button type="button" variant="ghost" size="sm" onClick={cancelDraft}>
                        {editingId ? "Засварыг болих" : "Ноорог цэвэрлэх"}
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" onClick={() => commitDraft()}>
                      {editingId ? "Дурсамжийг шинэчлэх" : "Дурсамж нэмэх"}
                    </Button>
                  </div>
                </div>
              </section>

              <section aria-labelledby={`${formId}-memory-list`} className="min-w-0">
                <h3 id={`${formId}-memory-list`} className="mb-2 text-body font-semibold text-ink">
                  Хадгалсан дурсамжууд ({memories.length})
                </h3>
                <MemoryList
                  memories={memories}
                  activeId={showingDraft ? draft.id : previewId}
                  onSelect={(memory) => setPreviewId(memory.id)}
                  onEdit={editMemory}
                  onDelete={(memory) => setConfirming({ id: memory.id, where: "list" })}
                  confirmingId={confirming?.where === "list" ? confirming.id : null}
                  onConfirmDelete={deleteMemory}
                  onCancelDelete={() => setConfirming(null)}
                  emptyText="Дурсамж нэмээгүй байна. Дээрээс зураг сонгоод эхний дурсамжаа бичээрэй."
                />
              </section>
            </div>

            <div className="min-w-0">
              <div className="lg:sticky lg:top-0">
                <h3 className="mb-2 text-body font-semibold text-ink">Урьдчилан харах</h3>
                <MemoryPreview
                  memory={previewMemory}
                  age={age}
                  saved={!showingDraft && previewMemory !== null}
                  onEdit={
                    !showingDraft && previewMemory
                      ? () => editMemory(previewMemory as FamilyMemory)
                      : undefined
                  }
                  onDelete={
                    !showingDraft && previewMemory
                      ? () => setConfirming({ id: previewMemory.id, where: "preview" })
                      : undefined
                  }
                  confirming={
                    !showingDraft &&
                    confirming?.where === "preview" &&
                    confirming.id === previewMemory?.id
                  }
                  onConfirmDelete={() =>
                    previewMemory ? deleteMemory(previewMemory as FamilyMemory) : undefined
                  }
                  onCancelDelete={() => setConfirming(null)}
                />
              </div>
            </div>
          </div>
        </form>
      </FormDialog>
    </>
  );
}

export function hasAnyAgeDevelopment(profile: Profile): boolean {
  return ageSectionCompletion(profile).completed > 0;
}
