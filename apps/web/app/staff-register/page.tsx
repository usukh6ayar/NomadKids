"use client";

import { useMutation } from "@tanstack/react-query";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { staffSelfRegistrationResultSchema } from "@kinder/contracts";
import { PublicLanding } from "@/components/public/landing";
import { COMPACT_INPUT, PublicDialogFrame } from "@/components/public/register-dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";

/**
 * Багшийн өөрийн бүртгэл — `POST /staff-registration`.
 *
 * ★★★ **The server refuses a wrong code, an unknown register number, a
 * malformed one, a stale roster and an unmapped job title with the exact same
 * status and the exact same sentence** (`StaffRegistrationService.REFUSAL`,
 * `apps/api/src/staff-registration/staff-registration.service.ts`) — on
 * purpose. If a wrong code read differently from "not on this roster", the
 * form would answer "does this register number belong to a member of staff
 * here?" for anyone holding a code and a list of numbers.
 *
 * This screen must not undo that in the browser. It renders whatever
 * `problem.detail` the API sends, through `errorMessage()`, and adds no
 * validation of its own that would tell a malformed register number apart
 * from an unknown one before the request is even sent — a client-side check
 * that rejects one shape and accepts another is the same leak one step
 * earlier.
 *
 * ★ The register number is typed as given, uppercase and lookalike-Latin
 * letters included: `normalizeRegisterNumber` on the API already forgives
 * both, so re-implementing that here would be a second copy of a rule that
 * only needs to exist once.
 *
 * ★★ On success the screen redirects to `/invitation/[token]`, which already
 * collects the first password — there is no second password form here. The
 * account it belongs to is unusable until that page is completed.
 *
 * ★★★★ **A window over the home page since 2026-10-12**, like «Байгууллагын
 * бүртгэл» (`app/register/page.tsx`) and «Багш, ажилтан» — the user: the
 * full page with its explainer panel took too much room. The three steps
 * survive as one quiet line above the form. Closing goes home; the address
 * stays, because the director's «Ажилтны код» page and the setup guide link
 * here. Nothing about the request, the refusal or the redirect changed.
 */
export default function StaffRegisterPage() {
  const router = useRouter();
  return (
    <Suspense fallback={<div className="min-h-dvh bg-white" />}>
      <PublicLanding />
      <PublicDialogFrame label="Ажилтны бүртгэл" onClose={() => router.push("/")}>
        <StaffRegisterForm />
      </PublicDialogFrame>
    </Suspense>
  );
}

/** The three steps, as one line: numbers in colour, no badges behind them. */
const STEPS = ["ESIS дугаар", "Регистр", "Нууц үг"] as const;

function StaffRegisterForm() {
  const router = useRouter();
  const [institutionId, setInstitutionId] = useState("");
  const [registerNumber, setRegisterNumber] = useState("");

  const register = useMutation({
    mutationFn: () =>
      mutate("/staff-registration", staffSelfRegistrationResultSchema, {
        method: "POST",
        body: { institutionId, registerNumber },
      }),
    onSuccess: (result) => {
      router.replace(`/invitation/${result.invitationToken}`);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!register.isPending) register.mutate();
  }

  return (
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
          <h2 className="text-lead font-extrabold leading-tight text-[#102f5d]">Ажилтны бүртгэл</h2>
          <p className="text-caption text-slate-500">ESIS дугаар, регистрээрээ эрхээ үүсгэнэ</p>
        </div>
      </div>

      <ol
        aria-label="Алхмууд"
        className="flex flex-wrap items-center gap-x-2 text-caption text-slate-500"
      >
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-center gap-x-2">
            {index > 0 ? (
              <span aria-hidden="true" className="text-slate-300">
                →
              </span>
            ) : null}
            <span>
              <span className="font-bold text-[#176ac2]">{index + 1}</span> {step}
            </span>
          </li>
        ))}
      </ol>

      <FormError message={register.isError ? errorMessage(register.error) : null} />

      <Field
        label="Цэцэрлэгийн ESIS дугаар"
        hint="Танай цэцэрлэгийн ESIS дээрх байгууллагын дугаар. Захирлаасаа асууна уу."
        required
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={institutionId}
            onChange={(event) => setInstitutionId(event.target.value)}
            placeholder="Жишээ: 42778"
            inputMode="numeric"
            autoCapitalize="none"
            className={COMPACT_INPUT}
          />
        )}
      </Field>

      <Field label="Регистрийн дугаар" hint="Өөрийн регистрийн дугаарыг бичнэ үү." required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={registerNumber}
            onChange={(event) => setRegisterNumber(event.target.value)}
            placeholder="Жишээ: УБ12345678"
            autoCapitalize="none"
            className={COMPACT_INPUT}
          />
        )}
      </Field>

      <Button type="submit" disabled={register.isPending} className="mt-1 w-full">
        {register.isPending ? "Илгээж байна…" : "Бүртгүүлэх"}
      </Button>

      {/* This help remains visible before and after every server response. */}
      <p className="text-center text-caption text-slate-500">
        Бүртгүүлж чадахгүй бол эрхлэгчдээ хандаж урилга авна уу.
      </p>
    </form>
  );
}
