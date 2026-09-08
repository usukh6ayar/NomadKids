"use client";

import type { ReactNode } from "react";
import { HeartPulse } from "lucide-react";
import { CHILD_STATUS_LABEL, SEX_LABEL, type ChildDetail } from "@kinder/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChildAvatar } from "@/components/media/media-image";
import { ChildPhotoButton } from "@/components/child/child-photo-button";
import { formatAge, formatDate, fullName } from "@/lib/format";

/**
 * How each standing is tinted.
 *
 * `ON_LEAVE` is `sun` — "waiting on someone" in the badge's own vocabulary,
 * which is exactly what a child on leave is. `TEMPORARY` is `sky`, purely
 * informational: a short-term placement is not a problem, it is a fact the
 * roster should carry. Only `INACTIVE` is grey, because only that one means
 * the record is no longer live.
 */
const STATUS_TONE: Record<string, "mint" | "sky" | "sun" | "neutral"> = {
  ACTIVE: "mint",
  TEMPORARY: "sky",
  ON_LEAVE: "sun",
  INACTIVE: "neutral",
};

/**
 * Who this child is.
 *
 * The same identity block on every child screen, so a teacher moving between
 * portfolio, observations and assessment never loses track of whose record is
 * open. That sounds obvious and is exactly what goes wrong when each screen
 * builds its own header: on a phone, with the name scrolled off, an observation
 * gets written against the wrong child.
 *
 * ★ It stacks rather than shrinks.
 *
 * At 375px the avatar, the name block and the action row each take a full line.
 * The alternative — everything on one row at reduced size — is what turns a
 * 64px photograph into a 32px smudge and truncates a Mongolian name to two
 * syllables, and the whole point of the block is being recognisable at a
 * glance.
 *
 * ★★ The health badge is staff-only, and it is the *presence* of a note.
 *
 * `healthNotes` is a free-text staff field. It says "there is something to read
 * here", which is worth surfacing at the top rather than at the bottom of a tab
 * — a teacher taking a child outside should not have to go looking.
 *
 * ★★★ It is still not the allergy alert, and the reason changed on 2026-08-25.
 *
 * This note used to say structured allergies did not exist, and that inventing
 * a badge from nothing is how one ends up promising a check the system never
 * made. They exist now — `AllergyRecord`, RFP Module 2 — and the badge is
 * *still* the presence of the free-text note, because the two answer different
 * questions and a chip cannot answer both. "⚠ Эрүүл мэнд" meaning either "read
 * the note" or "this child stops breathing near nuts" is a chip that means
 * nothing.
 *
 * The structured alert lives on the Эрүүл мэнд tab, where it can name the
 * allergen and its severity, and in the menu cross-check, where it can name the
 * dish. Both are places a teacher can act on it.
 *
 * A family never sees it. The notes section on the page is `isStaff`-gated and
 * this badge inherits the same gate through `showHealthAlert` — a "⚠ Эрүүл
 * мэнд" chip on a parent's own child, with no way to open it, is worse than
 * nothing.
 */
export function ChildHeroProfile({
  child,
  actions,
  showHealthAlert = false,
  canEditPhoto = false,
}: {
  child: ChildDetail;
  actions?: ReactNode;
  /** Staff only. See the note above. */
  showHealthAlert?: boolean;
  /**
   * Shows the camera badge that changes the profile picture.
   *
   * Passed rather than derived: this component is rendered from the child's
   * own page, which already knows the viewer's role, and a second derivation
   * here is a second place for the two to disagree.
   */
  canEditPhoto?: boolean;
}) {
  // Newest first (`startedOn: "desc"`), and ACTIVE is what "current" means —
  // a child who has left still has a most-recent enrollment.
  const current = child.enrollments?.find((e) => e.status === "ACTIVE") ?? child.enrollments?.[0];
  const hasHealthNote = showHealthAlert && Boolean(child.healthNotes);

  const facts = [
    formatAge(child.dateOfBirth),
    child.sex ? SEX_LABEL[child.sex] : null,
    current?.group?.name,
  ].filter(Boolean);

  return (
    <Card pad="roomy">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
        {/*
          `relative`, so the camera badge can hang off the avatar's corner —
          see `ChildPhotoButton`. The wrapper is what carries the positioning
          context; `ChildAvatar` itself is unchanged and still used flat in the
          roster, the feeds and the birthday list.
        */}
        {/*
          ★ REDESIGN 2026-09-03 — 72px → 88px.

          This is the one screen that is about a *person*, and the brief calls
          the portfolio hanging off it the emotional centre of the product. A
          72px avatar sitting inline with the badges made the header read like
          a database row with a thumbnail. The larger portrait gives the child
          top billing, which is the hierarchy this screen should have.

          ★★ The `ring-4 ring-primary-soft` that shipped with that redesign is
          gone — 2026-09-09, on the client's instruction, after they read the
          uploaded photograph as failing to fill its circle.

          It was not: the photograph filled all 88px and the ring was 4px of
          `primary-soft` drawn *outside* it. But `primary-soft` against a white
          card is barely a colour, so the halo read as a gap rather than as a
          frame — and a decoration that people report as a bug is not doing the
          job it was added for. Size alone carries the billing now.
        */}
        <div className="relative shrink-0">
          <ChildAvatar child={child} size={88} />
          {canEditPhoto ? (
            <ChildPhotoButton childId={child.id} childName={fullName(child)} />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/*
              `break-words`, not `truncate`. A Mongolian full name is long and
              this is the one place it must be readable in full — the header
              whose entire job is to say which child you are looking at.
            */}
            <h1 className="min-w-0 break-words text-heading font-semibold tracking-[-.01em] text-ink sm:text-display">
              {fullName(child)}
            </h1>

            {/*
              The label carries the state; the tint only reinforces it.

              ★ Four states, not a boolean. Order А/261, Annex 2 §1 item 7 asks
              a kindergarten to distinguish a child who is away with permission
              from one who has left, and this header used to render both as
              "Архивласан" — the same grey badge for a child coming back on
              Monday and a child who moved to another city.
            */}
            <Badge tone={STATUS_TONE[child.status ?? "ACTIVE"] ?? "neutral"}>
              {CHILD_STATUS_LABEL[child.status ?? "ACTIVE"] ?? CHILD_STATUS_LABEL.ACTIVE}
            </Badge>

            {/*
              ★ Гадаад иргэн, beside the status rather than buried in a field.
              It changes which identifier the record carries — a foreign child
              has no регистр and never will — so it belongs where somebody sees
              it before they go looking for one.
            */}
            {child.isForeign ? (
              <Badge tone="sky">Гадаад иргэн{child.foreignId ? ` · ${child.foreignId}` : ""}</Badge>
            ) : null}

            {hasHealthNote ? (
              <Badge tone="peach">
                <HeartPulse size={13} aria-hidden="true" />
                Эрүүл мэндийн тэмдэглэлтэй
              </Badge>
            ) : null}
          </div>

          {facts.length > 0 ? (
            <p className="mt-1 text-body text-muted">{facts.join(" · ")}</p>
          ) : null}

          <p className="mt-0.5 text-caption text-muted">
            Төрсөн: {formatDate(child.dateOfBirth)}
            {current?.schoolYear?.name ? ` · ${current.schoolYear.name}` : ""}
          </p>
        </div>

        {actions ? <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div> : null}
      </div>
    </Card>
  );
}
