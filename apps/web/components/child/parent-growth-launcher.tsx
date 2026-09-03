"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { Eye, Images, MessageCircle, X } from "lucide-react";
import { assessmentSchema, observationSchema, type ChildDetail } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ChildMilestones } from "@/components/child/child-milestones";
import { PortfolioHero, GradientUnderline } from "@/components/child/portfolio-hero";
import { ObservationPhotos } from "@/components/observations/observation-photos";
import { GRADIENT_TONE_STYLE, type GradientTone } from "@/lib/gradient-tones";
import type { Tone } from "@/components/ui/tone";
import { todayLocal } from "@/lib/format";
import { cn } from "@/lib/utils";

const assessmentsSchema = z.array(assessmentSchema);

/**
 * The three quick-share doors — client reference screenshot, 2026-08-30.
 *
 * ★ All three submit through the exact same endpoint,
 * `POST /children/:id/parent-observations` — `createParentObservationSchema`
 * has no field that distinguishes "an observation" from "a conversation" from
 * "a piece of artwork", and inventing one wasn't asked for this pass. The
 * split is presentational: three doors into one real, working "share a
 * moment" flow, each pre-labelled for the kind of thing a parent is about to
 * write about. A later pass can give `Ярилцлага`/`Бүтээл` their own stored
 * distinction if the client asks for one; nothing here has to change shape to
 * add it, since each still posts a plain `CreateParentObservationDto`.
 */
