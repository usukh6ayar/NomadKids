"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Mars, MoreHorizontal, User, Venus, VenusAndMars } from "lucide-react";
import { SEX_LABEL, type ChildDetail } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError } from "@/components/ui/states";
import { IconChip } from "@/components/ui/icon-chip";
import { useToast } from "@/components/ui/toast";
import type { Tone } from "@/components/ui/tone";
import { aboutMeResponseSchema } from "@/components/child/child-about-me";
import { GRADIENT_TONE_STYLE } from "@/lib/gradient-tones";
import { AGE_TONE } from "@/lib/age-content";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The top of "Миний тухай" — reference screenshot, client-supplied.
 *
 * ★ Replaces `ChildHeroProfile` on this page only, not everywhere it is used.
 *
 * `ChildHeroProfile` is the identity block every other per-child page shares
 * (photo, status badge, age/sex/group facts) — right for a page whose job is
 * "which child am I looking at". This page's job is narrower: name, birth date
 * and sex as three plain facts, then a launcher into the age-by-age content
 * that page's own `SectionHeader` below (`ChildAboutMe`, `id="about-me-
 * heading"`) does not surface at all today. So this is a second, purpose-built
 * card rather than a variant of the shared one.
 *
 * ★★ The detailed story fields (танилцуулга, нэрний утга, мөрөөдөл, …) stay
 * exactly where they are, in `ChildAboutMe` below this card — the reference
 * screenshot is the top of the page, not the whole of it. The "…" button used
 * to jump down to that section's own "Засах" trigger rather than open
 * anything itself, which left a parent tapping it twice — once to get there,
 * once to actually start editing — for the three fields this card already
 * shows. It now opens its own small dialog straight onto those three,
 * through `PATCH /children/:id/about-me`'s existing `firstName`/
 * `dateOfBirth`/`sex` fields (`portfolio.dto.ts`'s `updateAboutMeSchema`) —
 * the same `Child`-column write `ChildAboutMe`'s own form already makes,
 * scoped to just the fields this card owns rather than its full grid.
 *
 * ★★★ The age pills were briefly removed (2026-08-30) when `/portfolio/growth`
 * stopped showing "Насны онцлог" to parents at all (`growth/page.tsx`'s
 * `ParentGrowthLauncher`) — a pill reading "3 нас" would have landed on a
 * page with no `#age-3` to scroll to. They are back the same day, pointing at
 * real destinations instead: `portfolio/growth/age/[age]/page.tsx`, a page
 * built for exactly this. "Бүх насыг харьцуулах" moved the same way, to
 * `portfolio/growth/compare/page.tsx`.
 */
export function AboutMeSummaryCard({ child, childId }: { child: ChildDetail; childId: string }) {
  const [open, setOpen] = useState(false);
  const SexIcon = child.sex === "FEMALE" ? Venus : child.sex === "MALE" ? Mars : VenusAndMars;

  return (
    <Card pad="roomy" className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <IconChip icon={<User size={20} aria-hidden="true" />} tone="sky" />

        <div className="min-w-0 flex-1">
          <h1 className="text-lead font-semibold text-ink">Миний тухай</h1>
          <p className="text-body text-muted">{child.firstName}-ийн үндсэн мэдээлэл.</p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Үндсэн мэдээлэл засах"
          onClick={() => setOpen(true)}
        >
          <MoreHorizontal size={18} aria-hidden="true" />
        </Button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3">
        <IdentityTile icon={<User size={16} aria-hidden="true" />} tone="sky" label="Нэр" value={child.firstName} />
        <IdentityTile
          icon={<CalendarDays size={16} aria-hidden="true" />}
          tone="peach"
          label="Төрсөн өдөр"
          value={formatDate(child.dateOfBirth)}
        />
        <IdentityTile
          icon={<SexIcon size={16} aria-hidden="true" />}
          tone="cornflower"
          label="Хүйс"
          value={(child.sex && SEX_LABEL[child.sex]) || "—"}
        />
      </div>

      <nav aria-label="Насны хэсгүүд рүү шилжих">
        <ul className="grid grid-cols-4 gap-2">
          {PORTFOLIO_AGES.map((age) => {
            const tone = GRADIENT_TONE_STYLE[AGE_TONE[age]];
            return (
              <li key={age}>
                <Link
                  href={`/children/${childId}/portfolio/growth/age/${age}`}
                  className={cn(
                    "flex min-h-13 items-center justify-center rounded-row border border-white/30 text-body font-bold text-white transition-transform hover:scale-[1.02]",
                    tone.gradient,
                    tone.shadow,
                  )}
                >
                  {age} нас
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Link
        href={`/children/${childId}/portfolio/growth/compare`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-row border border-primary/20 bg-primary-soft px-4 py-3.5 transition-colors hover:border-primary/40"
      >
        <div className="min-w-0">
          <p className="font-semibold text-primary-strong">Бүх насыг харьцуулах</p>
          <p className="text-caption text-primary-strong/80">
            2-5 насны өсөлт, зураг, дурсамжийг зэрэгцүүлж харна.
          </p>
        </div>
        <span className="shrink-0 rounded-control bg-surface px-3.5 py-2 text-body font-semibold text-primary">
          Харах
        </span>
      </Link>

      <IdentityEditDialog open={open} onOpenChange={setOpen} child={child} childId={childId} />
    </Card>
  );
}

/** The "…" button's dialog — just the three fields this card shows, nothing from `ChildAboutMe`'s own grid below. */
function IdentityEditDialog({
  open,
  onOpenChange,
  child,
  childId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  child: ChildDetail;
  childId: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [firstName, setFirstName] = useState(child.firstName);
  const [dateOfBirth, setDateOfBirth] = useState(child.dateOfBirth.slice(0, 10));
  const [sex, setSex] = useState(child.sex ?? "");

  // Re-seeded whenever the child changes, so reopening the dialog shows what
  // is actually stored rather than whatever was left over from a cancelled edit.
  useEffect(() => {
    setFirstName(child.firstName);
    setDateOfBirth(child.dateOfBirth.slice(0, 10));
    setSex(child.sex ?? "");
  }, [child]);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/about-me`, aboutMeResponseSchema, {
        method: "PATCH",
        body: {
          firstName: firstName.trim() || undefined,
          dateOfBirth: dateOfBirth || undefined,
          sex: sex || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Хадгаллаа.");
      onOpenChange(false);
      // `ChildAboutMe` (the section below) and `ChildHeroProfile`-style
      // headers elsewhere all read the same query — one invalidation keeps
      // every copy of these three facts in step.
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      busy={save.isPending}
      title="Үндсэн мэдээлэл"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={save.isPending}
            onClick={() => onOpenChange(false)}
          >
            Болих
          </Button>
          <Button type="submit" form="identity-form" size="sm" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <form
        id="identity-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }}
      >
        <FormError
          message={save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null}
        />

        <Field label="Нэр" error={errors.firstName} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          )}
        </Field>

        <Field label="Төрсөн өдөр" error={errors.dateOfBirth} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="date"
              value={dateOfBirth}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDateOfBirth(e.target.value)}
              required
            />
          )}
        </Field>

        <Field label="Хүйс" error={errors.sex} required>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={sex}
              onChange={(e) => setSex(e.target.value)}
              required
            >
              <option value="" disabled>
                Сонгох…
              </option>
              {Object.entries(SEX_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </FormDialog>
  );
}

function IdentityTile({
  icon,
  tone,
  label,
  value,
}: {
  icon: ReactNode;
  tone: Tone;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-row border border-border bg-canvas px-3 py-2.5">
      <IconChip icon={icon} tone={tone} size="sm" />
      <div className="min-w-0">
        <p className="text-caption text-muted">{label}</p>
        <p className="truncate font-medium text-ink">{value}</p>
      </div>
    </div>
  );
}
