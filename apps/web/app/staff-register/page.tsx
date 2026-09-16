"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { staffSelfRegistrationResultSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { AuthShell } from "@/components/shell/auth-shell";

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
 */
export default function StaffRegisterPage() {
  return (
    <AuthShell>
      <StaffRegisterForm />
    </AuthShell>
  );
}

function StaffRegisterForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [registerNumber, setRegisterNumber] = useState("");

  const register = useMutation({
    mutationFn: () =>
      mutate("/staff-registration", staffSelfRegistrationResultSchema, {
        method: "POST",
        body: { code, registerNumber },
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
    <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
      <div>
        <h2 className="text-heading font-semibold tracking-[-.01em] text-ink">
          Ажилтны бүртгэл
        </h2>
        <p className="mt-1.5 text-body leading-relaxed text-muted">
          Цэцэрлэгээсээ авсан код болон өөрийн регистрийн дугаараа оруулна уу.
        </p>
      </div>

      {/*
        ★ Rendered unconditionally, not shown only when an error appears.
        Text that only shows up on failure is a second signal — see the
        docblock above.
      */}
      <p className="rounded-control bg-canvas px-3.5 py-2.5 text-caption leading-relaxed text-muted">
        Жагсаалтаас олдохгүй бол цэцэрлэгийнхээ захиралтай холбогдоно уу.
      </p>

      <FormError message={register.isError ? errorMessage(register.error) : null} />

      <Field label="Цэцэрлэгийн код" required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoCapitalize="none"
            autoFocus
          />
        )}
      </Field>

      <Field label="Регистрийн дугаар" required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={registerNumber}
            onChange={(event) => setRegisterNumber(event.target.value)}
            autoCapitalize="none"
          />
        )}
      </Field>

      <Button type="submit" size="lg" disabled={register.isPending} className="w-full">
        {register.isPending ? "Илгээж байна…" : "Бүртгүүлэх"}
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
