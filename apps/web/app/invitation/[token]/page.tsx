"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { PASSWORD_RULES, validatePasswordStrength } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Input, PasswordInput, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { AuthShell } from "@/components/shell/auth-shell";

/**
 * The rules come from `@kinder/contracts`, which is also what the API runs.
 *
 * ★ This screen used to print one requirement and let the server reject on
 * four. A parent who satisfied the list still got a 401 — after the round trip,
 * in a red banner, having already typed the password twice.
 */

/**
 * How a guardian describes themselves to the child.
 *
 * ★ Chosen here, by the guardian, rather than guessed by a teacher at invite
 * time — which is how a father used to end up recorded as a mother. The
 * account is created with `OTHER` and this is what replaces it.
 *
 * The order is the common cases first: `guardianRelationSchema` lists five and
 * two of them cover almost every family.
 */
const RELATIONS = [
  { value: "MOTHER", label: "Ээж" },
  { value: "FATHER", label: "Аав" },
  { value: "GRANDPARENT", label: "Өвөө, эмээ" },
  { value: "SIBLING", label: "Ах, эгч" },
  { value: "OTHER", label: "Бусад" },
];

/**
 * Accepting an invitation — choosing the first password on a new account.
 *
 * ★ Not the same screen as a password reset, though they look alike.
 *
 * A reset recovers an account somebody already had. This is the first time
 * anyone can open the account at all: until it succeeds the password is 32
 * random bytes nobody has seen, so there is nothing to recover and nothing to
 * confirm. The API keeps the two apart for the same reason — an invitation
 * token must never be usable to reset an existing user's password.
 *
 * The wording follows from that. "Тавтай морил" rather than "Нууц үг сэргээх",
 * because the person reading it has never been here before.
 */
export default function AcceptInvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState<string>("MOTHER");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  /*
    ★ What kind of person is accepting this — 2026-09-04.

    A guardian gives a given name, a phone and how they are related to the
    child. A member of staff gives a surname and an e-mail, because a register
    names them in full and the e-mail is what they will log in with (an
    operator invited this way has a generated handle they never see).

    The token is opaque, so the shape has to come from the server. Putting it
    in the URL instead would let whoever holds the link flip it.

    ★★ It also answers "is this link still good" before anything is typed. An
    expired invitation used to be discovered *after* the password had been
    entered twice.
  */
  const invitation = useQuery({
    queryKey: ["invitation", params.token],
    queryFn: () =>
      get(
        `/auth/invitation/${params.token}`,
        z.object({ valid: z.boolean(), kind: z.enum(["staff", "guardian"]) }),
      ),
    retry: false,
  });

  const isStaff = invitation.data?.kind === "staff";

  const accept = useMutation({
    mutationFn: () =>
      mutate("/auth/invitation/accept", z.unknown(), {
        method: "POST",
        body: {
          token: params.token,
          password,
          firstName: firstName.trim(),
          // Only the fields this audience was asked for. Sending an empty
          // string would fail the schema's `.min(1)`; sending the other
          // audience's fields would write facts nobody was asked to give.
          ...(isStaff
            ? { lastName: lastName.trim(), email: email.trim() }
            : { phone: phone.trim(), relation }),
        },
      }),
    onSuccess: () => {
      // Straight to the login form: the account now has a credential and the
      // API cleared the cookies, so signing in is one deliberate step.
      setTimeout(() => router.replace("/login"), 2000);
    },
  });

  const errors = fieldErrors(accept.error);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (accept.isPending) return;

    const weaknesses = validatePasswordStrength(password);
    if (weaknesses.length > 0) {
      setLocalError(`${weaknesses.join(". ")}.`);
      return;
    }
    // Checked here and not sent: the API takes one password, and a mismatch is
    // a typing mistake the user should learn about without a round trip.
    if (password !== confirm) {
      setLocalError("Хоёр нууц үг таарахгүй байна.");
      return;
    }

    setLocalError(null);
    accept.mutate();
  }

  if (accept.isSuccess) {
    return (
      <AuthShell>
        <h2 className="mb-1.5 text-heading font-semibold tracking-[-.01em] text-ink">
          Бүртгэл идэвхжлээ
        </h2>
        <p role="status" className="text-body text-muted">
          Нэвтрэх хуудас руу шилжиж байна…
        </p>
        <p>
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center text-body font-semibold text-primary hover:underline"
          >
            Нэвтрэх
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h2 className="mb-1.5 text-heading font-semibold tracking-[-.01em] text-ink">Тавтай морил</h2>
      <p className="mb-4 text-body leading-relaxed text-muted">
        Өөрийнхөө нэр, утсаа бөглөөд нууц үгээ сонгоно уу.
      </p>

      <ul className="mb-4 list-disc space-y-1 pl-5 text-body text-muted">
        {PASSWORD_RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormError message={localError ?? (accept.isError ? errorMessage(accept.error) : null)} />

        {/*
          ★ The guardian introduces themselves here, and the teacher no longer
          guesses on their behalf.

          Inviting used to ask a teacher for a surname, a given name, a login
          handle, a phone and the relationship — five facts about somebody
          standing in front of them. The invitation now carries only a token,
          and these three fields are where the account becomes a person.

          **No surname**, at the client's request: "эцэг эхийн овог хэрэггүй,
          зөвхөн нэр нь байхад болно". A form finished in a corridor on a phone
          should ask for what is needed and stop.
        */}
        {isStaff ? (
          <Field label="Овог" error={errors.lastName} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                autoComplete="family-name"
                autoFocus
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            )}
          </Field>
        ) : null}

        <Field label="Таны нэр" error={errors.firstName} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              autoComplete="given-name"
              autoFocus={!isStaff}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          )}
        </Field>

        {isStaff ? (
          <Field label="И-мэйл хаяг" error={errors.email} hint="Энэ хаягаараа нэвтэрнэ." required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
        ) : null}

        {!isStaff ? (
          <>
            <Field label="Утасны дугаар" error={errors.phone} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              )}
            </Field>

            <Field label="Хүүхдийн юу нь болох" error={errors.relation} required>
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                >
                  {RELATIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        ) : null}

        <Field label="Нууц үг" error={errors.password} required>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        <Field label="Нууц үгээ давтан оруулна уу" required>
          {({ id, describedBy }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>

        <Button type="submit" size="lg" block disabled={accept.isPending}>
          {accept.isPending ? "Идэвхжүүлж байна…" : "Бүртгэл идэвхжүүлэх"}
        </Button>
      </form>

      <p className="mt-[22px] border-t border-border pt-4 text-body leading-relaxed text-muted">
        Урилга хүчингүй болсон бол цэцэрлэгийн багш, администратортаа хандаж шинээр авна уу.
      </p>
    </AuthShell>
  );
}
