"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileBadge, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { STAFF_RECORD_KIND_LABEL, staffRecordSchema, type StaffRecord } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

const staffRecordListSchema = z.array(staffRecordSchema);

/**
 * Ажилтны туршлага, гэрчилгээ, зэрэг — Order А/261, шалгуур 51.
 *
 * ★ A dialog on the user row rather than a screen of its own.
 *
 * Every question this answers is asked *about a person the administrator is
 * already looking at* — "is this teacher's certificate still valid", "how long
 * have they taught". A separate route would mean finding the same person twice.
 *
 * ★★ The endpoint is `GET /kindergartens/:id/staff/:userId/records`, and the
 * kindergarten is the one whose staff list this row came from. A person may
 * work at two, and each keeps its own file: this screen shows *ours*, which is
 * the only one an administrator here may see.
 */
export function StaffRecordsButton({
  user,
  kindergartenId,
}: {
  user: { id: string; lastName: string; firstName: string };
  kindergartenId: string | null;
}) {
  const [open, setOpen] = useState(false);

  /*
   * ★ Hidden entirely when the kindergarten is unknown, rather than shown and
   * failing. A super-admin listing users across the platform has no single
   * kindergarten to file a record under, and a button that 404s teaches people
   * the app is broken.
   */
  if (!kindergartenId) return null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <FileBadge size={16} aria-hidden="true" />
        Хувийн хэрэг
      </Button>

      {open ? (
        <StaffRecordsDialog
          user={user}
          kindergartenId={kindergartenId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function StaffRecordsDialog({
  user,
  kindergartenId,
  onClose,
}: {
  user: { id: string; lastName: string; firstName: string };
  kindergartenId: string;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const path = `/kindergartens/${kindergartenId}/staff/${user.id}/records`;

  const records = useQuery({
    queryKey: qk.staffRecords(kindergartenId, user.id),
    queryFn: () => get(path, staffRecordListSchema),
  });

  const items = records.data ?? [];

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Хувийн хэрэг"
      description={`${user.lastName} ${user.firstName} — ажлын туршлага, гэрчилгээ, зэрэг`}
      footer={
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {adding ? (
          <StaffRecordForm
            path={path}
            kindergartenId={kindergartenId}
            userId={user.id}
            onDone={() => setAdding(false)}
          />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setAdding(true)}
          >
            Бүртгэл нэмэх
          </Button>
        )}

        {records.isPending ? <LoadingState rows={3} /> : null}
        {records.isError ? <ErrorState description={errorMessage(records.error)} /> : null}

        {records.data && items.length === 0 ? (
          <EmptyState
            title="Бүртгэл алга"
            description="Ажлын туршлага, гэрчилгээ, зэргийг энд бүртгэнэ. Энэ мэдээлэл БСМС-д тайлагнах шаардлагатай."
          />
        ) : null}

        {items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {items.map((record) => (
              <StaffRecordRow
                key={record.id}
                record={record}
                kindergartenId={kindergartenId}
                userId={user.id}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </FormDialog>
  );
}

function StaffRecordRow({
  record,
  kindergartenId,
  userId,
}: {
  record: StaffRecord;
  kindergartenId: string;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const remove = useMutation({
    mutationFn: () => mutate(`/staff-records/${record.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.staffRecords(kindergartenId, userId) });
      toast.success(`${record.title} — устгагдлаа.`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <li>
      <Card pad="compact" className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{STAFF_RECORD_KIND_LABEL[record.kind] ?? record.kind}</Badge>
          <span className="text-body font-medium text-ink">{record.title}</span>
          {record.documentNo ? (
            <span className="text-caption text-muted">№ {record.documentNo}</span>
          ) : null}

          <span className="ml-auto">
            <ConfirmDialog
              title="Бүртгэлийг устгах"
              description={`"${record.title}" — устгах уу? Ажил дууссан бол устгахын оронд дуусах огноог бөглөнө үү, ингэснээр түүх хадгалагдана.`}
              confirmLabel="Устгах"
              tone="danger"
              pending={remove.isPending}
              onConfirm={() => remove.mutate()}
              trigger={
                <Button variant="ghost" size="sm" aria-label={`${record.title} — устгах`}>
                  <Trash2 size={16} aria-hidden="true" />
                </Button>
              }
            />
          </span>
        </div>

        {record.issuer ? <p className="text-body text-muted">{record.issuer}</p> : null}

        {/*
          ★ "одоог хүртэл", not an em dash.

          A missing end date means the post is current, which is a fact — the
          dash this product uses for an unknown value would read as "we do not
          know when it ended".
        */}
        <p className="text-caption text-muted">
          {formatDate(record.startedOn)} —{" "}
          {record.endedOn ? formatDate(record.endedOn) : "одоог хүртэл"}
        </p>

        {record.note ? (
          <p className="whitespace-pre-wrap text-body text-muted">{record.note}</p>
        ) : null}
      </Card>
    </li>
  );
}

function StaffRecordForm({
  path,
  kindergartenId,
  userId,
  onDone,
}: {
  path: string;
  kindergartenId: string;
  userId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [kind, setKind] = useState("EXPERIENCE");
  const [title, setTitle] = useState("");
  const [issuer, setIssuer] = useState("");
  const [documentNo, setDocumentNo] = useState("");
  const [startedOn, setStartedOn] = useState(today);
  const [endedOn, setEndedOn] = useState("");
  const [note, setNote] = useState("");

  const save = useMutation({
    mutationFn: () =>
      mutate(path, z.unknown(), {
        method: "POST",
        body: {
          kind,
          title: title.trim(),
          issuer: issuer.trim() || null,
          documentNo: documentNo.trim() || null,
          note: note.trim() || null,
          startedOn,
          // `null`, not `""` — an empty string is not a date, and the field
          // being blank is what "still current" looks like.
          endedOn: endedOn || null,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.staffRecords(kindergartenId, userId) });
      onDone();
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <Card pad="roomy">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending && title.trim()) save.mutate();
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
          <Field label="Төрөл" error={errors.kind}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {Object.entries(STAFF_RECORD_KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label={kind === "EXPERIENCE" ? "Албан тушаал" : "Нэр"}
            error={errors.title}
            required
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

          <Field
            label={kind === "EXPERIENCE" ? "Байгууллага" : "Олгосон байгууллага"}
            error={errors.issuer}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
              />
            )}
          </Field>

          <Field label="Баримтын дугаар" error={errors.documentNo}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={documentNo}
                onChange={(e) => setDocumentNo(e.target.value)}
              />
            )}
          </Field>

          <Field label="Эхэлсэн огноо" error={errors.startedOn} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                aria-describedby={describedBy}
                invalid={invalid}
                value={startedOn}
                onChange={(e) => setStartedOn(e.target.value)}
              />
            )}
          </Field>

          {/*
            ★ Optional, and the hint says why. "2019 оноос одоог хүртэл" is the
            normal state of a current post, and a blank date field with no
            explanation reads as something the person forgot to fill in.
          */}
          <Field
            label="Дуусах огноо"
            hint={kind === "CERTIFICATE" ? "Хүчинтэй хугацаа" : "Хоосон = одоог хүртэл"}
            error={errors.endedOn}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                aria-describedby={describedBy}
                invalid={invalid}
                value={endedOn}
                onChange={(e) => setEndedOn(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Тэмдэглэл" error={errors.note}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={2}
              aria-describedby={describedBy}
              invalid={invalid}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={save.isPending || !title.trim()}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Болих
          </Button>
        </div>
      </form>
    </Card>
  );
}
