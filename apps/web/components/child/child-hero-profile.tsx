"use client";

import type { ReactNode } from "react";
import { HeartPulse } from "lucide-react";
import { SEX_LABEL, type ChildDetail } from "@kinder/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ChildAvatar } from "@/components/media/media-image";
import { formatAge, formatDate, fullName } from "@/lib/format";

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
}: {
  child: ChildDetail;
  actions?: ReactNode;
  /** Staff only. See the note above. */
  showHealthAlert?: boolean;
}) {
  // Newest first (`startedOn: "desc"`), and ACTIVE is what "current" means —
  // a child who has left still has a most-recent enrollment.
  const current = child.enrollments?.find((e) => e.status === "ACTIVE") ?? child.enrollments?.[0];
  const archived = child.status === "ARCHIVED";
  const hasHealthNote = showHealthAlert && Boolean(child.healthNotes);

  const facts = [
    formatAge(child.dateOfBirth),
    child.sex ? SEX_LABEL[child.sex] : null,
    current?.group?.name,
  ].filter(Boolean);

  return (
    <Card pad="roomy">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
        <ChildAvatar child={child} size={72} className="shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="min-w-0 truncate text-title font-semibold text-ink sm:text-heading">
              {fullName(child)}
            </h1>

            {/* The label carries the state; the tint only reinforces it. */}
            {archived ? (
              <Badge tone="neutral">Архивласан</Badge>
            ) : (
              <Badge tone="mint">Идэвхтэй</Badge>
            )}

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
