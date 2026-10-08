"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, X } from "lucide-react";
import Image from "next/image";
import { useState, type FormEvent, type ReactNode } from "react";
import { applicationReceiptSchema } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { FormError } from "@/components/ui/states";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";

/**
 * Байгууллагын бүртгэл in a window over the home page — 2026-10-08, the
 * client: "цонхоор нээгдээд х гээд гардаг, арын зайгаар нүүр хэсэг харагддаг,
 * орчин үеийн өхөөрдөм минимал, зай шахсан". `docs/CONTRACT_ONBOARDING.md`
 * steps 1–2, as the full page was.
 *
 * ★ No «Нэмэлт тэмдэглэл», no «Хаяг», and «Бүлгийн тоо» instead of «Хүүхдийн
 * тоо» — the client, 2026-10-08, who asked for the form first and the API to
 * follow ("эхлээд эндээ хийчих тэгээд админд холбо гэж мэдэгдэнэ").
 *
 * ★★ The body this sends is the contract the backend is asked for:
 *
 *   POST /applications
 *     { kindergartenName, registrationNumber, directorName, phone, email,
 *       groupCount: int ≥ 1 }
 *
 * Today `onboarding.dto.ts` still requires `address` and `childCount`, so the
 * API refuses this with a 400 until it changes. That refusal is caught below
 * and said plainly, rather than shown as a field error on fields that are no
 * longer on the form.
 */
export function RegisterDialog({ onClose }: { onClose: () => void }) {
  return (
    <PublicDialogFrame label="Байгууллагын бүртгэл" onClose={onClose}>
      <RegisterForm onClose={onClose} />
    </PublicDialogFrame>
  );
}

/**
 * The window both public sign-up forms open in — the organisation's and the
 * teacher's (`teacher-apply-dialog.tsx`): a small white card over the page,
 * × in its corner, Escape and a press outside closing it too.
 */
export function PublicDialogFrame({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ModalOverlay label={label} onClose={onClose}>
      <div className="relative w-full max-w-[420px] rounded-card bg-white px-5 pb-5 pt-4 text-left shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className="absolute right-2 top-2 grid size-10 place-items-center rounded-pill text-slate-500 hover:bg-slate-100 hover:text-[#173e70]"
        >
          <X className="size-5" aria-hidden />
        </button>
        {children}
      </div>
    </ModalOverlay>
  );
}

/** Compact inputs: 44px, the touch target, not the forms' usual 48. */
export const COMPACT_INPUT = "h-11";
const COMPACT = COMPACT_INPUT;

function RegisterForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    kindergartenName: "",
    registrationNumber: "",
    directorName: "",
    phone: "",
    email: "",
    groupCount: "",
  });

  const submit = useMutation({
    mutationFn: () =>
      mutate("/applications", applicationReceiptSchema, {
        method: "POST",
        body: {
          kindergartenName: form.kindergartenName.trim(),
          registrationNumber: form.registrationNumber.trim(),
          directorName: form.directorName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          groupCount: Number(form.groupCount),
        },
      }),
  });

  const errors = fieldErrors(submit.error);
  /*
    The API still asks for `address` and `childCount` (see above): a field
    error on one of those has no field to sit on, so it is said as one line.
  */
  const awaitingApi = Boolean(errors.address || errors.childCount);

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
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <CheckCircle2 className="size-10 text-mint-ink" aria-hidden />
        <h2 className="text-lead font-extrabold text-[#102f5d]">Хүсэлт хүлээн авлаа</h2>
        <p className="text-body text-slate-600">
          Шалгаад <strong>{form.email}</strong> хаягаар хариу мэдэгдэнэ.
        </p>
        <p className="text-caption text-slate-500">
          Хүсэлтийн дугаар: <code className="text-ink">{submit.data.id}</code>
        </p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={onClose}>
          Хаах
        </Button>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={onSubmit}>
      <div className="flex items-center gap-3 pr-8">
        <Image
          src="/icons/icon-kindergarten-3d.png"
          alt=""
          width={44}
          height={44}
          className="size-11 shrink-0 object-contain"
        />
        <div>
          <h2 className="text-lead font-extrabold leading-tight text-[#102f5d]">
            Байгууллагын бүртгэл
          </h2>
          <p className="text-caption text-slate-500">Шалгасны дараа гэрээ хүргүүлнэ.</p>
        </div>
      </div>

      <FormError
        message={
          awaitingApi
            ? "Бүртгэлийн сервер шинэчлэгдэж байна. Түр хүлээгээд дахин оролдоно уу, эсвэл бидэнтэй холбогдоно уу."
            : submit.isError && Object.keys(errors).length === 0
              ? errorMessage(submit.error)
              : null
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
            className={COMPACT}
            autoFocus
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Регистрийн дугаар" error={errors.registrationNumber} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              inputMode="numeric"
              placeholder="7 оронтой"
              value={form.registrationNumber}
              onChange={set("registrationNumber")}
              className={COMPACT}
            />
          )}
        </Field>

        <Field label="Бүлгийн тоо" error={errors.groupCount} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="number"
              inputMode="numeric"
              min={1}
              value={form.groupCount}
              onChange={set("groupCount")}
              className={COMPACT}
            />
          )}
        </Field>
      </div>

      <Field label="Эрхлэгчийн нэр" error={errors.directorName} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={form.directorName}
            onChange={set("directorName")}
            className={COMPACT}
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
              className={COMPACT}
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
              className={COMPACT}
            />
          )}
        </Field>
      </div>

      <Button type="submit" disabled={submit.isPending} className="mt-1 w-full">
        {submit.isPending ? "Илгээж байна…" : "Гэрээний хүсэлт илгээх"}
      </Button>
    </form>
  );
}
