"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import { userProfileSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { useMyGroup } from "./use-my-group";
import { Art } from "@/components/ui/art";

/**
 * Who is looking, and at which group — the sketch's top-left block.
 *
 * ★ It names the group instead of offering a way to change it. One teacher is
 * responsible for one group, so "Бага бүлэг" is a statement of fact, not a
 * control. A switcher here would imply a second group exists to switch to.
 *
 * ★★ Not `PageHeader`, and not a change to it.
 *
 * `PageHeader` is shared by every screen in the product and carries the h1, the
 * search field and the action menu. This is a dashboard-only band that sits
 * under it. Folding an avatar and a group name into the shared component would
 * put them on twenty-six other screens that have no group and no reason to
 * greet anyone.
 *
 * ★★★ Two shortcuts live here rather than in a separate card.
 *
 * Attendance and assessment both need a group to start, which is why neither
 * has a top-level menu entry — and this is the one place on the screen where
 * the group is already named, so the actions cost no extra chrome. The
 * attendance link is the same destination the register card's footer offers;
 * two doors to a daily task is deliberate, not a duplicate.
 *
 * ★★★★ Tinted, with a drawing, and still one band tall.
 *
 * The band was a white card identical to the eight below it, which is the
 * "wall of identical cards" the visual pass was asked to break. It takes the
 * `sky` wash — `tone.ts`'s "information", which is what a greeting is — and
 * `mascot-teacher.webp`, the same drawing `/notifications` and the empty
 * survey already use for this person. The mascot is `alt=""`: it repeats the
 * teacher's own name and avatar beside it.
 *
 * What it does **not** do is grow. The brief's own limit — "do not make the
 * hero enormous" — is the reason the drawing appears only from `lg` up, at
 * 72px, in space the actions leave over. At 390px the card is an avatar, a
 * name, a group chip and two full-width buttons, which is the whole content;
 * a hero that pushes today's register below the fold on a phone has cost the
 * teacher the one thing they opened the screen for.
 */
export function TeacherHero() {
  const { group, count, isLoading: groupLoading } = useMyGroup();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", userProfileSchema),
  });

  /*
   * ★ The skeleton holds the real height, not a generic bar.
   *
   * This band sits at the very top, so a skeleton shorter than the content
   * pushes the entire dashboard down the instant either query resolves. 64px
   * is the avatar; the two text lines fit inside it.
   */
  if (profileLoading || groupLoading) {
    return (
      <Card tone="sky" pad="roomy" className="flex items-center gap-4">
        <Skeleton className="size-16 shrink-0 rounded-pill" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </Card>
    );
  }

  /*
   * A failed profile is not an error block. The dashboard below it is entirely
   * readable without knowing the teacher's own name, and an alert at the top of
   * the screen for a cosmetic greeting would bury the sections that matter.
   */
  if (!profile) return null;

  const name = [profile.lastName, profile.firstName].filter(Boolean).join(" ");

  return (
    <Card
      tone="sky"
      pad="roomy"
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-center gap-3.5">
        {/*
          A white ring around the avatar. On a tinted card the photo would
          otherwise sit directly on the wash and read as part of it; the ring
          is what keeps the person separate from the surface they are on.
        */}
        <ChildAvatar child={profile} size={56} className="ring-2 ring-surface sm:size-16" />

        <div className="min-w-0">
          <p className="text-caption font-medium text-sky-ink">Багшийн самбар</p>
          <p className="truncate text-title font-semibold leading-heading text-ink">
            {name || "Багш"}
          </p>

          {/*
            The group is the subject of everything below, so it is a chip
            rather than another grey line — and it degrades honestly. A teacher
            with no group assigned yet sees that stated, not an empty space
            that looks like a loading failure.
          */}
          {group ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              {/*
                `bg-surface`, not `bg-primary-soft`. The soft blue is a tint on
                white; on the hero's own sky wash it is a shade of the card and
                the chip stops being a chip. White is the one background that
                is a step *away* from every accent.
              */}
              <span className="inline-flex items-center rounded-pill bg-surface px-2.5 py-0.5 text-caption font-medium text-primary">
                {group.name}
              </span>
              {group.ageBand ? (
                <span className="text-caption text-muted">{group.ageBand}</span>
              ) : null}
              {/*
                Only ever shown when the data contradicts the one-group rule —
                an admin, or a teacher covering a second group. Silence in the
                normal case; a fact in the case the screen was not designed for.
              */}
              {count > 1 ? (
                <span className="text-caption text-muted">· +{count - 1} бүлэг</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-1 text-caption text-muted">Бүлэг хуваарилаагүй байна</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {group ? (
          <div className="flex flex-wrap gap-2">
            <HeroAction
              href={`/groups/${group.id}/attendance`}
              icon={<Art name="attendance" size={20} className="size-5" />}
              label="Ирц бүртгэх"
            />
            <HeroAction
              href={`/groups/${group.id}/assessment`}
              icon={<Art name="progress" size={20} className="size-5" />}
              label="Үнэлгээ"
            />
          </div>
        ) : null}

        {/*
          ★ `lg` and up only, and that is a width decision rather than a taste
          one. Below it the actions already fill the row the mascot would have
          to share, so the drawing would either push them onto a third line or
          shrink them under the 44px tap floor. A greeting is not worth either.
        */}
        <Image
          src="/background/mascot-teacher.webp"
          alt=""
          width={72}
          height={72}
          className="hidden shrink-0 lg:block"
        />
      </div>
    </Card>
  );
}

/**
 * A quiet link that still meets the 44px tap floor.
 *
 * Not `Button` with `variant="secondary"`: two filled controls beside the
 * teacher's own name read as the loudest thing on the screen, and the loudest
 * thing on this screen should be the attendance figure.
 *
 * ★ White, not transparent, since the card gained its wash. A bordered
 * transparent control on a tinted surface has the tint showing through it, so
 * the button reads as part of the card rather than as something you press.
 */
function HeroAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-[44px] items-center gap-2 rounded-control border border-border bg-surface px-3.5 py-2 text-body font-medium text-ink shadow-sm transition-colors hover:border-primary hover:text-primary"
    >
      {icon}
      {label}
    </Link>
  );
}
