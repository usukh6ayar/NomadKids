"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { ChevronRight, MoreVertical, Pencil, Plus, X } from "lucide-react";
import { ageProfileSchema, type AgeProfile, type FamilyMemory } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { Art, type ArtName } from "@/components/ui/art";
import {
  CHARACTER_TRAITS,
  CHARACTER_TRAIT_EMOJI,
  FAVORITE_FIELDS,
  ageSectionCompletion,
  familyLearningCategories,
  kindergartenSkillCategories,
  type PortfolioAge,
} from "@/lib/age-development";
import type { GradientTone } from "@/lib/gradient-tones";
import { cn } from "@/lib/utils";

type Profile = AgeProfile | undefined;
type PatchBody = Record<
  string,
  string | number | null | string[] | Record<string, string> | FamilyMemory[]
>;

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
          {/*
            ★ Two to a row at every width — client, 2026-09-24. It was one
            column on a phone, which is a long scroll through short answers:
            "Тоглоом", "Ном", "Дуу" are a word each, and they read as pairs.
          */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
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

function customSkillsByCategory(values: string[], labels: string[]) {
  const grouped = Object.fromEntries(labels.map((label) => [label, [] as string[]]));
  for (const value of values) {
    const label = labels.find((candidate) => value.startsWith(`${candidate}: `));
    if (label) grouped[label]!.push(value.slice(label.length + 2));
    else if (labels[0]) grouped[labels[0]]!.push(value);
  }
  return grouped;
}

function SkillsSectionCard({
  childId,
  age,
  profile,
  title,
  emptyPrompt,
  categories,
  selectedKey,
  otherKey,
  legacyKey,
  art,
  tone,
  customEntries = false,
}: {
  childId: string;
  age: PortfolioAge;
  profile: Profile;
  title: string;
  emptyPrompt: string;
  categories: SkillCategory[];
  selectedKey: "kindergartenSkills" | "familyLearningSkills";
  otherKey: "kindergartenOtherSkill" | "familyLearningOther";
  legacyKey: "newSkills" | "familyMembers";
  art: ArtName;
  tone: GradientTone;
  customEntries?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [entries, setEntries] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState("");
  const categoryKey = categories.map((category) => category.label).join("\u0000");
  const reset = useCallback(() => {
    const saved = profile?.[selectedKey] ?? [];
    setSelected(saved);
    setEntries(customSkillsByCategory(saved, categoryKey.split("\u0000")));
    setOther(profile?.[otherKey] ?? profile?.[legacyKey] ?? "");
  }, [categoryKey, legacyKey, otherKey, profile, selectedKey]);
  useEffect(reset, [reset]);

  const close = () => {
    setOpen(false);
    reset();
  };
  const save = useAgeProfileSave(childId, age, close);
  const errors = fieldErrors(save.error);
  const storedSelected = profile?.[selectedKey] ?? [];
  const storedOther = profile?.[otherKey] ?? profile?.[legacyKey] ?? "";
  const storedEntries = customSkillsByCategory(
    storedSelected,
    categories.map((category) => category.label),
  );
  const rows = customEntries
    ? [
        ...categories.flatMap((category) => {
          const values = storedEntries[category.label] ?? [];
          return values.length ? [{ label: category.label, value: values.join(", ") }] : [];
        }),
        ...(storedOther.trim() ? [{ label: "Өөр сурсан зүйл", value: storedOther }] : []),
      ]
    : [
        ...(storedSelected.length
          ? [{ label: "Сонгосон чадвар", value: storedSelected.join(", ") }]
          : []),
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
      </ProfileCard>
      <FormDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        busy={save.isPending}
        title={title}
        footer={<DialogActions formId={formId} busy={save.isPending} onCancel={close} />}
      >
        <form
          id={formId}
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (save.isPending) return;
            /*
              ★ No `kindergartenSkillNotes` / `familyLearningNotes` — client, 2026-09-24 asked for "Нэмэлт
              тайлбар" to go. A partial upsert leaves an absent field alone, so
              whatever a family wrote in those boxes before today is still in
              the database and still printed by the keepsake PDF and the age
              comparison. Wiping it would be a deletion of their words, which
              is not what "remove the box" asks for.
            */
            save.mutate(
              customEntries
                ? {
                    [selectedKey]: categories.flatMap((category) =>
                      (entries[category.label] ?? [])
                        .map((value) => value.trim())
                        .filter(Boolean)
                        .map((value) => `${category.label}: ${value}`),
                    ),
                  }
                : {
                    [selectedKey]: selected,
                    [otherKey]: other.trim() || null,
                  },
            );
          }}
        >
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          {customEntries
            ? categories.map((category) => (
                <fieldset key={category.id} className="rounded-row border border-border p-3.5">
                  <legend className="px-1 text-body font-semibold text-ink">
                    {category.label}
                  </legend>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setEntries((current) => ({
                        ...current,
                        [category.label]: [...(current[category.label] ?? []), ""],
                      }))
                    }
                  >
                    <Plus size={18} aria-hidden="true" />
                    Нэмэх
                  </Button>
                  <div className="mt-3 flex flex-col gap-2">
                    {(entries[category.label] ?? []).map((entry, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          aria-label={`${category.label} ${index + 1}`}
                          placeholder="Юу сурсныг бичнэ үү"
                          value={entry}
                          onChange={(event) =>
                            setEntries((current) => ({
                              ...current,
                              [category.label]: (current[category.label] ?? []).map(
                                (value, itemIndex) =>
                                  itemIndex === index ? event.target.value : value,
                              ),
                            }))
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`${category.label} ${index + 1} устгах`}
                          onClick={() =>
                            setEntries((current) => ({
                              ...current,
                              [category.label]: (current[category.label] ?? []).filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            }))
                          }
                        >
                          <X size={18} aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))
            : categories.map((category) => (
                <fieldset key={category.id} className="rounded-row border border-border p-3.5">
                  <legend className="px-1 text-body font-semibold text-ink">
                    {category.label}
                  </legend>
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
                </fieldset>
              ))}
          {!customEntries ? (
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
          ) : null}
        </form>
      </FormDialog>
    </>
  );
}

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
      otherKey="kindergartenOtherSkill"
      legacyKey="newSkills"
      art="ageKindergartenLearning"
      tone="green"
      customEntries
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
          {/*
            ★ The legend is a name, not a line of text — client, 2026-09-24
            asked for the words "Зан араншингийн ажиглалт" off the screen. The
            group keeps the name for a screen reader, which is what stops the
            eleven boxes being announced as eleven unrelated checkboxes.
          */}
          <fieldset aria-label="Зан араншингийн ажиглалт">
            {/*
              ★ Two columns at every width, and a face on each — client,
              2026-09-24: "зан авир сонгохыг cute emoji той болгоод 2 эгнээ
              болго". It was a one-column list of checkboxes on a phone, which
              is eleven rows to scroll past before reaching the box below.
            */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {CHARACTER_TRAITS.map((trait) => (
                <TraitChoice
                  key={trait}
                  trait={trait}
                  checked={traits.includes(trait)}
                  onToggle={() =>
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
        </form>
      </FormDialog>
    </>
  );
}

/** Bounds mirrored from `updateAgeProfileSchema` — a counter that lies is worse than none. */

/**
 * One observation to tick — an emoji, the word, and a real checkbox.
 *
 * ★ The input is the control, merely hidden. A `<button aria-pressed>` would
 * look identical and lose what a checkbox gives for free: the space bar, the
 * group's own semantics, and — the reason it matters here — an accessible name
 * that is exactly the word, because the emoji is `aria-hidden`. That is what
 * keeps "the thing a parent ticked" and "the string stored" the same thing.
 */
function TraitChoice({
  trait,
  checked,
  onToggle,
}: {
  trait: (typeof CHARACTER_TRAITS)[number];
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-2 rounded-card border px-3 py-2 text-body transition-colors",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary",
        checked
          ? "border-primary bg-primary-soft font-semibold text-primary"
          : "border-border bg-surface text-ink hover:border-primary/50 hover:bg-canvas",
      )}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={onToggle} />
      <span aria-hidden="true" className="text-lead leading-none">
        {CHARACTER_TRAIT_EMOJI[trait]}
      </span>
      <span className="min-w-0 flex-1 leading-snug">{trait}</span>
    </label>
  );
}

/** Ам бүлийн тоо — one to ten, the last of them read as "10+". */
const FAMILY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** The ceiling the API enforces on `familyDescription`. */
const FAMILY_TEXT_MAX = 2000;

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
 * "Миний гэр бүл" — a household size and a box to write in.
 *
 * ★ The memory builder is gone — client, 2026-09-24: "эдгээрийг бүгдийг
 * арилгаад ам бүлийн тоо сонгох хэсэг, Миний гэр бүл гээд бичих хэсэг л
 * оруул". The photo picker, the five-card member selector, the per-memory
 * title, date and description, the saved list and its preview all went with
 * it, and so did `family-memories.tsx`, which nothing else used.
 *
 * ★★ Nothing stored is wiped. `familyMemories` and `familyMemberTypes` are
 * simply **absent from the PATCH**, and a partial upsert leaves an absent
 * field alone — so a family who built memories before today still has them in
 * the database and in the keepsake PDF, which still prints both rows. Erasing
 * what families wrote is a deletion of their data and its own decision, not
 * something to infer from a request to simplify a form.
 *
 * ★★★ The photographs were never owned by this card: each one is an ordinary
 * album row under `category=FAMILY`, so they keep appearing in that age's
 * "Миний гэр бүл" album exactly as before.
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
  const [open, setOpen] = useState(false);
  const [familySize, setFamilySize] = useState("");
  const [description, setDescription] = useState("");

  const reset = useCallback(() => {
    setFamilySize(profile?.familySize ? String(profile.familySize) : "");
    setDescription(profile?.familyDescription ?? "");
  }, [profile]);
  useEffect(reset, [reset]);

  const close = () => {
    setOpen(false);
    reset();
  };
  const save = useAgeProfileSave(childId, age, close);
  const errors = fieldErrors(save.error);
  const formId = `family-${age}-form`;

  const rows = [
    ...(profile?.familySize ? [{ label: "Ам бүлийн тоо", value: `${profile.familySize}` }] : []),
    ...(profile?.familyDescription?.trim()
      ? [{ label: "Миний гэр бүл", value: profile.familyDescription }]
      : []),
  ];

  return (
    <>
      <ProfileCard
        title="Миний гэр бүл"
        tone="orange"
        hasContent={rows.length > 0}
        emptyPrompt="Ам бүлийн тоогоо сонгож, гэр бүлийнхээ тухай бичээрэй."
        art="ageFamily"
        wide
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
        title="Миний гэр бүл"
        description={`${age} насны гэр бүлийн мэдээлэл.`}
        footer={<DialogActions formId={formId} busy={save.isPending} onCancel={close} />}
      >
        <form
          id={formId}
          className="flex min-w-0 flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              // "" is "not answered", which is null rather than a zero.
              familySize: familySize ? Number(familySize) : null,
              familyDescription: description.trim() || null,
            });
          }}
        >
          <FormError message={save.isError ? errorMessage(save.error) : null} />

          <Field label="Ам бүлийн тоо" error={errors.familySize}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={familySize}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setFamilySize(event.target.value)
                }
              >
                <option value="">Сонгох</option>
                {FAMILY_SIZES.map((size) => (
                  <option key={size} value={String(size)}>
                    {size === FAMILY_SIZES[FAMILY_SIZES.length - 1] ? `${size}+` : `${size}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Миний гэр бүл" error={errors.familyDescription}>
            {({ id, describedBy, invalid }) => (
              <>
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  rows={5}
                  maxLength={FAMILY_TEXT_MAX}
                  placeholder="Жишээ: Манайх аав, ээж, ах бид дөрвүүлээ амьдардаг. Амралтын өдөр хамт зугаалдаг."
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <CharCounter value={description} max={FAMILY_TEXT_MAX} />
              </>
            )}
          </Field>
        </form>
      </FormDialog>
    </>
  );
}

export function hasAnyAgeDevelopment(profile: Profile): boolean {
  return ageSectionCompletion(profile).completed > 0;
}
