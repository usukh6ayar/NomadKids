"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight, FileText, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { childDetailSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ReportDialog } from "@/components/reports/report-dialog";
import { PORTFOLIO } from "@/lib/vocabulary";
import { Art, type ArtName } from "@/components/ui/art";
import { FormDialog } from "@/components/ui/form-dialog";
import { Textarea } from "@/components/ui/field";
import { useSession } from "@/lib/auth/session";
import { useToast } from "@/components/ui/toast";

/**
 * The portfolio — RFP §4.3.
 *
 * ★ A hero card and doors, not a single long scroll — 2026-08-29, on
 * the client's instruction, with a reference screenshot of exactly this hub.
 * Everything the old single-scroll page rendered inline still exists; it
 * moved to whichever door now owns it:
 *
 *  - "Миний тухай" → `portfolio/about-me/page.tsx` — identity, the birth-date
 *    facts (Монгол жил / Одны орд) and the birthday notes.
 *  - "Хөгжил" → `portfolio/growth/page.tsx` — ages 2–5, milestones, and quick
 *    actions into Ажиглалт and Бүтээл.
 *  - "Зургийн цомог" → `portfolio/gallery/page.tsx`, where a parent chooses an
 *    age before opening that age's category albums. It used to be `/overview`,
 *    the bottom bar's own "Зураг" destination; that is still one album reached
 *    two ways, but the portfolio's own entrance now keeps the portfolio
 *    breadcrumb and sidebar state for the whole album flow.
 *  - "Насны харьцуулалт" → `portfolio/growth/age/page.tsx` — added
 *    2026-09-04, on the client's instruction, when the age pills and "Бүх
 *    насыг харьцуулах" bar were pulled out of `about-me/page.tsx`'s merged
 *    card. This tile is now the one door in; the landing is navigation-only,
 *    and `AgeStepper` carries a visitor on from there to any of the five
 *    age/compare pages.
 *
 * The PDF button stays here: `type: "CHILD_PORTFOLIO"` exports this whole
 * record, not any one door of it, so it belongs on the hub the doors share
 * rather than on one of them.
 */
