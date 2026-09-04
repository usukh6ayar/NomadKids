"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { z } from "zod";
import { INCIDENT_KIND_LABEL, INCIDENT_KINDS, incidentSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { CheckControl, Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";

const listSchema = z.array(incidentSchema);

/**
 * Safety incidents — RFP Module 2.1.
 *
 * ★ A family reads this list, including entries that have not been reported yet.
 *
 * `reportedAt` records whether a notice was *sent*, not whether the record is
 * visible. A parent opening the app before the teacher has written the message
 * must not find their child's injury hidden from them — the module is about
 * telling families quickly, not about staging what they may know. What is
 * staff-only is *recording* and *reporting*.
 */
export function ChildIncidents({ childId, isStaff }: { childId: string; isStaff: boolean }) {
  const [adding, setAdding] = useState(false);

  const incidents = useQuery({
    queryKey: qk.incidents(childId),
    queryFn: () => get(`/children/${childId}/incidents`, listSchema),
  });

  if (incidents.isPending) return <LoadingState rows={3} />;
  if (incidents.isError) return <ErrorState description={errorMessage(incidents.error)} />;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Аюулгүй байдлын тэмдэглэл"
        action={
          isStaff && !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              Тохиолдол бүртгэх
            </Button>
          ) : null
        }
      />

      {adding ? <IncidentForm childId={childId} onDone={() => setAdding(false)} /> : null}

      {incidents.data.length === 0 && !adding ? (
        <EmptyState
          title="Тохиолдол бүртгэгдээгүй"
          description={
            isStaff
              ? "Гэмтэл, уналт зэрэг тохиолдлыг цаг алдалгүй бүртгэнэ үү."
              : "Одоогоор бүртгэгдсэн тохиолдол алга байна."
          }
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {incidents.data.map((incident) => (
          <IncidentCard key={incident.id} childId={childId} incident={incident} isStaff={isStaff} />
        ))}
      </ul>
    </div>
  );
}

function IncidentCard({
  childId,
  incident,
  isStaff,
}: {
  childId: string;
  incident: z.infer<typeof incidentSchema>;
  isStaff: boolean;
}) {
  const [reporting, setReporting] = useState(false);

  return (
    <li>
      <Card pad="roomy" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldAlert
            size={18}
            aria-hidden="true"
            className={incident.isHighPriority ? "shrink-0 text-danger" : "shrink-0 text-muted"}
          />
          <span className="text-body font-medium text-ink">
            {INCIDENT_KIND_LABEL[incident.kind] ?? incident.kind}
          </span>
          {incident.isHighPriority ? <Badge tone="danger">Яаралтай</Badge> : null}

          {/*
            The reported state is shown to everyone, including the family: "we
            have told you" and "we have not told you yet" are both facts a
            parent is entitled to see about their own child's record.
          */}
          {incident.reportedAt ? (
            <Badge tone="mint">Мэдэгдсэн</Badge>
          ) : (
            <Badge tone="sun">Мэдэгдээгүй</Badge>
          )}

          <span className="ml-auto text-caption text-muted">
            {formatRelative(incident.occurredAt)}
          </span>
        </div>

        <p className="whitespace-pre-wrap text-body text-ink">{incident.description}</p>

        <dl className="grid gap-x-4 gap-y-1 text-caption sm:grid-cols-2">
          {incident.location ? (
            <div className="flex gap-1.5">
              <dt className="text-muted">Байршил:</dt>
              <dd className="text-ink">{incident.location}</dd>
            </div>
          ) : null}
          {incident.bodyPart ? (
            <div className="flex gap-1.5">
              <dt className="text-muted">Биеийн хэсэг:</dt>
              <dd className="text-ink">{incident.bodyPart}</dd>
            </div>
          ) : null}
          {incident.firstAid ? (
            <div className="flex gap-1.5">
              <dt className="text-muted">Авсан арга хэмжээ:</dt>
              <dd className="text-ink">{incident.firstAid}</dd>
            </div>
          ) : null}
          {incident.followUp ? (
            <div className="flex gap-1.5">
              <dt className="text-muted">Дараагийн хяналт:</dt>
              <dd className="text-ink">{incident.followUp}</dd>
            </div>
          ) : null}
        </dl>

        {/*
          The report button appears only while it is still possible: the API
          refuses a second report, so showing it afterwards would offer an
          action that always fails.
        */}
        {isStaff && !incident.reportedAt ? (
          reporting ? (
            <ReportForm childId={childId} incident={incident} onDone={() => setReporting(false)} />
          ) : (
            <Button size="sm" className="self-start" onClick={() => setReporting(true)}>
              Эцэг эхэд мэдэгдэх
            </Button>
          )
        ) : null}
      </Card>
    </li>
  );
}

/**
 * The message is written by the teacher, not generated from the incident.
 *
 * A machine-composed "Таны хүүхэд уналт болсон" is both colder and less
 * accurate than what the person who was there would say, and this is the
 * sentence a parent remembers. The fields are prefilled as a starting point,
 * not as the final text.
 */
function ReportForm({
  childId,
  incident,
  onDone,
}: {
  childId: string;
  incident: z.infer<typeof incidentSchema>;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(INCIDENT_KIND_LABEL[incident.kind] ?? "Тохиолдол");
  const [body, setBody] = useState(incident.description);

  const send = useMutation({
    mutationFn: () =>
      mutate(`/incidents/${incident.id}/report`, z.unknown(), {
        method: "POST",
        body: { title: title.trim(), body: body.trim() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.incidents(childId) });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      onDone();
    },
  });

  const errors = fieldErrors(send.error);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!send.isPending) send.mutate();
      }}
      className="flex flex-col gap-3 rounded-control border border-border bg-canvas p-3.5"
      noValidate
    >
      <FormError
        message={send.isError && Object.keys(errors).length === 0 ? errorMessage(send.error) : null}
      />

      <p className="text-caption text-muted">
        Энэ мэдэгдэл зөвхөн энэ хүүхдийн гэр бүлд очно. Ангийн самбарт харагдахгүй.
      </p>

      <Field label="Гарчиг" error={errors.title} required>
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

      <Field label="Мэдэгдлийн текст" error={errors.body} required>
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={send.isPending}>
          {send.isPending ? "Илгээж байна…" : "Илгээх"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onDone}>
          Цуцлах
        </Button>
      </div>
    </form>
  );
}

