"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { z } from "zod";
import { staffSelfRegistrationResultSchema, teacherSignupResultSchema } from "@kinder/contracts";
import {
  COMPACT_INPUT,
  PROVINCES,
  PublicDialogFrame,
  UB_DISTRICTS,
} from "@/components/public/register-dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors, isNotFound } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { cn } from "@/lib/utils";

/**
 * «Багш, ажилтан» — one window, two ways in (2026-10-12, the user).
 *
 * 1. **Staff of a kindergarten that has a contract** — teacher, assistant,
 *    cook (the roles `esis.roster.ts` maps; an accountant is invited): pick the district, pick the kindergarten, give the register
 *    number. It is `/staff-register` without the ESIS code: teachers do not
 *    know it by heart, and since 2026-09-20 the code only names which roster
 *    to read — choosing the kindergarten by name does the same job. Searching
 *    by register number alone was refused: anyone holding a number would
 *    learn where that person works.
 * 2. **A teacher on their own**, whose kindergarten has no contract — the
 *    solo workspace the backend shipped in #202: `POST /teacher-applications`
 *    answers an invitation token and the password is set on
 *    `/invitation/[token]`, as staff self-registration does. The operator
 *    later merges the workspace into the kindergarten (#204, #205).
 *
 * ★ Still asked of the backend for the first half — nothing answers it yet:
 *
 *   GET  /public/kindergartens?location=…  → [{ id, name }]   contracted only
 *   POST /staff-registration { kindergartenId, registerNumber } → as today
 *
 * ★★ The staff path adds no validation of its own and renders the server's
 * one refusal sentence, for the reason `app/staff-register/page.tsx` gives.
 */
const kindergartenListSchema = z.array(z.object({ id: z.string(), name: z.string() }));

type Mode = "staff" | "solo";

/** The kindergarten list's last option: "mine is not here" — go on your own. */
const NOT_LISTED = "__not-listed__";

const TABS: { key: Mode; label: string; hint: string; icon: typeof Building2 }[] = [
  {
    key: "staff",
    label: "Цэцэрлэгээр",
    hint: "Цэцэрлэг маань NomadKids ашигладаг",
    icon: Building2,
  },
  {
    key: "solo",
    label: "Дангаараа",
    hint: "Цэцэрлэг маань бүртгэлгүй — үнэгүй",
    icon: UserRound,
  },
];

/**
 * ★ Two tabs, not two screens (2026-10-12, the user): both ways in stay in
 * sight, and switching keeps what was typed — both panels stay mounted and the
 * other one is `hidden`. A teacher who does not know whether their
 * kindergarten has a contract is not asked: the list's «Миний цэцэрлэг энд
 * алга» moves them to «Дангаараа» with the district already chosen.
 */