export default function PortfolioPage() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
  });

  if (child.isLoading) return <LoadingState rows={4} />;

  if (child.isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(child.error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={
            isNotFound(child.error) ? `${PORTFOLIO} олдсонгүй.` : errorMessage(child.error)
          }
          action={
            <Button asChild variant="secondary">
              <Link href="/children">Жагсаалт руу буцах</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const data = child.data!;
  const profileArt =
    data.sex === "FEMALE" ? "portfolioGirl" : data.sex === "MALE" ? "portfolioBoy" : null;

  return (
    <div className="flex flex-col gap-6 py-2">
      <section
        aria-labelledby="portfolio-heading"
        className="flex h-28 w-full items-center justify-between gap-5 overflow-hidden rounded-card border border-gray-100 bg-gradient-to-r from-white to-gray-100/80 px-6 shadow-sm"
      >
        <BackButton href={`/children/${childId}/general`} />
        <h1 id="portfolio-heading" className="min-w-0 flex-1 text-title font-bold text-gray-800">
          {PORTFOLIO}
        </h1>
        {profileArt ? (
          <span
            aria-hidden="true"
            data-testid="portfolio-profile-art"
            className="relative flex h-full w-32 shrink-0 items-end justify-center overflow-hidden bg-transparent"
          >
            <Art
              name={profileArt}
              size={160}
              className="h-40 w-auto max-w-none object-contain object-bottom"
            />
          </span>
        ) : null}
      </section>

      <div className="flex justify-end">
        <ReportDialog
          childId={childId}
          trigger={
            <Button variant="secondary" size="sm">
              <FileText size={18} />
              PDF татах
            </Button>
          }
        />
      </div>

      <GraduationLetter childId={childId} />

      <PortfolioHubNav childId={childId} />
    </div>
  );
}

const graduationLetterSchema = z.object({ letter: z.string().nullable() });

/** Staff write the one closing letter here; it is not an age-profile note. */
function GraduationLetter({ childId }: { childId: string }) {
  const { hasRole } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");
  const [open, setOpen] = useState(false);
  const [letter, setLetter] = useState("");
  const queryKey = ["children", childId, "graduation-letter"] as const;
  const letterQuery = useQuery({
    queryKey,
    queryFn: () => get(`/children/${childId}/graduation-letter`, graduationLetterSchema),
    enabled: isStaff,
  });

  useEffect(() => {
    if (open) setLetter(letterQuery.data?.letter ?? "");
  }, [open, letterQuery.data?.letter]);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/graduation-letter`, graduationLetterSchema, {
        method: "PATCH",
        body: { letter: letter.trim() || null },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      toast.success("Багшийн захиа хадгалагдлаа.");
      setOpen(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!isStaff) return null;

  return (
    <>
      <section className="flex flex-col gap-3 rounded-card border border-[#f3dfaa] bg-[#fffaf0] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-[#ffeab7] text-[#95661c]">
            <Mail size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-ink">Багшийн захиа</h2>
            <p className="mt-0.5 text-body text-muted">
              5 нас / төгсөлтийн үед бичнэ. PDF-ийн хамгийн сүүлийн хуудсанд орно.
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {letterQuery.data?.letter ? "Захиа засах" : "Захиа бичих"}
        </Button>
      </section>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Багшийн захиа"
        description="Төгсөлтийн захиа нь нас тус бүрийн багшийн тэмдэглэлээс тусдаа хадгалагдана."
        busy={save.isPending}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.isPending}>
              Цуцлах
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <Textarea
          aria-label="Төгсөлтийн багшийн захиа"
          value={letter}
          maxLength={3500}
          rows={12}
          placeholder="Хайрт сурагчдаа…"
          onChange={(event) => setLetter(event.target.value)}
        />
        <p className="mt-1 text-right text-caption text-faint">{letter.length}/3500</p>
      </FormDialog>
    </>
  );
}

/**
 * Миний тухай / Хөгжил / Зургийн цомог / Насны харьцуулалт — real routes, on
 * the client's instruction, with a reference screenshot of this exact tile
 * row (the fourth tile added 2026-09-04, see this file's own doc comment).
 *
 * ★ Routes, not in-page anchors. This nav used to hold `#about-me`/`#growth`/
 * `#gallery` — anchors into the sections it now replaces — with a doc comment
 * noting dedicated routes were "follow-up work the client asked for
 * separately". That follow-up is this change.
 *
 * ★★ `grid-cols-2`, not `grid-cols-3` — CLAUDE.md §5's mobile-first rule.
 * Four labels this long ("Насны харьцуулалт") lose their two-line balance in
 * three narrow columns on a 375px screen; two wider ones keep every label
 * readable without truncation.
 *
 * ★★★ All four destinations' own back buttons return here now — unified
 * 2026-09-04, on the client's instruction, after each had drifted to a
 * different target (`/home`, `growth/page.tsx`, this hub, or nothing at all).
 * The album no longer needs the `?from=portfolio` marker that told
 * `overview/page.tsx` apart from the bottom bar's own "Зураг" tab: the
 * portfolio has its own `gallery` entrance now, so there is only one way in
 * from here and only one way back.
 */
function PortfolioHubNav({ childId }: { childId: string }) {
  // ★ Order: Миний тухай, Хөгжил, Зургийн цомог, Насны харьцуулалт — the
  // client's requested sequence, 2026-09-09.
  const items: { href: string; label: string; art: ArtName }[] = [
    {
      href: `/children/${childId}/portfolio/about-me`,
      label: "Миний тухай",
      art: "portfolioAboutMe",
    },
    {
      href: `/children/${childId}/portfolio/growth`,
      // «Явцын үнэлгээ», for a family and a teacher alike — client, 2026-10-07.
      label: "Явцын үнэлгээ",
      art: "portfolioDevelopment",
    },
    // This portfolio-specific route starts with age cards and keeps the
    // portfolio breadcrumb/sidebar state active throughout the album flow.
    {
      href: `/children/${childId}/portfolio/gallery`,
      label: "Зургийн цомог",
      art: "portfolioGallery",
    },
    // The landing is navigation-only; details appear only after choosing the
    // comparison action or one of the four age folders.
    {
      href: `/children/${childId}/portfolio/growth/age`,
      label: "Насны харьцуулалт",
      art: "portfolioAgeComparison",
    },
  ];

  /*
    ★ REDESIGN 2026-09-03 — the tiles became cards.

    This is the emotional centre of the family's experience and the brief asks
    it to carry the most design care. The four owner-supplied illustrations now
    identify the destinations directly, without a second tinted disc behind
    their already-coloured transparent artwork. The card remains the tap target
    and the chevron says it opens something.

    `items-stretch` on the grid so all four cards match height whatever their
    label wraps to — "Зургийн цомог" wraps at 375px and the other two do not.
  */
  return (
    <nav aria-label="Цахим хавтасны хэсгүүд">
      {/*
        ★★ Two across on a phone, four from `sm` — 2026-09-04, when the
        comparison tile made this a row of four.

        Three columns at 375px gave each tile about 108px, and "Насны
        харьцуулалт" is two words that wrap to three lines in it. Two columns
        is 168px, which holds the longest label on two lines and keeps the
        64px disc from crowding it.
      */}
      <ul className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-4 sm:gap-3">
        {items.map(({ href, label, art }) => (
          <li key={href} className="flex">
            <Link
              href={href}
              className="card-interactive flex w-full flex-col items-center gap-2.5 rounded-card border border-border bg-surface px-2 py-4 text-center shadow-sm sm:px-3 sm:py-5"
            >
              <span aria-hidden="true" className="flex size-16 items-center justify-center">
                <Art name={art} size={56} className="size-14 object-contain" />
              </span>
              <span className="text-body font-semibold leading-snug text-ink">{label}</span>
              <ChevronRight size={16} aria-hidden="true" className="text-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
