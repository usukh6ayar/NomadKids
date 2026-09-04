"use client";

import { CalendarDays, Mars, MoreHorizontal, User, Venus, VenusAndMars } from "lucide-react";
import { SEX_LABEL, type ChildDetail } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import type { Tone } from "@/components/ui/tone";
import { formatDate } from "@/lib/format";
import type { ReactNode } from "react";

/**
 * The top of "Миний тухай" — reference screenshot, client-supplied.
 *
 * ★ Replaces `ChildHeroProfile` on this page only, not everywhere it is used.
 *
 * `ChildHeroProfile` is the identity block every other per-child page shares
 * (photo, status badge, age/sex/group facts) — right for a page whose job is
 * "which child am I looking at". This page's job is narrower: name, birth date
 * and sex as three plain facts.
 *
 * ★★ The detailed story fields (танилцуулга, нэрний утга, мөрөөдөл, …) stay
 * exactly where they are, in `ChildAboutMe` — the reference screenshot is the
 * top of the page, not the whole of it.
 *
 * ★★★ No `<Card>` of its own, as of the 2026-09-04 merge — `about-me/page.tsx`
 * now wraps this together with `ChildAboutMe` in one shared card, on the
 * client's instruction ("2 UI бн, зөвхөн нэг card дээр нэгтгэе"). This
 * component supplies the page's `h1` and the identity tiles only.
 *
 * ★★★★ The age pills and "Бүх насыг харьцуулах" bar that used to live here
 * moved out the same day, to a tile of their own on the portfolio hub
 * (`portfolio/page.tsx`'s `PortfolioHubNav`) — the client's instruction was to
 * drop age-comparison out of "Миний тухай" entirely, not fold it into the
 * merged card. `AgeStepper` still carries a visitor between the five
 * destinations once they've arrived through that tile.
 *
 * ★★★★★ The "…" button no longer opens a dialog of its own, as of a
 * same-week follow-up. It used to carry its own small `IdentityEditDialog` —
 * a second, separate PATCH scoped to just Нэр/Төрсөн өдөр/Хүйс — beside
 * `ChildAboutMe`'s own "Засах" button and its full form below. Two edit
 * entries into one merged card was the thing the client asked out next: the
 * "…" button now calls `onEdit`, which `about-me/page.tsx` wires to the same
 * `editing` flag that opens `ChildAboutMe`'s form — one button, one form,
 * covering both the identity tiles and the detailed fields.
 */
export function AboutMeSummaryCard({
  child,
  onEdit,
  editing,
}: {
  child: ChildDetail;
  onEdit: () => void;
  editing: boolean;
}) {
  const SexIcon = child.sex === "FEMALE" ? Venus : child.sex === "MALE" ? Mars : VenusAndMars;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <IconChip icon={<User size={20} aria-hidden="true" />} tone="sky" />

        <div className="min-w-0 flex-1">
          <h1 className="text-lead font-semibold text-ink">Миний тухай</h1>
          <p className="text-body text-muted">{child.firstName}-ийн үндсэн мэдээлэл.</p>
        </div>

        {!editing ? (
          <Button variant="ghost" size="icon" aria-label="Мэдээлэл засах" onClick={onEdit}>
            <MoreHorizontal size={18} aria-hidden="true" />
          </Button>
        ) : null}
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
    </div>
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