export function TeacherApplyDialog({
  onClose,
  initialMode = "staff",
}: {
  onClose: () => void;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [soloLocation, setSoloLocation] = useState("");
  const [staffLocation, setStaffLocation] = useState("");
  const [staffKindergartenId, setStaffKindergartenId] = useState("");
  const baseId = useId();

  const active = TABS.find((tab) => tab.key === mode)!;

  return (
    <PublicDialogFrame label="Багш, ажилтан" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 pr-8">
          <Image
            src="/icons/icon-teacher-3d.png"
            alt=""
            width={44}
            height={44}
            className="size-11 shrink-0 object-contain"
          />
          <h2 className="text-lead font-extrabold leading-tight text-[#102f5d]">Багш, ажилтан</h2>
        </div>

        <div>
          <div
            role="tablist"
            aria-label="Бүртгэлийн төрөл"
            className="grid grid-cols-2 gap-1 rounded-pill bg-slate-100 p-1"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const selected = tab.key === mode;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${tab.key}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel-${tab.key}`}
                  onClick={() => setMode(tab.key)}
                  className={cn(
                    "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-pill px-3 text-body font-bold transition-colors",
                    selected
                      ? tab.key === "staff"
                        ? "bg-white text-[#176ac2] shadow-sm"
                        : "bg-white text-[#0d6b4a] shadow-sm"
                      : "text-slate-500 hover:text-[#173e70]",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-center text-caption text-slate-500">{active.hint}</p>
        </div>

        {TABS.map((tab) => (
          <div
            key={tab.key}
            role="tabpanel"
            id={`${baseId}-panel-${tab.key}`}
            aria-labelledby={`${baseId}-tab-${tab.key}`}
            hidden={tab.key !== mode}
          >
            {tab.key === "staff" ? (
              <StaffForm
                location={staffLocation}
                onLocationChange={(location) => {
                  setStaffLocation(location);
                  setStaffKindergartenId("");
                }}
                kindergartenId={staffKindergartenId}
                onKindergartenChange={setStaffKindergartenId}
                onNotListed={(location) => {
                  if (location) setSoloLocation(location);
                  setMode("solo");
                }}
              />
            ) : (
              <SoloForm
                location={soloLocation}
                onLocationChange={setSoloLocation}
                onUseContracted={(kindergartenId) => {
                  setStaffLocation(soloLocation);
                  setStaffKindergartenId(kindergartenId);
                  setMode("staff");
                }}
              />
            )}
          </div>
        ))}
      </div>
    </PublicDialogFrame>
  );
}

function LocationSelect({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field label="Аймаг / дүүрэг" error={error} required>
      {({ id, describedBy, invalid }) => (
        <Select
          id={id}
          aria-describedby={describedBy}
          invalid={invalid}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={COMPACT_INPUT}
          autoFocus={autoFocus}
        >
          <option value="">Сонгоно уу</option>
          <optgroup label="Улаанбаатар">
            {UB_DISTRICTS.map((name) => (
              <option key={name} value={`${name} дүүрэг`}>
                {name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Орон нутаг">
            {PROVINCES.map((name) => (
              <option key={name} value={`${name} аймаг`}>
                {name}
              </option>
            ))}
          </optgroup>
        </Select>
      )}
    </Field>
  );
}

/** The district's kindergartens on NomadKids — both tabs read the same list. */
function useContractedKindergartens(location: string) {
  return useQuery({
    queryKey: qk.publicKindergartens(location),
    queryFn: ({ signal }) =>
      get(
        `/public/kindergartens?${new URLSearchParams({ location })}`,
        kindergartenListSchema,
        signal,
      ),
    enabled: location !== "",
  });
}

/**
 * A kindergarten's name as people type it: no case, no «цэцэрлэг», no
 * punctuation or spaces — «Нарлаг», «нарлаг цэцэрлэг» and «Нарлаг-цэцэрлэг»
 * are one name.
 */
export function normalizeKindergartenName(name: string): string {
  return name
    .toLocaleLowerCase("mn")
    .replace(/цэцэрлэг/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Whether what a teacher typed looks like one of the listed names — either
 * contains the other, once both are normalised, and at least three letters
 * were typed so «На» does not light up half the district.
 */
export function looksLikeSameKindergarten(typed: string, listed: string): boolean {
  const a = normalizeKindergartenName(typed);
  const b = normalizeKindergartenName(listed);
  if (a.length < 3 || b.length === 0) return false;
  return a.includes(b) || b.includes(a);
}

/** Staff of a contracted kindergarten: district → kindergarten → register number. */
function StaffForm({
  location,
  onLocationChange,
  kindergartenId,
  onKindergartenChange,
  onNotListed,
}: {
  location: string;
  onLocationChange: (location: string) => void;
  kindergartenId: string;
  onKindergartenChange: (kindergartenId: string) => void;
  onNotListed: (location: string) => void;
}) {
  const router = useRouter();
  const [registerNumber, setRegisterNumber] = useState("");
  const kindergartens = useContractedKindergartens(location);

  const submit = useMutation({
    mutationFn: () =>
      mutate("/staff-registration", staffSelfRegistrationResultSchema, {
        method: "POST",
        body: { kindergartenId, registerNumber },
      }),
    onSuccess: (result) => router.replace(`/invitation/${result.invitationToken}`),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!submit.isPending) submit.mutate();
  }

  const listMissing = kindergartens.isError && isNotFound(kindergartens.error);

  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={onSubmit}>
      <FormError
        message={
          kindergartens.isError && !listMissing
            ? errorMessage(kindergartens.error)
            : submit.isError
              ? errorMessage(submit.error)
              : null
        }
      />

      <LocationSelect value={location} onChange={onLocationChange} />

      {location === "" || kindergartens.isError ? null : kindergartens.isPending ? (
        <p className="text-caption text-slate-500" aria-live="polite">
          Цэцэрлэгүүдийг ачаалж байна…
        </p>
      ) : kindergartens.data.length === 0 ? (
        <p className="rounded-row bg-slate-50 px-3 py-2.5 text-caption text-slate-600">
          Энд NomadKids ашигладаг цэцэрлэг алга.{" "}
          <button
            type="button"
            onClick={() => onNotListed(location)}
            className="font-bold text-[#0d6b4a] hover:underline"
          >
            Дангаараа бүртгүүлэх
          </button>
        </p>
      ) : (
        <Field label="Цэцэрлэг" required>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={kindergartenId}
              onChange={(event) => {
                if (event.target.value === NOT_LISTED) {
                  onKindergartenChange("");
                  onNotListed(location);
                } else {
                  onKindergartenChange(event.target.value);
                }
              }}
              className={COMPACT_INPUT}
            >
              <option value="">Сонгоно уу</option>
              {kindergartens.data.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
              <option value={NOT_LISTED}>➕ Миний цэцэрлэг энд алга</option>
            </Select>
          )}
        </Field>
      )}

      {listMissing ? (
        <p className="rounded-row bg-slate-50 px-3 py-2.5 text-caption text-slate-600">
          Цэцэрлэгийн жагсаалт удахгүй нээгдэнэ. ESIS кодоо мэдэж байвал{" "}
          <Link href="/staff-register" className="font-bold text-[#176ac2] hover:underline">
            кодоор бүртгүүлнэ үү
          </Link>
          .
        </p>
      ) : null}

      {kindergartenId ? (
        <>
          <Field label="Регистрийн дугаар" required>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                autoComplete="off"
                placeholder="АА00000000"
                value={registerNumber}
                onChange={(event) => setRegisterNumber(event.target.value)}
                className={COMPACT_INPUT}
              />
            )}
          </Field>
          <Button type="submit" disabled={submit.isPending} className="mt-1 w-full">
            {submit.isPending ? "Илгээж байна…" : "Бүртгүүлэх"}
          </Button>
        </>
      ) : null}

      {/* ★ Always shown, as on `/staff-register`: a sentence that appeared only
          after a refusal would itself be an answer. An accountant or a
          director, whom the roster never lets in, needs this way in. */}
      <p className="text-center text-caption text-slate-500">
        Бүртгүүлж чадахгүй бол эрхлэгчдээ хандаж урилга авна уу.
      </p>
      <p className="mt-1 border-t border-slate-100 pt-3 text-center text-caption text-slate-500">
        Цэцэрлэгээ олохгүй байна уу? «Дангаараа» табыг сонгоно уу.
      </p>
    </form>
  );
}

/**
 * A teacher whose kindergarten has no contract, signing up on their own —
 * the fields `POST /teacher-applications` takes (#202). The workspace exists
 * the moment it answers; the password is set on `/invitation/[token]`.
 */
function SoloForm({
  location,
  onLocationChange,
  onUseContracted,
}: {
  location: string;
  onLocationChange: (location: string) => void;
  /** «Цэцэрлэгээр бүртгүүлэх» on a matching name — switch tabs with it chosen. */
  onUseContracted: (kindergartenId: string) => void;
}) {
  const router = useRouter();
  const contracted = useContractedKindergartens(location);
  const [form, setForm] = useState({
    propertyType: "Төрийн бус",
    kindergartenName: "",
    fullName: "",
    phone: "",
    email: "",
  });
  /*
    ★ A teacher whose kindergarten already uses NomadKids belongs in it, not
    beside it. While they type the name, a listed kindergarten that looks like
    it is offered — offered, not forced: «Нарлаг» and «Нарлаг-2» are different
    places. A list that is not served yet (404) simply offers nothing.
  */
  const lookalikes = (contracted.data ?? [])
    .filter((option) => looksLikeSameKindergarten(form.kindergartenName, option.name))
    .slice(0, 3);

  const submit = useMutation({
    mutationFn: () =>
      mutate("/teacher-applications", teacherSignupResultSchema, {
        method: "POST",
        body: {
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          propertyType: form.propertyType,
          location,
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

  if (submit.isSuccess) {
    return (
      <p className="py-6 text-center text-body text-slate-600" aria-live="polite">
        Нууц үг тохируулах хуудас руу шилжиж байна…
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={onSubmit}>
      <FormError
        message={
          submit.isError && Object.keys(errors).length === 0 ? errorMessage(submit.error) : null
        }
      />

      <div className="grid grid-cols-2 gap-3">
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
        <LocationSelect value={location} onChange={onLocationChange} error={errors.location} />
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

      {lookalikes.length > 0 ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-row bg-[#edf6ff] px-3 py-2.5 text-caption text-[#145ca8]"
        >
          {lookalikes.map((option) => (
            <div key={option.id} className="flex flex-col gap-1.5">
              <p>
                <strong>«{option.name}»</strong> NomadKids ашигладаг. Цэцэрлэгээрээ бүртгүүлнэ үү.
              </p>
              <button
                type="button"
                onClick={() => onUseContracted(option.id)}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-pill bg-[#176ac2] px-4 text-body font-bold text-white hover:bg-[#115aa8]"
              >
                Цэцэрлэгээр бүртгүүлэх
                <ArrowRight className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Field label="Овог нэр" error={errors.fullName} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            autoComplete="name"
            value={form.fullName}
            onChange={set("fullName")}
            className={COMPACT_INPUT}
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
              autoComplete="tel"
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

      <Button type="submit" disabled={submit.isPending} className="mt-1 w-full">
        {submit.isPending ? "Илгээж байна…" : "Бүртгүүлэх"}
      </Button>
    </form>
  );
}