const BUCKETS = [
  {
    key: "observation",
    label: "Ажиглалт",
    verb: "Ажиглалт нэмэх",
    tone: "green" as GradientTone,
    Icon: Eye,
  },
  {
    key: "conversation",
    label: "Ярилцлага",
    verb: "Ярилцлага нэмэх",
    tone: "blue" as GradientTone,
    Icon: MessageCircle,
  },
  {
    key: "artwork",
    label: "Бүтээл",
    verb: "Бүтээл нэмэх",
    tone: "orange" as GradientTone,
    Icon: Images,
  },
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

/** The closest match in `Card`'s own tone vocabulary — it has no green/blue/orange as such. */
const CARD_TONE_FOR_BUCKET: Record<GradientTone, Tone> = {
  green: "mint",
  blue: "sky",
  orange: "peach",
  purple: "cornflower",
  pink: "peach",
};

/**
 * The parent's "Хөгжил" page — replaces the tabbed Насны онцлог / Ажиглалт /
 * Бүтээл view for guardians only (`growth/page.tsx` still shows that
 * unchanged to staff, who still fill in the age-2–5 profile fields RFP §4.3
 * requires). A parent's job here is narrower: share what happened, and see
 * what the teacher has shared back.
 */
export function ParentGrowthLauncher({ child }: { child: ChildDetail }) {
  const [open, setOpen] = useState<BucketKey | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PortfolioHero
        child={child}
        overline="БИ ЦЭЦЭРЛЭГТЭЭ"
        title={`${child.firstName}-ийн өхөөрдөм ахиц`}
        subtitle="Багшийн хуваалцсан ажиглалт, яриа, бүтээлийг нэг дороос хараарай."
      />

      <div className="grid gap-2.5 sm:grid-cols-3">
        {BUCKETS.map((bucket) => (
          <QuickShareBar
            key={bucket.key}
            bucket={bucket}
            active={open === bucket.key}
            onClick={() => setOpen((was) => (was === bucket.key ? null : bucket.key))}
          />
        ))}
      </div>

      {open ? (
        <QuickShareForm
          childId={child.id}
          bucket={BUCKETS.find((b) => b.key === open)!}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {/*
        RFP §4.5 — carried over from the old "Насны онцлог" tab, which
        rendered this alongside `ChildGrowthAges`. It has no other route
        pointing at it (unlike Ажиглалт and Бүтээл, both linked from
        elsewhere), so removing that tab for parents would have made it
        unreachable rather than merely relocated.
      */}
      <ChildMilestones childId={child.id} isStaff={false} />

      <SharedNotesTeaser childId={child.id} />
    </div>
  );
}

function QuickShareBar({
  bucket,
  active,
  onClick,
}: {
  bucket: (typeof BUCKETS)[number];
  active: boolean;
  onClick: () => void;
}) {
  const tone = GRADIENT_TONE_STYLE[bucket.tone];

  return (
    <button
      type="button"
      aria-expanded={active}
      onClick={onClick}
      className={cn(
        "flex min-h-13 items-center gap-3 rounded-card px-3.5 py-3 text-left text-white transition-transform hover:scale-[1.01]",
        tone.gradient,
        tone.shadow,
        active && "ring-2 ring-white ring-offset-2 ring-offset-canvas",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-white/25"
      >
        <bucket.Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-body font-semibold">+ {bucket.label}</span>
    </button>
  );
}

/**
 * One text field, one textarea, one date — then a photo, once saved.
 *
 * ★ "Гарчиг" has no column of its own on `CreateParentObservationDto` — the
 * schema is deliberately narrower than the staff form (see its own doc
 * comment in `observations.dto.ts`), and adding a field for one screen was
 * not part of this pass. Rather than silently drop what a parent typed, the
 * title becomes the opening line of `situation`, which is exactly the kind of
 * free narrative that field already holds.
 *
 * ★★ The photo step happens after saving, same as the full "Гэрийн мөч
 * хуваалцах" form (`observations/new/page.tsx`) — `ObservationPhotos` needs a
 * real observation id to attach to, and this form creates one through the
 * same endpoint that page does.
 */
function QuickShareForm({
  childId,
  bucket,
  onClose,
}: {
  childId: string;
  bucket: (typeof BUCKETS)[number];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [observedOn, setObservedOn] = useState(todayLocal());
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const situation = [title.trim(), content.trim()].filter(Boolean).join("\n\n") || undefined;
      // `observationSchema`, not the request DTO — this is what the endpoint
      // hands back (id, source, reviewStatus, …), and `savedId` below needs it.
      return mutate(`/children/${childId}/parent-observations`, observationSchema, {
        method: "POST",
        body: { observedOn, situation },
      });
    },
    onSuccess: (observation) => {
      setSavedId(observation.id);
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  return (
    <Card pad="roomy" tone={CARD_TONE_FOR_BUCKET[bucket.tone]}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lead font-semibold text-ink">{bucket.verb}</h2>
          <GradientUnderline className="mt-1" />
          <p className="mt-2 text-body text-muted">Аав, ээжийн ажигласан мөчийг тэмдэглээрэй.</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Хаах" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </Button>
      </div>

      {savedId ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="font-medium text-mint-ink">
            Хадгаллаа. Багш хянаад баталгаажуулна.
          </p>
          <ObservationPhotos childId={childId} observationId={savedId} />
          <Button variant="secondary" onClick={onClose} className="self-start">
            Дуусгах
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending) save.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError
            message={
              save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Огноо" error={errors.observedOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={observedOn}
                  max={todayLocal()}
                  onChange={(e) => setObservedOn(e.target.value)}
                  required
                />
              )}
            </Field>

            <Field label="Гарчиг">
              {({ id }) => (
                <Input
                  id={id}
                  value={title}
                  placeholder="Жишээ: Өнөөдрийн хөөрхөн мөч"
                  onChange={(e) => setTitle(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label="Агуулга" error={errors.situation}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={content}
                placeholder="Юу хийсэн, ямар шинэ зүйл ажиглагдсан бэ?"
                onChange={(e) => setContent(e.target.value)}
              />
            )}
          </Field>

          {/*
            No picker here yet — see this component's own doc comment. The
            dashed box names the step so it does not read as a missing one.
          */}
          <div>
            <span className="mb-1.5 block text-body font-medium text-ink">Зураг / баримт</span>
            <div className="rounded-control border border-dashed border-border bg-canvas px-3.5 py-3 text-body text-muted">
              Хадгалсны дараа зураг нэмэх боломжтой.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Болих
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/**
 * "Хүүхдийн тэмдэглэлүүд" — the assessments a teacher has published to this
 * family. Reuses `GET /children/:id/assessments` wholesale: it already
 * answers only `visibleToParents: true` rows for a guardian actor
 * (`assessment.repository.ts`), so there is nothing left for this component
 * to filter.
 */
function SharedNotesTeaser({ childId }: { childId: string }) {
  const assessments = useQuery({
    queryKey: qk.childAssessments(childId),
    queryFn: () => get(`/children/${childId}/assessments`, assessmentsSchema),
  });

  return (
    <section aria-labelledby="shared-notes-heading">
      <h2 id="shared-notes-heading" className="text-lead font-semibold text-ink">
        Хүүхдийн тэмдэглэлүүд
      </h2>
      <GradientUnderline className="mt-1.5" />
      <p className="mt-2 mb-3 text-body text-muted">
        Багш болон эцэг эхийн тэмдэглэлийг улирал, сараар харуулж байна.
      </p>

      {assessments.isPending ? <LoadingState rows={2} /> : null}
      {assessments.isError ? <ErrorState description={errorMessage(assessments.error)} /> : null}

      {!assessments.isPending && !assessments.isError ? (
        assessments.data.length === 0 ? (
          <EmptyState
            title="Одоогоор хуваалцсан үнэлгээ алга"
            description="Багш явцын үнэлгээг хуваалцах үед энэ хэсэгт автоматаар орж ирнэ."
          />
        ) : (
          <Card className="divide-y divide-border">
            {assessments.data.slice(0, 5).map((assessment) => (
              <Link
                key={assessment.id}
                href={`/children/${childId}/assessments`}
                className="flex min-h-15 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-canvas"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {assessment.domain?.name ?? "Хөгжлийн чиглэл"}
                  </p>
                  <p className="truncate text-body text-muted">{assessment.term?.name}</p>
                </div>
                <span className="shrink-0 text-body font-semibold text-primary">
                  {assessment.level?.label}
                </span>
              </Link>
            ))}
          </Card>
        )
      ) : null}
    </section>
  );
}
