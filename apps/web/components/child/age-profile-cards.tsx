"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { ageProfileSchema, type AgeProfile } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { AGE_FIELDS } from "@/components/child/child-growth-ages";
import { AgePresetField } from "@/components/child/age-preset-field";
import { AGE_FAMILY_OPTIONS, AGE_SKILL_OPTIONS, AGE_TONE } from "@/lib/age-content";
import type { GradientTone } from "@/lib/gradient-tones";
import type { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { cn } from "@/lib/utils";

type Age = (typeof PORTFOLIO_AGES)[number];
type Profile = AgeProfile | undefined;

/**
 * A plain white card with just its border tinted to the current age — the
 * reference screenshots give every card on the page the active age's colour
 * this way (blue borders on "Миний 3 нас", green on "Миний 2 нас"), rather
 * than `Card`'s own `tone` prop, whose `TONE_CARD` also washes the
 * background — these stay white inside.
 */
const BORDER_FOR_TONE: Record<GradientTone, string> = {
  green: "border-mint",
  blue: "border-sky",
  orange: "border-peach",
  purple: "border-cornflower",
  pink: "border-peach",
};

/**
 * The six cards on a parent's per-age page — client reference screenshot,
 * 2026-08-30. Every field here is in `SHARED_AGE_FIELDS`
 * (`portfolio-fields.ts`), writable by a guardian, so every card below is a
 * real edit, not a read-only preview of a staff-only record.
 *
 * ★ Each card sends only its own field(s) to `PATCH .../age-profiles/:age`.
 * `PortfolioService.updateAgeProfile` runs the body through `definedOnly()`
 * — a key this component never includes is left untouched server-side, so a
 * save from "Миний зан араншин" cannot clobber `newSkills` sitting in a
 * different card's own draft. All six invalidate the same
 * `qk.ageProfiles(childId)` the staff accordion (`ChildGrowthAges`) reads, so
 * neither side of the record can go stale relative to the other.
 */

const FAVORITE_KEYS = AGE_FIELDS.filter((f) => f.key.startsWith("favorite")).map((f) => f.key);

/** One `PATCH .../age-profiles/:age` mutation, shared by every card's dialog. */
function useAgeProfileSave(childId: string, age: Age, onSaved: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      mutate(`/children/${childId}/age-profiles/${age}`, ageProfileSchema, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      toast.success("Хадгаллаа.");
      onSaved();
      void queryClient.invalidateQueries({ queryKey: qk.ageProfiles(childId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** The shell every card shares: heading, "⋮" trigger, empty state, the current age's border tint. */
function ProfileCard({
  title,
  tone,
  hasContent,
  emptyHint,
  onEdit,
  children,
}: {
  title: string;
  tone: GradientTone;
  hasContent: boolean;
  emptyHint: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <Card pad="roomy" className={cn("flex flex-col gap-2 border-2", BORDER_FOR_TONE[tone])}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-ink">{title}</h3>
        <Button variant="ghost" size="icon" aria-label={`${title} засах`} onClick={onEdit}>
          <MoreHorizontal size={18} aria-hidden="true" />
        </Button>
      </div>
      {hasContent ? children : <p className="text-body text-muted">{emptyHint}</p>}
    </Card>
  );
}

/**
 * Links to the growth chart/form that already exists — `ChildGrowth`, reached
 * from "Ерөнхий" → Өсөлт. An illustrated banner rather than the other five
 * cards' plain heading — the screenshot draws this one differently because
 * it owns no field of its own to show or edit here; it is a doorway, not a
 * record.
 */
export function GrowthTeaserCard({ childId, age }: { childId: string; age: Age }) {
  return (
    <Card
      pad="roomy"
      className={cn(
        "relative flex min-h-44 items-center gap-4 overflow-hidden border-2 bg-[linear-gradient(135deg,#fef6e4_0%,#fdecc8_100%)]",
        BORDER_FOR_TONE[AGE_TONE[age]],
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-lead font-semibold text-ink">Би өдөр бүр өсч байна</p>
        <p className="mt-1.5 text-body text-muted">Өндөр, жингийн мэдээллээ нэмээрэй.</p>
        <span
          aria-hidden="true"
          className="mt-5 block h-2 w-2/3 rounded-pill bg-[linear-gradient(90deg,#34d399_0%,#16a34a_100%)]"
        />
      </div>

      {/*
        A static asset — the client's own artwork, 520×603 — not a hand-rolled
        `<svg>`. `tokens.test.tsx` bans a new inline one in every file outside
        `components/ui/chart/` (plus two named, explicitly-closed pieces of
        debt), and a decoration that draws nothing to scale against belongs in
        `public/` anyway, the same way `child-growth-ages.tsx`'s own empty
        state loads `mascot-boy-green.webp`. `w-auto` keeps its own aspect
        ratio as the height steps up at `sm:` rather than stretching it square.
      */}
      <Image
        src="/illustrations/giraffe-growth.png"
        alt=""
        width={138}
        height={160}
        className="h-32 w-auto shrink-0 sm:h-40"
      />

      <Button asChild variant="ghost" size="icon" className="absolute right-3 top-3">
        <Link href={`/children/${childId}/general?tab=growth`} aria-label="Өсөлт хөгжил рүү очих">
          <MoreHorizontal size={18} aria-hidden="true" />
        </Link>
      </Button>
    </Card>
  );
}

export function FavoritesCard({
  childId,
  age,
  profile,
}: {
  childId: string;
  age: Age;
  profile: Profile;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const key of FAVORITE_KEYS) next[key] = (profile?.[key] as string) ?? "";
    setForm(next);
  }, [profile]);

  const save = useAgeProfileSave(childId, age, () => setOpen(false));
  const errors = fieldErrors(save.error);
  const filled = FAVORITE_KEYS.filter((key) => profile?.[key]);

  return (
    <ProfileCard
      title="Миний дуртай бүх зүйлс"
      tone={AGE_TONE[age]}
      hasContent={filled.length > 0}
      emptyHint="Мэдээлэл байхгүй"
      onEdit={() => setOpen(true)}
    >
      <dl className="grid gap-2.5 sm:grid-cols-2">
        {filled.map((key) => {
          const field = AGE_FIELDS.find((f) => f.key === key)!;
          return (
            <div key={key}>
              <dt className="text-caption text-muted">{field.label}</dt>
              <dd className="truncate text-body text-ink">{String(profile?.[key])}</dd>
            </div>
          );
        })}
      </dl>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        busy={save.isPending}
        title="Дуртай зүйлс"
        description={`${age} насны дуртай зүйлсээ бөглөнө үү.`}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              Болих
            </Button>
            <Button type="submit" form="favorites-form" size="sm" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id="favorites-form"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (save.isPending) return;
            const body: Record<string, string | null> = {};
            for (const key of FAVORITE_KEYS) body[key] = form[key]?.trim() || null;
            save.mutate(body);
          }}
        >
          <FormError
            message={save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {AGE_FIELDS.filter((f) => FAVORITE_KEYS.includes(f.key)).map((field) => (
              <Field key={field.key} label={field.label} error={errors[field.key]}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={form[field.key] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
        </form>
      </FormDialog>
    </ProfileCard>
  );
}

/** Shared by both `newSkills` and `familyMembers` — same preset-picker shape, different options and copy. */
function PresetCard({
  childId,
  age,
  profile,
  fieldKey,
  title,
  dialogHint,
  options,
}: {
  childId: string;
  age: Age;
  profile: Profile;
  fieldKey: "newSkills" | "familyMembers";
  title: string;
  dialogHint: string;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  useEffect(() => setValue(profile?.[fieldKey] ?? ""), [profile, fieldKey]);

  const save = useAgeProfileSave(childId, age, () => setOpen(false));
  const errors = fieldErrors(save.error);
  const stored = profile?.[fieldKey];

  return (
    <ProfileCard
      title={title}
      tone={AGE_TONE[age]}
      hasContent={Boolean(stored)}
      emptyHint="Мэдээлэл байхгүй"
      onEdit={() => setOpen(true)}
    >
      <p className="whitespace-pre-wrap text-body text-ink">{stored}</p>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        busy={save.isPending}
        title={title}
        description={dialogHint}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              Болих
            </Button>
            <Button type="submit" form={`${fieldKey}-form`} size="sm" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id={`${fieldKey}-form`}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (save.isPending) return;
            save.mutate({ [fieldKey]: value.trim() || null });
          }}
        >
          <FormError
            message={save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null}
          />
          <Field label={title} error={errors[fieldKey]}>
            {({ id, describedBy, invalid }) => (
              <AgePresetField
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                options={options}
                value={value}
                onChange={setValue}
              />
            )}
          </Field>
        </form>
      </FormDialog>
    </ProfileCard>
  );
}

export function SkillsCard({ childId, age, profile }: { childId: string; age: Age; profile: Profile }) {
  return (
    <PresetCard
      childId={childId}
      age={age}
      profile={profile}
      fieldKey="newSkills"
      title="Миний цэцэрлэгтээ сурсан зүйлс"
      dialogHint={`${age} насанд тохирох чадваруудаас сонгож эсвэл шинээр бичээрэй.`}
      options={AGE_SKILL_OPTIONS[age]}
    />
  );
}

/**
 * Rendered twice on the page — "Миний гэр бүлээсээ суралцсан зүйлс" and "Гэр
 * бүл" — both read/write the same `familyMembers` column. RFP §4.3 has one
 * family-related field, not two, so this is one value shown from two angles
 * rather than a second column invented to keep the card count matching the
 * screenshot.
 */
export function FamilyCard({
  childId,
  age,
  profile,
  title,
}: {
  childId: string;
  age: Age;
  profile: Profile;
  title: string;
}) {
  return (
    <PresetCard
      childId={childId}
      age={age}
      profile={profile}
      fieldKey="familyMembers"
      title={title}
      dialogHint={`${age} насанд гэр бүлээсээ сурсан зүйлсийг сонгож эсвэл шинээр бичээрэй.`}
      options={AGE_FAMILY_OPTIONS[age]}
    />
  );
}

export function CharacterCard({
  childId,
  age,
  profile,
}: {
  childId: string;
  age: Age;
  profile: Profile;
}) {
  const [open, setOpen] = useState(false);
  const [personality, setPersonality] = useState("");
  const [emotionalTraits, setEmotionalTraits] = useState("");

  useEffect(() => {
    setPersonality(profile?.personality ?? "");
    setEmotionalTraits(profile?.emotionalTraits ?? "");
  }, [profile]);

  const save = useAgeProfileSave(childId, age, () => setOpen(false));
  const errors = fieldErrors(save.error);
  const hasContent = Boolean(profile?.personality) || Boolean(profile?.emotionalTraits);

  return (
    <ProfileCard
      title="Миний зан араншин"
      tone={AGE_TONE[age]}
      hasContent={hasContent}
      emptyHint="Мэдээлэл байхгүй"
      onEdit={() => setOpen(true)}
    >
      <dl className="flex flex-col gap-2.5">
        {profile?.personality ? (
          <div>
            <dt className="text-caption text-muted">Зан чанар</dt>
            <dd className="whitespace-pre-wrap text-body text-ink">{profile.personality}</dd>
          </div>
        ) : null}
        {profile?.emotionalTraits ? (
          <div>
            <dt className="text-caption text-muted">Сэтгэл хөдлөлийн онцлог</dt>
            <dd className="whitespace-pre-wrap text-body text-ink">{profile.emotionalTraits}</dd>
          </div>
        ) : null}
      </dl>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        busy={save.isPending}
        title="Миний зан араншин"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              Болих
            </Button>
            <Button type="submit" form="character-form" size="sm" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id="character-form"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (save.isPending) return;
            save.mutate({
              personality: personality.trim() || null,
              emotionalTraits: emotionalTraits.trim() || null,
            });
          }}
        >
          <FormError
            message={save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null}
          />
          <Field label="Зан чанар" error={errors.personality}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
              />
            )}
          </Field>
          <Field label="Сэтгэл хөдлөлийн онцлог" error={errors.emotionalTraits}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={emotionalTraits}
                onChange={(e) => setEmotionalTraits(e.target.value)}
              />
            )}
          </Field>
        </form>
      </FormDialog>
    </ProfileCard>
  );
}
