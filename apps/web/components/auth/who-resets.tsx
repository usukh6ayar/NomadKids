"use client";

import { Phone } from "lucide-react";
import { useState } from "react";
import { CONTACT } from "@/lib/contact";

/**
 * «Утсаа алдвал хэнд хандах вэ?» — one rule, said the same way everywhere
 * (2026-10-14, the user): whoever registered you resets your password. A
 * parent asks the teacher or the director, staff their director, and a
 * director or a solo teacher NomadKids. With the phone at hand anyone resets
 * by SMS on «Нууц үгээ мартсан уу?».
 *
 * ★ Asked as «Та хэн бэ?» rather than shown as a table (2026-10-14, the user:
 * "энгийн хялбар") — a person picks what they are and reads the one sentence
 * meant for them; NomadKids' number is a button that calls.
 *
 * Shown on that page, after an invitation is accepted, and in the FAQ
 * (`who-resets-text.ts`, kept apart: the FAQ is a server page).
 */
export const WHO_RESETS = [
  {
    key: "parent",
    who: "Эцэг эх",
    answer: "Хүүхдийнхээ багш эсвэл цэцэрлэгийн эрхлэгчид хандана уу.",
  },
  {
    key: "staff",
    who: "Цэцэрлэгийн багш, ажилтан",
    answer: "Цэцэрлэгийнхээ эрхлэгчид хандана уу.",
  },
  {
    key: "head",
    who: "Эрхлэгч / бие даасан багш",
    answer: "NomadKids-д хандана уу.",
  },
] as const;

export function WhoResets({
  title = "Утасны дугаараа сольсон эсвэл алдсан уу?",
}: {
  /** The question above «Та хэн бэ?»; `null` where the page already asks it. */
  title?: string | null;
}) {
  const [picked, setPicked] = useState<(typeof WHO_RESETS)[number]["key"] | null>(null);
  const choice = WHO_RESETS.find((row) => row.key === picked);

  return (
    <div aria-label="Хэнд хандах вэ" className="flex flex-col gap-2 text-left">
      {title ? <p className="text-caption font-semibold leading-5 text-ink">{title}</p> : null}
      <div role="group" aria-label="Та хэн бэ?" className="flex flex-col gap-1.5">
        <p className="text-caption leading-5 text-muted">Та хэн бэ?</p>
        <div className="flex flex-wrap gap-1.5">
          {WHO_RESETS.map((row) => (
            <button
              key={row.key}
              type="button"
              aria-pressed={picked === row.key}
              onClick={() => setPicked(row.key)}
              className={`min-h-9 rounded-pill border px-3 text-caption font-semibold ${
                picked === row.key
                  ? "border-primary bg-primary/10 text-ink"
                  : "border-border bg-white text-ink hover:bg-canvas"
              }`}
            >
              {row.who}
            </button>
          ))}
        </div>
      </div>

      {choice ? (
        <div role="status" className="flex flex-col gap-2 rounded-row bg-canvas p-3">
          <p className="text-body leading-6 text-ink">{choice.answer}</p>
          {choice.key === "head" ? (
            <a
              href={CONTACT.phoneHref}
              className="inline-flex min-h-10 w-fit items-center gap-2 rounded-control bg-primary px-4 text-body font-semibold text-primary-ink"
            >
              <Phone size={16} aria-hidden="true" />
              {CONTACT.phone} залгах
            </a>
          ) : null}
          <p className="text-caption leading-5 text-muted">
            {choice.key === "head" ? "Бид" : "Тэд"} таныг таниад нууц үг сэргээх холбоос өгнө.
          </p>
        </div>
      ) : null}
    </div>
  );
}
