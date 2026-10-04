"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowRight, Building2, CheckCircle2, ClipboardCheck, UserRound } from "lucide-react";
import { applicationReceiptSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { AuthShell } from "@/components/shell/auth-shell";

/**
 * Байгууллагын бүртгэл — `docs/CONTRACT_ONBOARDING.md` steps 1–2.
 *
 * ★★★ **The only screen in the product that posts without a session**, and it
 * is worth being explicit about what that means here: nothing on this page
 * reads anything. It writes one row and shows back a reference. There is no
 * lookup, no "check if we are registered", no list.
 *
 * ★★ It asks nothing about a child. A form filled in by a stranger over a
 * public connection should carry as little as it can — `childCount` is a number
 * used to price the contract, never a roster.
 *
 * ★ A repeat submission is not an error. The API answers a duplicate
 * registration number exactly as it answers a first one (see
 * `OnboardingService.submit`), so this screen shows the same confirmation
 * either way — a kindergarten pressing the button twice must not be told
 * something is wrong, and a stranger must not be able to learn who is on file.
 */
export default function RegisterPage() {
  return (
    <AuthShell wide>
      <RegisterForm />
    </AuthShell>
  );
}

function RegisterForm() {
  const [form, setForm] = useState({
    kindergartenName: "",
    registrationNumber: "",
    address: "",
    directorName: "",
    phone: "",
    email: "",
    childCount: "",
    note: "",
  });

  const submit = useMutation({
    mutationFn: () =>
      mutate("/applications", applicationReceiptSchema, {
        method: "POST",
        body: {
          kindergartenName: form.kindergartenName.trim(),
          registrationNumber: form.registrationNumber.trim(),
          address: form.address.trim(),
          directorName: form.directorName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          childCount: Number(form.childCount),
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      }),
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

  if (submit.isSuccess) {
    return (
      <div className="py-2 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-pill bg-mint text-mint-ink">
          <CheckCircle2 className="size-8" aria-hidden="true" />
        </span>
        <p className="mt-5 text-caption font-bold uppercase tracking-[.12em] text-mint-ink">
          Амжилттай илгээлээ
        </p>
        <h1 className="mt-2 text-heading font-extrabold tracking-tight text-ink">
          Хүсэлт хүлээн авлаа
        </h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-body leading-6 text-muted">
          Бид мэдээллийг шалгаад тантай холбогдоно. Батлагдсаны дараа гэрээ автоматаар үүснэ.
        </p>

        <Card pad="roomy" tone="mint" className="mx-auto mt-6 max-w-md text-left">
          <p className="text-caption font-semibold text-muted">Хүсэлтийн дугаар</p>
          <code className="mt-1 block break-all text-body font-bold text-ink">
            {submit.data.id}
          </code>
        </Card>

        <Button asChild size="lg" className="mt-6 w-full sm:w-auto">
          <Link href="/login">
            Нэвтрэх хуудас руу буцах
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-6" noValidate onSubmit={onSubmit}>
      <div>
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary-soft px-3 py-1.5 text-caption font-bold text-primary-strong">
          <Building2 className="size-4" aria-hidden="true" />
          Байгууллагын хүсэлт
        </span>
        <h1 className="mt-4 text-heading font-extrabold tracking-tight text-ink sm:text-display">
          Цэцэрлэгээ бүртгүүлэх
        </h1>
        <p className="mt-2 max-w-[58ch] text-body leading-6 text-muted">
          Үндсэн мэдээллээ илгээнэ үү. Манай баг хүсэлтийг шалгаад тантай холбогдоно.
        </p>
        <div className="mt-4 flex items-start gap-3 rounded-control bg-[#f3f8ff] p-3.5 text-caption leading-5 text-[#476783]">
          <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p>Бөглөхөд ойролцоогоор 2 минут. Хүүхдийн хувийн мэдээлэл шаардахгүй.</p>
        </div>
      </div>

      <FormError
        message={
          submit.isError && Object.keys(errors).length === 0 ? errorMessage(submit.error) : null
        }
      />

      <fieldset className="rounded-card border border-border/80 p-4 sm:p-5">
        <legend className="px-2 text-body font-bold text-ink">
          <span className="inline-flex items-center gap-2">
            <Building2 className="size-4 text-primary" aria-hidden="true" />
            Байгууллагын мэдээлэл
          </span>
        </legend>
        <div className="mt-1 grid gap-4 sm:grid-cols-2">
          <Field
            className="sm:col-span-2"
            label="Цэцэрлэгийн нэр"
            error={errors.kindergartenName}
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="organization"
                aria-describedby={describedBy}
                invalid={invalid}
                placeholder="Жишээ: Бяцхан нүүдэлчид цэцэрлэг"
                autoComplete="organization"
                value={form.kindergartenName}
                onChange={set("kindergartenName")}
                autoFocus
              />
            )}
          </Field>

          <Field
            label="Регистрийн дугаар"
            error={errors.registrationNumber}
            hint="7 оронтой"
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="registrationNumber"
                aria-describedby={describedBy}
                invalid={invalid}
                inputMode="numeric"
                placeholder="1234567"
                value={form.registrationNumber}
                onChange={set("registrationNumber")}
              />
            )}
          </Field>

          <Field label="Хүүхдийн тоо" error={errors.childCount} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="childCount"
                aria-describedby={describedBy}
                invalid={invalid}
                type="number"
                inputMode="numeric"
                placeholder="120"
                min={1}
                value={form.childCount}
                onChange={set("childCount")}
              />
            )}
          </Field>

          <Field className="sm:col-span-2" label="Хаяг" error={errors.address} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="street-address"
                aria-describedby={describedBy}
                invalid={invalid}
                placeholder="Дүүрэг, хороо, гудамж, байр"
                autoComplete="street-address"
                value={form.address}
                onChange={set("address")}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="rounded-card border border-border/80 p-4 sm:p-5">
        <legend className="px-2 text-body font-bold text-ink">
          <span className="inline-flex items-center gap-2">
            <UserRound className="size-4 text-primary" aria-hidden="true" />
            Холбоо барих мэдээлэл
          </span>
        </legend>
        <div className="mt-1 grid gap-4 sm:grid-cols-2">
          <Field label="Эрхлэгчийн нэр" error={errors.directorName} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="name"
                aria-describedby={describedBy}
                invalid={invalid}
                placeholder="Овог, нэр"
                autoComplete="name"
                value={form.directorName}
                onChange={set("directorName")}
              />
            )}
          </Field>

          <Field label="Утасны дугаар" error={errors.phone} hint="8 оронтой" required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="tel"
                aria-describedby={describedBy}
                invalid={invalid}
                inputMode="tel"
                placeholder="99112233"
                autoComplete="tel"
                value={form.phone}
                onChange={set("phone")}
              />
            )}
          </Field>

          <Field className="sm:col-span-2" label="И-мэйл хаяг" error={errors.email} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="email"
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                placeholder="name@example.mn"
                autoComplete="email"
                value={form.email}
                onChange={set("email")}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <Field label="Нэмэлт тэмдэглэл" error={errors.note} hint="Заавал бөглөх шаардлагагүй">
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            name="note"
            aria-describedby={describedBy}
            invalid={invalid}
            rows={3}
            placeholder="Нэмэлт асуулт, хүсэлт байвал энд бичнэ үү."
            value={form.note}
            onChange={set("note")}
          />
        )}
      </Field>

      <div className="rounded-card bg-canvas p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
        <p className="text-caption leading-5 text-muted">
          Илгээснээр таны мэдээллийг хүсэлт шийдвэрлэх зорилгоор ашиглахыг зөвшөөрнө.
        </p>
        <Button
          type="submit"
          size="lg"
          disabled={submit.isPending}
          className="mt-4 w-full shrink-0 sm:mt-0 sm:w-auto"
        >
          {submit.isPending ? "Илгээж байна…" : "Хүсэлт илгээх"}
          {!submit.isPending ? <ArrowRight aria-hidden="true" /> : null}
        </Button>
      </div>

      <p className="text-center text-body text-muted">
        Бүртгэлтэй юу?{" "}
        <Link href="/login" className="font-bold text-primary hover:underline">
          Нэвтрэх
        </Link>
      </p>
    </form>
  );
}
