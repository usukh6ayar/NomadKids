"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
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
    <AuthShell>
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
      <div className="flex flex-col gap-4">
        <Card pad="roomy" tone="mint" className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-lead font-semibold text-ink">
            <CheckCircle2 size={20} aria-hidden="true" className="text-mint-ink" />
            Хүсэлт хүлээн авлаа
          </p>
          <p className="text-body text-muted">
            Бид таны мэдээллийг шалгаад <strong>{form.email}</strong> хаягаар хариу мэдэгдэнэ.
            Батлагдсаны дараа гэрээ автоматаар үүсч, татаж авах боломжтой болно.
          </p>
        </Card>
        <p className="text-body text-muted">
          Хүсэлтийн дугаар: <code className="text-caption text-ink">{submit.data.id}</code>
        </p>
        <Link href="/login" className="text-body font-semibold text-primary hover:underline">
          Нэвтрэх хуудас руу буцах
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
      <div>
        <h2 className="text-heading font-semibold tracking-[-.01em] text-ink">
          Байгууллагын бүртгэл
        </h2>
        <p className="mt-1.5 text-body leading-relaxed text-muted">
          Цэцэрлэгийнхээ мэдээллийг бөглөнө үү. Шалгасны дараа гэрээ үүсгэж, танд хүргүүлнэ.
        </p>
      </div>

      <FormError
        message={
          submit.isError && Object.keys(errors).length === 0 ? errorMessage(submit.error) : null
        }
      />

      <Field label="Цэцэрлэгийн нэр" error={errors.kindergartenName} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.kindergartenName}
            onChange={set("kindergartenName")}
            autoFocus
          />
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Регистрийн дугаар"
          error={errors.registrationNumber}
          hint="7 оронтой"
          required
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              inputMode="numeric"
              value={form.registrationNumber}
              onChange={set("registrationNumber")}
            />
          )}
        </Field>

        <Field label="Хүүхдийн тоо" error={errors.childCount} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="number"
              inputMode="numeric"
              min={1}
              value={form.childCount}
              onChange={set("childCount")}
            />
          )}
        </Field>
      </div>

      <Field label="Хаяг" error={errors.address} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.address}
            onChange={set("address")}
          />
        )}
      </Field>

      <Field label="Эрхлэгчийн нэр" error={errors.directorName} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.directorName}
            onChange={set("directorName")}
          />
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Утасны дугаар" error={errors.phone} hint="8 оронтой" required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              inputMode="tel"
              value={form.phone}
              onChange={set("phone")}
            />
          )}
        </Field>

        <Field label="И-мэйл хаяг" error={errors.email} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set("email")}
            />
          )}
        </Field>
      </div>

      <Field label="Нэмэлт тэмдэглэл" error={errors.note}>
        {({ id }) => <Textarea id={id} rows={2} value={form.note} onChange={set("note")} />}
      </Field>

      <Button type="submit" size="lg" disabled={submit.isPending} className="w-full">
        {submit.isPending ? "Илгээж байна…" : "Илгээх"}
      </Button>

      <p className="border-t border-border pt-4 text-body text-muted">
        Бүртгэлтэй юу?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Нэвтрэх
        </Link>
      </p>
    </form>
  );
}