function IncidentForm({ childId, onDone }: { childId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  // `datetime-local` wants `YYYY-MM-DDTHH:MM` in local time, and defaulting to
  // now is right: an incident is recorded while it is still fresh.
  const now = new Date();
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  const [kind, setKind] = useState<string>("FALL");
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [location, setLocation] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [description, setDescription] = useState("");
  const [firstAid, setFirstAid] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [isHighPriority, setIsHighPriority] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/incidents`, incidentSchema, {
        method: "POST",
        body: {
          kind,
          // Sent as a real instant: the input is local time, and the API stores
          // and compares in UTC.
          occurredAt: new Date(occurredAt).toISOString(),
          location: location.trim() || null,
          bodyPart: bodyPart.trim() || null,
          description: description.trim(),
          firstAid: firstAid.trim() || null,
          followUp: followUp.trim() || null,
          isHighPriority,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.incidents(childId) });
      onDone();
    },
  });

  const errors = fieldErrors(save.error);

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
                {INCIDENT_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {INCIDENT_KIND_LABEL[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Огноо, цаг" error={errors.occurredAt} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="datetime-local"
                max={localNow}
                aria-describedby={describedBy}
                invalid={invalid}
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            )}
          </Field>

          <Field label="Байршил" error={errors.location}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                placeholder="Тоглоомын талбай"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            )}
          </Field>

          <Field label="Биеийн аль хэсэг" error={errors.bodyPart}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                placeholder="Зүүн өвдөг"
                value={bodyPart}
                onChange={(e) => setBodyPart(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Тайлбар" error={errors.description} required>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>

        <Field label="Авсан анхан шатны арга хэмжээ" error={errors.firstAid}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={2}
              value={firstAid}
              onChange={(e) => setFirstAid(e.target.value)}
            />
          )}
        </Field>

        <Field label="Дараагийн хяналт" error={errors.followUp}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={2}
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
            />
          )}
        </Field>

        {/*
          A plain checkbox, unchecked by default. RFP Module 2.1 asks that the
          serious ones be flagged; a default of "urgent" would make the flag
          mean nothing within a week.
        */}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5">
          {/*
            ★ `CheckControl`, not a bare `<input>` — 2026-09-04.

            This was the last hand-rolled checkbox in the product and it had
            drifted twice over: 16px where every other one is 20px, and square
            where they are now rounded. One drawing, so a control cannot look
            like a different kind of control depending on which screen it is on.

            The danger tone survives the move. It is the one checkbox here whose
            colour carries meaning — this flag pages the director — and
            `cn`'s tailwind-merge lets the checked colours be overridden without
            the component growing a `tone` prop for a single call site.
          */}
          <CheckControl
            className="checked:border-danger checked:bg-danger"
            checked={isHighPriority}
            onChange={(e) => setIsHighPriority(e.target.checked)}
          />
          <span className="text-body text-ink">Яаралтай — удирдлага, эцэг эхэд шууд мэдэгдэх</span>
        </label>

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
