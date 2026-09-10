"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronRight, MoreVertical, Pencil, X } from "lucide-react";
import { ageProfileSchema, type AgeProfile } from "@kinder/contracts";
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
  FAMILY_MEMBER_TYPES,
  FAVORITE_FIELDS,
  ageSectionCompletion,
  familyLearningCategories,
  kindergartenSkillCategories,
  type PortfolioAge,
} from "@/lib/age-development";
import type { GradientTone } from "@/lib/gradient-tones";
import { cn } from "@/lib/utils";

type Profile = AgeProfile | undefined;
type PatchBody = Record<string, string | null | string[] | Record<string, string>>;

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
  const [members, setMembers] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const reset = useCallback(() => {
    setMembers(profile?.familyMemberTypes ?? []);
    setDescription(profile?.familyDescription ?? "");
  }, [profile]);
  useEffect(reset, [reset]);

  const close = () => {
    setOpen(false);
    reset();
  };
  const save = useAgeProfileSave(childId, age, close);
  const errors = fieldErrors(save.error);
  const rows = [
    ...(profile?.familyMemberTypes.length
      ? [{ label: "Гэр бүлийн гишүүд", value: profile.familyMemberTypes.join(", ") }]
      : []),
    ...(profile?.familyDescription?.trim()
      ? [
          {
            label: "Гэр бүлийн тухай, хамтдаа хийх дуртай зүйлс",
            value: profile.familyDescription,
          },
        ]
      : []),
  ];
  const formId = `family-${age}-form`;

  return (
    <>
      <ProfileCard
        title="Миний гэр бүл"
        tone="orange"
        hasContent={rows.length > 0}
        emptyPrompt="Гэр бүлийнхээ тухай нандин дурсамжаа тэмдэглээрэй."
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
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending) {
              save.mutate({
                familyMemberTypes: members,
                familyDescription: description.trim() || null,
              });
            }
          }}
        >
          <FormError message={save.isError ? errorMessage(save.error) : null} />
          <fieldset>
            <legend className="text-body font-semibold text-ink">Гэр бүлийн гишүүд</legend>
            <div className="mt-2 grid gap-x-4 sm:grid-cols-2">
              {FAMILY_MEMBER_TYPES.map((member) => (
                <Checkbox
                  key={member}
                  label={member}
                  checked={members.includes(member)}
                  onChange={() =>
                    setMembers((current) =>
                      current.includes(member)
                        ? current.filter((item) => item !== member)
                        : [...current, member],
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
          <Field
            label="Гэр бүлийн тухай, хамтдаа хийх дуртай зүйлс"
            error={errors.familyDescription}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
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
