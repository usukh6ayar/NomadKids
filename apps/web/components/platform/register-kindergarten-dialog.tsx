"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Download, Pencil, Plus, School } from "lucide-react";
import { useState } from "react";
import {
  createdKindergartenSchema,
  esisInstitutionLookupSchema,
  ROLE_LABEL,
  type EsisInstitutionLookup,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { FormError } from "@/components/ui/states";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { cn } from "@/lib/utils";

/**
 * Registering a kindergarten — the platform operator's one creating act.
 *
 * ★ **ESIS first, by construction rather than by advice.** Until 2026-09-19
 * this was one form: eight inputs on open, with the ESIS id as an optional box
 * at the top that most operators skipped. The recommended path was therefore
 * the one that took the most typing, and a tenant registered by hand starts
 * life unmapped — which is the state `platform.service.ts` goes to some length
 * to avoid, because setting the institution afterwards leaves a window in
 * which a kindergarten exists mapped to nothing or to the wrong institution.
 *
 * So the first decision on the screen is which method, ESIS is selected when
 * it opens, and the manual form is not drawn at all until somebody asks for
 * it. The client's words: manual is "тусгай тохиолдолд".
 *
 * ★★ What the ministry cannot supply is still asked for, and only that.
 *
 * `esisInstitutionLookupSchema` carries a name, a long name, an address, a
 * classification, a property type and a staff roster. It carries **no phone
 * and no e-mail** — measured, not assumed — and it has no notion of a login
 * name. So the ESIS path asks for exactly three things: which staff row is the
 * Захирал/Эрхлэгч, the login name that person will type, and optionally their
 * e-mail. Everything else is read back to the operator to check, not retyped.
 *
 * ★★★ The three steps are a wizard over one body. Both paths end in the same
 * `POST /platform/kindergartens` with the same fields; the ESIS path simply
 * fills most of them from the lookup. Nothing about the API changed.
 */
export function RegisterKindergartenDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const [method, setMethod] = useState<"ESIS" | "MANUAL">("ESIS");
  // Declared before the mutations below, which read it when they run.
  const usingEsis = method === "ESIS";
  /** 1 — fetch · 2 — choose the director · 3 — review. Manual ignores it. */
  const [step, setStep] = useState(1);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [adminUsername, setAdminUsername] = useState("");
  const [adminLastName, setAdminLastName] = useState("");
  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const [institutionId, setInstitutionId] = useState("");
  const [institution, setInstitution] = useState<EsisInstitutionLookup | null>(null);
  const [adminPersonId, setAdminPersonId] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: () =>
      get(
        `/platform/esis/institutions/${encodeURIComponent(institutionId.trim())}`,
        esisInstitutionLookupSchema,
      ),
    onSuccess: (found) => {
      setInstitution(found);
      setName(found.name);
      setAddress(found.address ?? "");
      setAdminPersonId(null);
    },
    onError: () => {
      // The previous answer must not survive a failed re-lookup: a stale name
      // beside a new id is the one state this screen must never show.
      setInstitution(null);
      setAdminPersonId(null);
    },
  });

  const create = useMutation({
    mutationFn: () =>
      mutate("/platform/kindergartens", createdKindergartenSchema, {
        method: "POST",
        body: {
          name,
          address: address.trim() === "" ? null : address.trim(),
          phone: phone.trim() === "" ? null : phone.trim(),
          email: email.trim() === "" ? null : email.trim(),
          // Omitted entirely rather than sent as null: the API refuses
          // `adminEsisPersonId` without `esisInstitutionId`, and the manual
          // path must post exactly what it posted before this screen existed.
          ...(usingEsis && institution ? { esisInstitutionId: institution.institutionId } : {}),
          ...(usingEsis && institution && adminPersonId
            ? { adminEsisPersonId: adminPersonId }
            : {}),
          admin: {
            username: adminUsername,
            lastName: adminLastName,
            firstName: adminFirstName,
            email: adminEmail.trim() === "" ? null : adminEmail.trim(),
          },
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["platform", "kindergartens"] });
      // Registering adds one kindergarten and its director to the totals; the
      // toggle beside them touches neither, so only this invalidates them.
      void queryClient.invalidateQueries({ queryKey: qk.platformStats() });
    },
  });

  const errors = fieldErrors(create.error);
  const blocked = institution?.alreadyUsed === true;

  const chooseStaff = (person: EsisInstitutionLookup["staff"][number]) => {
    setAdminPersonId(person.personId);
    // The API overwrites these from the roster anyway — the ministry's
    // spelling is what self-registration matches on later — so the form must
    // not sit there disagreeing with what will actually be saved.
    setAdminLastName(person.lastName);
    setAdminFirstName(person.firstName);
  };

  const switchMethod = (next: "ESIS" | "MANUAL") => {
    setMethod(next);
    setStep(1);
    create.reset();
    if (next === "MANUAL") {
      /*
       * ★ The ESIS answer is dropped, not carried across.
       *
       * Keeping it would post `esisInstitutionId` from a form labelled "гар
       * аргаар", mapping a tenant to an institution the operator believes they
       * opted out of. Clearing the *typed* fields too, because a name prefilled
       * from the ministry is the half of the ESIS answer nobody would notice
       * surviving.
       */
      setInstitution(null);
      setAdminPersonId(null);
      setName("");
      setAddress("");
    }
  };

  if (create.isSuccess) {
    return (
      <ModalOverlay label="Цэцэрлэг бүртгэгдлээ" onClose={onClose}>
        <div className="w-full max-w-[520px] rounded-card border border-border bg-surface p-5">
          <InvitationHandover
            token={create.data.invitationToken}
            title="Цэцэрлэг бүртгэгдлээ"
            subtitle={`${create.data.kindergarten.name} — ${create.data.admin.lastName} ${create.data.admin.firstName}, удирдлага`}
            onClose={onClose}
          />
        </div>
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay label="Цэцэрлэг бүртгэх" onClose={onClose} className="p-0 sm:p-4">
      {/*
        ★ Two panes from `md` up, stacked below it. The method chooser is the
        first decision, so on a phone it has to come first in the flow as well
        as in the source — which a grid with a fixed left column cannot do.
      */}
      <div className="flex max-h-dvh w-full max-w-[920px] flex-col overflow-hidden border-border bg-surface sm:max-h-[calc(100dvh-2rem)] sm:rounded-card sm:border md:flex-row">
        <aside className="shrink-0 border-b border-border-soft bg-primary-soft/60 p-5 md:w-[292px] md:border-b-0 md:border-r">
          <h2 className="text-title font-semibold text-ink">Цэцэрлэг бүртгэх</h2>
          <p className="mt-1 text-body text-muted">Цэцэрлэгийг системд бүртгэх аргаа сонгоно уу.</p>

          <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label="Бүртгэх арга">
            <MethodCard
              selected={usingEsis}
              onSelect={() => switchMethod("ESIS")}
              icon={<School size={20} aria-hidden />}
              title="ESIS-ээс бүртгэх"
              tag="Зөвлөмж болгож буй"
              description="ESIS системээс байгууллагын мэдээллийг автоматаар татаж бүртгэнэ."
            />
            <MethodCard
              selected={!usingEsis}
              onSelect={() => switchMethod("MANUAL")}
              icon={<Pencil size={18} aria-hidden />}
              title="Гар аргаар бүртгэх"
              tag="Тусгай тохиолдолд"
              description="ESIS-ээс мэдээлэл татах боломжгүй үед мэдээллийг гараар оруулна."
            />
          </div>

          {usingEsis ? (
            <ul className="mt-5 hidden flex-col gap-2 md:flex">
              {[
                "Албан ёсны, найдвартай мэдээлэл",
                "Гараар оруулах алдаа гарахгүй",
                "Ажилтны жагсаалт хамт ирнэ",
                "Тенант шууд ESIS-д холбогдоно",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2 text-caption text-muted">
                  <Check size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 hidden rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink md:block">
              Гараар бүртгэсэн цэцэрлэг ESIS-д холбогдоогүй үүснэ. Дараа нь энэ цэцэрлэгийн хуудсаас
              холбож болно.
            </p>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex-1 p-5">
            <FormError message={create.isError ? errorMessage(create.error) : null} />

            {usingEsis ? (
              <EsisFlow
                step={step}
                institutionId={institutionId}
                onInstitutionId={setInstitutionId}
                institution={institution}
                lookupPending={lookup.isPending}
                lookupError={lookup.isError ? errorMessage(lookup.error) : null}
                onLookup={() => lookup.mutate()}
                adminPersonId={adminPersonId}
                onChooseStaff={chooseStaff}
                adminUsername={adminUsername}
                onAdminUsername={setAdminUsername}
                adminLastName={adminLastName}
                onAdminLastName={setAdminLastName}
                adminFirstName={adminFirstName}
                onAdminFirstName={setAdminFirstName}
                adminEmail={adminEmail}
                onAdminEmail={setAdminEmail}
                phone={phone}
                onPhone={setPhone}
                email={email}
                onEmail={setEmail}
                errors={errors}
              />
            ) : (
              <ManualFlow
                name={name}
                onName={setName}
                address={address}
                onAddress={setAddress}
                phone={phone}
                onPhone={setPhone}
                email={email}
                onEmail={setEmail}
                adminLastName={adminLastName}
                onAdminLastName={setAdminLastName}
                adminFirstName={adminFirstName}
                onAdminFirstName={setAdminFirstName}
                adminUsername={adminUsername}
                onAdminUsername={setAdminUsername}
                adminEmail={adminEmail}
                onAdminEmail={setAdminEmail}
                errors={errors}
              />
            )}
          </div>

          <Footer
            usingEsis={usingEsis}
            step={step}
            canAdvance={usingEsis ? canAdvance(step, institution, adminUsername) : false}
            blocked={blocked}
            pending={create.isPending}
            onBack={() => setStep((current) => current - 1)}
            onNext={() => setStep((current) => current + 1)}
            onSubmit={() => create.mutate()}
            onCancel={onClose}
          />
        </div>
      </div>
    </ModalOverlay>
  );
}

/**
 * Whether the ESIS path may leave this step.
 *
 * Step 1 needs an institution that is not already registered; step 2 needs a
 * login name, which is the one thing the ministry cannot give us. The director
 * row itself is *not* required — a lookup that returns no staff is a real
 * answer (`esis-institution-lookup.service.ts`), and the operator types the
 * two name fields instead.
 */
function canAdvance(
  step: number,
  institution: EsisInstitutionLookup | null,
  adminUsername: string,
): boolean {
  if (step === 1) return Boolean(institution) && institution?.alreadyUsed !== true;
  if (step === 2) return adminUsername.trim().length > 0;
  return true;
}

function MethodCard({
  selected,
  onSelect,
  icon,
  title,
  tag,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  tag: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-card border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-surface shadow-sm"
          : "border-border-soft bg-surface/70 hover:border-border",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-9 shrink-0 place-items-center rounded-control",
          selected ? "bg-primary-soft text-primary" : "bg-canvas text-muted",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-body font-semibold",
            selected ? "text-primary-strong" : "text-ink",
          )}
        >
          {title}
        </span>
        <span className="block text-caption text-muted">{tag}</span>
        {/*
          The sentence explaining the method is on the card from `md` up only.
          On a phone the two cards sit above the form and four lines of prose
          between the question and the first field is the reason people stop
          reading either.
        */}
        <span className="mt-1 hidden text-caption leading-relaxed text-muted md:block">
          {description}
        </span>
      </span>
      {selected ? (
        <span className="grid size-5 shrink-0 place-items-center rounded-pill bg-primary text-primary-ink">
          <Check size={13} strokeWidth={3} aria-hidden />
        </span>
      ) : null}
    </button>
  );
}

function StepHeader({ step, title, lede }: { step: number; title: string; lede: string }) {
  return (
    <div className="mb-4">
      <p className="text-caption font-semibold uppercase tracking-wide text-primary">
        Алхам {step} / 3
      </p>
      <h3 className="mt-0.5 text-lead font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-body leading-relaxed text-muted">{lede}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-border-soft py-2 last:border-b-0">
      <dt className="w-[150px] shrink-0 text-caption text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-body text-ink">{value || "—"}</dd>
    </div>
  );
}

function EsisFlow(props: {
  step: number;
  institutionId: string;
  onInstitutionId: (value: string) => void;
  institution: EsisInstitutionLookup | null;
  lookupPending: boolean;
  lookupError: string | null;
  onLookup: () => void;
  adminPersonId: string | null;
  onChooseStaff: (person: EsisInstitutionLookup["staff"][number]) => void;
  adminUsername: string;
  onAdminUsername: (value: string) => void;
  adminLastName: string;
  onAdminLastName: (value: string) => void;
  adminFirstName: string;
  onAdminFirstName: (value: string) => void;
  adminEmail: string;
  onAdminEmail: (value: string) => void;
  phone: string;
  onPhone: (value: string) => void;
  email: string;
  onEmail: (value: string) => void;
  errors: Record<string, string | undefined>;
}) {
  const { institution, step } = props;

  if (step === 1) {
    return (
      <>
        <StepHeader
          step={1}
          title="ESIS мэдээлэл"
          lede="ESIS байгууллагын ID оруулж мэдээллийг автоматаар татна."
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="ESIS байгууллагын ID" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={props.institutionId}
                  onChange={(event) => props.onInstitutionId(event.target.value)}
                  placeholder="Жишээ: 42778"
                  inputMode="numeric"
                  autoFocus
                />
              )}
            </Field>
          </div>
          <Button
            type="button"
            onClick={props.onLookup}
            disabled={props.institutionId.trim() === "" || props.lookupPending}
          >
            <Download size={17} aria-hidden />
            {props.lookupPending ? "Татаж байна…" : "ESIS-ээс татах"}
          </Button>
        </div>

        {props.lookupError ? (
          <p role="alert" className="mt-2 text-caption text-danger">
            {props.lookupError}
          </p>
        ) : null}

        <h4 className="mt-5 text-body font-semibold text-ink">Татагдсан мэдээлэл</h4>

        {!institution ? (
          <div className="mt-2 grid place-items-center gap-2 rounded-card bg-canvas px-4 py-8 text-center">
            <School size={28} className="text-muted/60" aria-hidden />
            <p className="text-caption leading-relaxed text-muted">
              ESIS байгууллагын ID оруулж
              <br />
              мэдээллийг татна уу.
            </p>
          </div>
        ) : (
          <div className="mt-2 rounded-card border border-border-soft bg-canvas px-4 py-2">
            <dl>
              <SummaryRow label="Цэцэрлэгийн нэр" value={institution.name} />
              <SummaryRow label="Албан ёсны нэр" value={institution.longName} />
              <SummaryRow label="Хаяг" value={institution.address} />
              <SummaryRow label="Ангилал" value={institution.classification} />
              <SummaryRow label="Өмчийн хэлбэр" value={institution.propertyType} />
              <SummaryRow
                label="Ажилтан"
                value={`${institution.staff.length} хүн ESIS-д бүртгэлтэй`}
              />
            </dl>
          </div>
        )}

        {institution?.alreadyUsed ? (
          <p role="alert" className="mt-2 text-caption text-danger">
            Энэ институц аль хэдийн бүртгэлтэй: {institution.name}
          </p>
        ) : null}

        {/*
          A warning, not a block. The ministry's classification is free text we
          do not control, and refusing outright would make a mislabelled
          kindergarten unregisterable.
        */}
        {institution && !institution.isKindergarten ? (
          <p className="mt-2 text-caption text-warning">
            Анхаар: энэ байгууллага цэцэрлэг биш ({institution.classification ?? "тодорхойгүй"}).
          </p>
        ) : null}
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <StepHeader
          step={2}
          title="Захирал/Эрхлэгч"
          lede="ESIS-ийн ажилтны жагсаалтаас удирдлагыг сонгоно уу. Нэвтрэх нэрийг ESIS өгдөггүй тул та оруулна."
        />

        {institution && institution.staff.length > 0 ? (
          <fieldset className="rounded-card border border-border-soft p-2">
            <legend className="px-1 text-caption text-muted">ESIS-ийн ажилтны жагсаалт</legend>
            <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
              {institution.staff.map((person) => (
                <label
                  key={person.personId}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-control px-2 py-2 transition-colors",
                    props.adminPersonId === person.personId ? "bg-primary-soft" : "hover:bg-canvas",
                  )}
                >
                  <input
                    type="radio"
                    name="esis-admin"
                    className="mt-1"
                    value={person.personId}
                    checked={props.adminPersonId === person.personId}
                    onChange={() => props.onChooseStaff(person)}
                  />
                  <span className="min-w-0">
                    <span className="block text-body text-ink">
                      {person.lastName} {person.firstName}
                    </span>
                    <span className="block text-caption text-muted">
                      {[
                        person.positionName,
                        person.suggestedRole && ROLE_LABEL[person.suggestedRole],
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Албан тушаал тодорхойгүй"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
            Энэ байгууллагад бүртгэлтэй ажилтан ESIS-ээс ирсэнгүй. Удирдлагын нэрийг доор гараар
            бөглөнө үү.
          </p>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Овог" error={props.errors["admin.lastName"]} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={props.adminLastName}
                onChange={(event) => props.onAdminLastName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Нэр" error={props.errors["admin.firstName"]} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={props.adminFirstName}
                onChange={(event) => props.onAdminFirstName(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Нэвтрэх нэр"
            error={props.errors["admin.username"]}
            hint="Латин үсэг, тоо, . _ -"
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={props.adminUsername}
                onChange={(event) => props.onAdminUsername(event.target.value)}
                autoCapitalize="none"
              />
            )}
          </Field>
          <Field label="Удирдлагын и-мэйл" error={props.errors["admin.email"]} hint="Заавал биш.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                value={props.adminEmail}
                onChange={(event) => props.onAdminEmail(event.target.value)}
                autoCapitalize="none"
              />
            )}
          </Field>
        </div>

        {/*
          ★ Phone and e-mail are asked here rather than read from ESIS because
          the lookup does not carry them — `esisInstitutionLookupSchema` has a
          name, an address, a classification and a roster, and nothing else.
          Both stay optional, as they are on the kindergarten record itself.
        */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Цэцэрлэгийн утас" error={props.errors.phone} hint="ESIS-д байхгүй.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="tel"
                inputMode="tel"
                value={props.phone}
                onChange={(event) => props.onPhone(event.target.value)}
              />
            )}
          </Field>
          <Field label="Цэцэрлэгийн и-мэйл" error={props.errors.email} hint="ESIS-д байхгүй.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                value={props.email}
                onChange={(event) => props.onEmail(event.target.value)}
                autoCapitalize="none"
              />
            )}
          </Field>
        </div>
      </>
    );
  }

  return (
    <>
      <StepHeader
        step={3}
        title="Мэдээллийг шалгах"
        lede="Доорх мэдээллээр цэцэрлэг үүсч, удирдлагын урилга бэлэн болно."
      />

      <div className="rounded-card border border-border-soft bg-canvas px-4 py-2">
        <dl>
          <SummaryRow label="Цэцэрлэгийн нэр" value={institution?.name} />
          <SummaryRow label="ESIS institution ID" value={institution?.institutionId} />
          <SummaryRow label="Хаяг" value={institution?.address} />
          <SummaryRow label="Утас" value={props.phone} />
          <SummaryRow label="И-мэйл" value={props.email} />
          <SummaryRow
            label="Захирал/Эрхлэгч"
            value={`${props.adminLastName} ${props.adminFirstName}`.trim()}
          />
          <SummaryRow label="Нэвтрэх нэр" value={props.adminUsername} />
          <SummaryRow label="Удирдлагын и-мэйл" value={props.adminEmail} />
          <SummaryRow
            label="Ажилтны жагсаалт"
            value={`${institution?.staff.length ?? 0} хүн хамт хадгалагдана`}
          />
        </dl>
      </div>

      <p className="mt-3 text-caption leading-relaxed text-muted">
        Нууц үг энд тавигдахгүй — удирдлага өөрөө урилгын холбоосоор орж сонгоно.
      </p>
    </>
  );
}

function ManualFlow(props: {
  name: string;
  onName: (value: string) => void;
  address: string;
  onAddress: (value: string) => void;
  phone: string;
  onPhone: (value: string) => void;
  email: string;
  onEmail: (value: string) => void;
  adminLastName: string;
  onAdminLastName: (value: string) => void;
  adminFirstName: string;
  onAdminFirstName: (value: string) => void;
  adminUsername: string;
  onAdminUsername: (value: string) => void;
  adminEmail: string;
  onAdminEmail: (value: string) => void;
  errors: Record<string, string | undefined>;
}) {
  return (
    <>
      <div className="mb-4">
        <h3 className="text-lead font-semibold text-ink">Гар аргаар бүртгэх</h3>
        <p className="mt-1 text-body leading-relaxed text-muted">
          ESIS-ээс татах боломжгүй үед ашиглана. Цэцэрлэг ESIS-д холбогдоогүй үүснэ.
        </p>
      </div>

      <fieldset>
        <legend className="mb-3 text-body font-semibold text-ink">Цэцэрлэгийн мэдээлэл</legend>

        <Field label="Цэцэрлэгийн нэр" error={props.errors.name} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={props.name}
              onChange={(event) => props.onName(event.target.value)}
              autoFocus
            />
          )}
        </Field>

        <div className="mt-4">
          <Field label="Хаяг" error={props.errors.address}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={props.address}
                onChange={(event) => props.onAddress(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Утас" error={props.errors.phone}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="tel"
                inputMode="tel"
                value={props.phone}
                onChange={(event) => props.onPhone(event.target.value)}
              />
            )}
          </Field>
          <Field label="И-мэйл" error={props.errors.email} hint="Заавал биш.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                value={props.email}
                onChange={(event) => props.onEmail(event.target.value)}
                autoCapitalize="none"
              />
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="mt-5 border-t border-border pt-5">
        <legend className="mb-3 text-body font-semibold text-ink">Эхний удирдлага</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Овог" error={props.errors["admin.lastName"]} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={props.adminLastName}
                onChange={(event) => props.onAdminLastName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Нэр" error={props.errors["admin.firstName"]} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={props.adminFirstName}
                onChange={(event) => props.onAdminFirstName(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Нэвтрэх нэр"
            error={props.errors["admin.username"]}
            hint="Латин үсэг, тоо, . _ -"
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={props.adminUsername}
                onChange={(event) => props.onAdminUsername(event.target.value)}
                autoCapitalize="none"
              />
            )}
          </Field>
          <Field label="И-мэйл" error={props.errors["admin.email"]} hint="Заавал биш.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                value={props.adminEmail}
                onChange={(event) => props.onAdminEmail(event.target.value)}
                autoCapitalize="none"
              />
            )}
          </Field>
        </div>
      </fieldset>

      <p className="mt-4 text-caption leading-relaxed text-muted">
        Нууц үг энд тавигдахгүй — удирдлага өөрөө урилгын холбоосоор орж сонгоно.
      </p>
    </>
  );
}

function Footer({
  usingEsis,
  step,
  canAdvance: advanceable,
  blocked,
  pending,
  onBack,
  onNext,
  onSubmit,
  onCancel,
}: {
  usingEsis: boolean;
  step: number;
  canAdvance: boolean;
  blocked: boolean;
  pending: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const lastStep = !usingEsis || step === 3;

  return (
    <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-surface px-5 py-4">
      <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
        Болих
      </Button>

      <span className="flex-1" />

      {usingEsis && step > 1 ? (
        <Button type="button" variant="secondary" onClick={onBack} disabled={pending}>
          <ArrowLeft size={17} aria-hidden />
          Буцах
        </Button>
      ) : null}

      {lastStep ? (
        <Button type="button" onClick={onSubmit} disabled={pending || blocked}>
          <Plus size={17} aria-hidden />
          {pending ? "Бүртгэж байна…" : "Цэцэрлэг бүртгэх"}
        </Button>
      ) : (
        <Button type="button" onClick={onNext} disabled={!advanceable}>
          Дараах
          <ArrowRight size={17} aria-hidden />
        </Button>
      )}
    </div>
  );
}
