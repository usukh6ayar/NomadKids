"use client";

import { useMutation } from "@tanstack/react-query";
import { teacherSignupResultSchema } from "@kinder/contracts";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { COMPACT_INPUT, PublicDialogFrame } from "@/components/public/register-dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";

/**
 * «Багш» → «Гэрээ байгуулах» — a window like the organisation's, 2026-10-08,
 * the client: "багш гэрээ байгуулахад байгууллага шиг цонх үүсгэ".
 *
 * ★ The contract the backend is asked for — nothing answers it yet:
 *
 *   POST /teacher-applications
 *     { fullName, phone (8 digits), email, propertyType, location,
 *       kindergartenName }
 *     → { id, status }
 *
 * While it answers 404 the form says so and gives the phone and e-mail, so a
 * teacher who wants the plan still has a way to ask for it.
 */

export function TeacherApplyDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    propertyType: "Төрийн бус",
    location: "",
    kindergartenName: "",
  });

  const router = useRouter();
  /*
    ★ The workspace exists the moment this answers (the user, 2026-10-11: no
    approval) — the answer is a one-time invitation token, and the password is
    set on `/invitation/[token]`, exactly as staff self-registration does.
  */
  const submit = useMutation({
    mutationFn: () =>
      mutate("/teacher-applications", teacherSignupResultSchema, {
        method: "POST",
        body: {
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          propertyType: form.propertyType,
          location: form.location,
          kindergartenName: form.kindergartenName.trim(),
        },
      }),
    onSuccess: (result) => router.replace(`/invitation/${result.invitationToken}`),
  });

  const errors = fieldErrors(submit.error);

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
        <p className="py-6 text-center text-body text-slate-600" aria-live="polite">
          Нууц үг тохируулах хуудас руу шилжиж байна…
        </p>
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
              <p className="text-caption text-slate-500">Дангаар ашиглах үнэгүй багц</p>
            </div>
          </div>

          <FormError
            message={
              submit.isError && Object.keys(errors).length === 0 ? errorMessage(submit.error) : null
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

          <div className="grid gap-3 sm:grid-cols-2">
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

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Өмчийн хэлбэр" error={errors.propertyType} required>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.propertyType}
                  onChange={set("propertyType")}
                  className={COMPACT_INPUT}
                >
                  <option value="Төрийн бус">Төрийн бус</option>
                  <option value="Төрийн">Төрийн</option>
                </Select>
              )}
            </Field>

            <Field label="Аймаг / дүүрэг" error={errors.location} required>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.location}
                  onChange={set("location")}
                  className={COMPACT_INPUT}
                >
                  <option value="">Сонгоно уу</option>
                  <optgroup label="Улаанбаатар">
                    <option value="Багануур дүүрэг">Багануур</option>
                    <option value="Багахангай дүүрэг">Багахангай</option>
                    <option value="Баянгол дүүрэг">Баянгол</option>
                    <option value="Баянзүрх дүүрэг">Баянзүрх</option>
                    <option value="Налайх дүүрэг">Налайх</option>
                    <option value="Сонгинохайрхан дүүрэг">Сонгинохайрхан</option>
                    <option value="Сүхбаатар дүүрэг">Сүхбаатар</option>
                    <option value="Хан-Уул дүүрэг">Хан-Уул</option>
                    <option value="Чингэлтэй дүүрэг">Чингэлтэй</option>
                  </optgroup>
                  <optgroup label="Орон нутаг">
                    <option value="Архангай аймаг">Архангай</option>
                    <option value="Баян-Өлгий аймаг">Баян-Өлгий</option>
                    <option value="Баянхонгор аймаг">Баянхонгор</option>
                    <option value="Булган аймаг">Булган</option>
                    <option value="Говь-Алтай аймаг">Говь-Алтай</option>
                    <option value="Говьсүмбэр аймаг">Говьсүмбэр</option>
                    <option value="Дархан-Уул аймаг">Дархан-Уул</option>
                    <option value="Дорноговь аймаг">Дорноговь</option>
                    <option value="Дорнод аймаг">Дорнод</option>
                    <option value="Дундговь аймаг">Дундговь</option>
                    <option value="Завхан аймаг">Завхан</option>
                    <option value="Орхон аймаг">Орхон</option>
                    <option value="Өвөрхангай аймаг">Өвөрхангай</option>
                    <option value="Өмнөговь аймаг">Өмнөговь</option>
                    <option value="Сүхбаатар аймаг">Сүхбаатар</option>
                    <option value="Сэлэнгэ аймаг">Сэлэнгэ</option>
                    <option value="Төв аймаг">Төв</option>
                    <option value="Увс аймаг">Увс</option>
                    <option value="Ховд аймаг">Ховд</option>
                    <option value="Хөвсгөл аймаг">Хөвсгөл</option>
                    <option value="Хэнтий аймаг">Хэнтий</option>
                  </optgroup>
                </Select>
              )}
            </Field>
          </div>

          <Field label="Цэцэрлэгийн нэр" error={errors.kindergartenName} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                placeholder="Жишээ: Нарлаг цэцэрлэг"
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
