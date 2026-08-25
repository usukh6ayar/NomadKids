"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Star } from "lucide-react";
import { z } from "zod";
import { MILESTONE_KIND_LABEL, MILESTONE_KINDS, milestoneSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PhotoUpload } from "@/components/media/photo-upload";
import { MediaThumb } from "@/components/media/media-image";

const listSchema = z.array(milestoneSchema);

/**
 * Remembered firsts — RFP §4.5, "Онцгой үйл явдал".
 *
 * ★ A family's section, not a teacher's.
 *
 * The form is open to guardians because RFP §2.3 puts milestone recording under
 * what a parent does, and the API agrees. What differs by role is *editing*: a
 * guardian may correct only what they wrote, so the edit control appears on
 * their own entries and on all of them for staff. Rendering a button that
 * always 404s teaches people the app is broken.
 */
export function ChildMilestones({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  const { session } = useSession();
  const [adding, setAdding] = useState(false);

  const milestones = useQuery({
    queryKey: qk.milestones(childId),
    queryFn: () => get(`/children/${childId}/milestones`, listSchema),
  });

  if (milestones.isPending) return <LoadingState rows={3} />;
  if (milestones.isError) return <ErrorState description={errorMessage(milestones.error)} />;

  return (
    <section aria-labelledby="milestones-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="milestones-heading"
        title="Онцгой үйл явдал"
        action={
          !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> Нэмэх
            </Button>
          ) : null
        }
      />

      {adding ? <MilestoneForm childId={childId} onDone={() => setAdding(false)} /> : null}

      {milestones.data.length === 0 && !adding ? (
        <EmptyState
          title="Тэмдэглэсэн үйл явдал алга"
          description="Анхны алхам, анхны үг зэрэг дурсамжтай мөчийг тэмдэглэж үлдээгээрэй."
        />
      ) : null}

      <ol className="flex flex-col gap-3">
        {milestones.data.map((milestone) => (
          <MilestoneCard
            key={milestone.id}
            childId={childId}
            milestone={milestone}
            canEdit={isStaff || milestone.recordedBy?.id === session?.user.id}
          />
        ))}
      </ol>
    </section>
  );
}

function MilestoneCard({
  childId,
  milestone,
  canEdit,
}: {
  childId: string;
  milestone: z.infer<typeof milestoneSchema>;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => mutate(`/milestones/${milestone.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.milestones(childId) }),
  });

  // The family's own words win over the suggested label — that is what `title`
  // is for on a non-CUSTOM kind.
  const heading = milestone.title?.trim() || MILESTONE_KIND_LABEL[milestone.kind] || milestone.kind;

  return (
    <li>
      <Card pad="roomy" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <Star size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sun-ink" />
            <div>
              <h3 className="text-body font-medium text-ink">{heading}</h3>
              <p className="text-caption text-muted">{formatDate(milestone.occurredOn)}</p>
            </div>
          </div>

          {canEdit ? (
            confirming ? (
              <span className="flex items-center gap-2">
                <span className="text-caption text-muted">Устгах уу?</span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Тийм
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                  Үгүй
                </Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                Устгах
              </Button>
            )
          ) : null}
        </div>

        <FormError message={remove.isError ? errorMessage(remove.error) : null} />

        {milestone.description ? (
          <p className="whitespace-pre-wrap text-body text-ink">{milestone.description}</p>
        ) : null}

        {milestone.media.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {milestone.media.map((photo) => (
              <li key={photo.id}>
                <MediaThumb
                  mediaId={photo.id}
                  caption={photo.caption ?? heading}
                  className="h-20 w-20"
                />
              </li>
            ))}
          </ul>
        ) : null}

        {canEdit ? (
          <PhotoUpload
            childId={childId}
            purpose="MILESTONE"
            milestoneId={milestone.id}
            label="Зураг нэмэх"
            variant="secondary"
            hint={null}
          />
        ) : null}
      </Card>
    </li>
  );
}

function MilestoneForm({ childId, onDone }: { childId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [kind, setKind] = useState<string>("FIRST_STEP");
  const [title, setTitle] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [description, setDescription] = useState("");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/milestones`, milestoneSchema, {
        method: "POST",
        body: {
          kind,
          title: title.trim() || null,
          occurredOn,
          description: description.trim() || null,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.milestones(childId) });
      onDone();
    },
  });

  const errors = fieldErrors(save.error);
  const isCustom = kind === "CUSTOM";

  return (
    <Card pad="roomy">
      <form
        onSubmit={(e) => {
          e.preventDefault();
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
          <Field label="Юу болсон бэ?" error={errors.kind} required>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {MILESTONE_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {MILESTONE_KIND_LABEL[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Огноо" error={errors.occurredOn} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                max={today}
                aria-describedby={describedBy}
                invalid={invalid}
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
              />
            )}
          </Field>
        </div>

        {/*
          Required only for a custom event, which is exactly what the API
          enforces — a CUSTOM row with no title renders as the generic label and
          tells the family nothing about their own memory. On a named kind it
          stays optional, where it overrides the suggested wording.
        */}
        <Field
          label={isCustom ? "Үйл явдлын нэр" : "Өөрийн үг (заавал биш)"}
          error={errors.title}
          required={isCustom}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>

        <Field label="Тайлбар" error={errors.description}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>

        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Цуцлах
          </Button>
        </div>
      </form>
    </Card>
  );
}
