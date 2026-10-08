"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { COMPACT_INPUT, PublicDialogFrame } from "@/components/public/register-dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/api/errors";
import { CONTACT } from "@/lib/contact";

/**
 * «Багш» → «Гэрээ байгуулах» — a window like the organisation's, 2026-10-08,
 * the client: "багш гэрээ байгуулахад байгууллага шиг цонх үүсгэ".
 *
 * ★ The contract the backend is asked for — nothing answers it yet:
 *
 *   POST /teacher-applications
 *     { fullName, phone (8 digits), email, kindergartenName? }
 *     → { id, status }
 *
 * While it answers 404 the form says so and gives the phone and e-mail, so a
 * teacher who wants the plan still has a way to ask for it.
 */
const receiptSchema = z.object({ id: z.string(), status: z.string() });

export function TeacherApplyDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", kindergartenName: "" });

  const submit = useMutation({
    mutationFn: () =>
      mutate("/teacher-applications", receiptSchema, {
        method: "POST",
        body: {
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          ...(form.kindergartenName.trim()
            ? { kindergartenName: form.kindergartenName.trim() }
            : {}),
        },
      }),
  });

  const errors = fieldErrors(submit.error);
  const notReady = submit.isError && isNotFound(submit.error);

  function set(key: keyof typeof form) {
    return (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!submit.isPending) submit.mutate();
  }

  return (
    <PublicDialogFrame label="Багшийн гэрээ" onClose={onClose}>
      {submit.isSuccess ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="size-10 text-mint-ink" aria-hidden />
          <h2 className="text-lead font-extrabold text-[#102f5d]">Хүсэлт хүлээн авлаа</h2>
          <p className="text-body text-slate-600">
            <strong>{form.email}</strong> хаягаар удахгүй холбогдоно.
          </p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={onClose}>
            Хаах
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-3" noValidate onSubmit={onSubmit}>
          <div className="flex items-center gap-3 pr-8">
            <Image
              src="/icons/icon-teacher-3d.png"
              alt=""
              width={44}
              height={44}
              className="size-11 shrink-0 object-contain"
            />
            <div>
              <h2 className="text-lead font-extrabold leading-tight text-[#102f5d]">
                Багшийн гэрээ
              </h2>
              <p className="text-caption text-slate-500">Дангаар ашиглах багц</p>
            </div>
          </div>

          <FormError
            message={
              notReady
                ? `Багшийн бүртгэл удахгүй нээгдэнэ. Одоохондоо ${CONTACT.phone} утсаар эсвэл ${CONTACT.email} хаягаар холбогдоно уу.`
                : submit.isError && Object.keys(errors).length === 0
                  ? errorMessage(submit.error)
                  : null
            }
          />

          <Field label="Овог нэр" error={errors.fullName} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.fullName}
                onChange={set("fullName")}
                className={COMPACT_INPUT}
                autoFocus
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Утас" error={errors.phone} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  inputMode="tel"
                  placeholder="8 оронтой"
                  value={form.phone}
                  onChange={set("phone")}
                  className={COMPACT_INPUT}
                />
              )}
            </Field>
            <Field label="И-мэйл" error={errors.email} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={set("email")}
                  className={COMPACT_INPUT}
                />
              )}
            </Field>
          </div>

          <Field label="Ажилладаг цэцэрлэг" error={errors.kindergartenName}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                placeholder="Заавал биш"
                value={form.kindergartenName}
                onChange={set("kindergartenName")}
                className={COMPACT_INPUT}
              />
            )}
          </Field>

          <Button type="submit" disabled={submit.isPending} className="mt-1 w-full">
            {submit.isPending ? "Илгээж байна…" : "Гэрээний хүсэлт илгээх"}
          </Button>
        </form>
      )}
    </PublicDialogFrame>
  );
}
