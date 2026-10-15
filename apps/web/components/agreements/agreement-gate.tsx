"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Printer, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useLogout, useSession } from "@/lib/auth/session";
import {
  acceptedAgreementsSchema,
  agreementFor,
  agreementKindsFor,
  type AcceptedAgreement,
  type Agreement,
  type AgreementKind,
} from "@/lib/agreements";
import { formatDateTime } from "@/lib/format";

/*
 * ★ Until `GET/POST /me/agreements` exist (`lib/agreements.ts`), the
 * acceptance is kept in this browser so the flow can be tried. It is not a
 * record anybody can rely on — a cleared browser asks again — and it goes as
 * soon as the API answers.
 */
const localKey = (userId: string) => `nomadkids.agreements.${userId}`;

function readLocal(userId: string): AcceptedAgreement[] {
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    const parsed = acceptedAgreementsSchema.shape.accepted.safeParse(raw ? JSON.parse(raw) : []);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function writeLocal(userId: string, accepted: AcceptedAgreement[]) {
  try {
    window.localStorage.setItem(localKey(userId), JSON.stringify(accepted));
  } catch {
    // Private mode or blocked storage: the gate simply asks again next time.
  }
}

/** This person's agreements, which of them still wait, and how to accept one. */
export function useAgreements() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const kinds = agreementKindsFor(session);

  const server = useQuery({
    queryKey: qk.agreements(),
    queryFn: () => get("/me/agreements", acceptedAgreementsSchema),
    enabled: Boolean(userId) && kinds.length > 0,
    retry: false,
  });
  const offline = server.isError && isNotFound(server.error);

  const [local, setLocal] = useState<AcceptedAgreement[]>([]);
  useEffect(() => {
    if (userId && offline) setLocal(readLocal(userId));
  }, [userId, offline]);

  const accepted = offline ? local : (server.data?.accepted ?? []);
  const pending = kinds.filter(
    (kind) =>
      !accepted.some(
        (row) => row.kind === kind && row.version === agreementFor(kind, session).version,
      ),
  );

  const acceptOnServer = useMutation({
    mutationFn: (kind: AgreementKind) =>
      mutate("/me/agreements", z.unknown(), {
        method: "POST",
        body: { kind, version: agreementFor(kind, session).version },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.agreements() }),
  });

  const accept = useCallback(
    (kind: AgreementKind) => {
      if (!offline) return acceptOnServer.mutate(kind);
      if (!userId) return;
      const next = [
        ...local.filter((row) => row.kind !== kind),
        {
          kind,
          version: agreementFor(kind, session).version,
          acceptedAt: new Date().toISOString(),
        },
      ];
      writeLocal(userId, next);
      setLocal(next);
    },
    [offline, acceptOnServer, userId, local, session],
  );

  return {
    kinds,
    accepted,
    pending,
    /** Known: the server answered, or said it cannot (404). */
    ready: kinds.length === 0 || server.isSuccess || offline,
    accept,
    accepting: acceptOnServer.isPending,
    /** The server refused — said in the window, never a silent button. */
    acceptError: acceptOnServer.isError ? errorMessage(acceptOnServer.error) : null,
  };
}

/**
 * The agreement as a document — 2026-10-12, the user: formal, small, minimal.
 * A centred title with its version, numbered sections, justified text.
 */
/**
 * The agreement as a paper document — 2026-10-14, the user: «би явуулсан
 * пдф шигээ загвараар албан ёсны». The whole text, open: a running head,
 * the title centred over a rule, the parties' table, bold section heads,
 * numbered clauses, justified, the legal basis at the foot.
 */
const DEFAULT_FORM = "Цахим хэлбэрээр байгуулах гэрээ";

/** «solo-2.0» → «2.0»: the number on the paper, not the stored key. */
function versionNumber(agreement: Agreement) {
  return agreement.version.replace(/^[a-z]+-/, "");
}

function AgreementText({ agreement }: { agreement: Agreement }) {
  const version = versionNumber(agreement);
  return (
    <article className="relative bg-white font-serif text-[#0f172a]">
      <div className="mb-5 flex items-center justify-between gap-3 border-b border-slate-200 pb-1.5">
        <p className="text-caption font-semibold tracking-wide text-slate-500">
          NOMADKIDS.MN • ЦАХИМ ҮЙЛЧИЛГЭЭНИЙ ГЭРЭЭ
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => printAgreement(agreement)}
          aria-label="Гэрээг хэвлэх, PDF болгох"
          className="font-sans"
        >
          <Printer size={16} aria-hidden="true" />
          PDF
        </Button>
      </div>

      <header className="text-center">
        <h2 className="mx-auto max-w-[26ch] text-title font-bold uppercase leading-snug">
          {agreement.title}
        </h2>
        <div className="my-3 h-px w-full bg-[#2f6fb0]" />
        {agreement.subtitle ? (
          <p className="text-compact italic text-slate-600">{agreement.subtitle}</p>
        ) : null}
        <p className="mt-1 text-caption text-slate-500">
          Гэрээний хувилбар: {version} | {agreement.form ?? DEFAULT_FORM}
        </p>
      </header>

      {agreement.parties?.length ? (
        <table className="mt-4 w-full border-collapse text-caption leading-5">
          <tbody>
            {agreement.parties.map((party) => (
              <tr key={party.label} className="border-y border-slate-200">
                <th
                  scope="row"
                  className="w-[34%] bg-slate-50 px-3 py-2 text-left align-top font-bold"
                >
                  {party.label}
                </th>
                <td className="px-3 py-2 align-top">{party.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="mt-5 flex flex-col gap-4">
        {agreement.sections.map((section) => (
          <section key={section.heading} aria-label={section.heading}>
            <h3 className="mb-1.5 text-compact font-bold">{section.heading}</h3>
            <div className="flex flex-col gap-1.5 text-compact leading-6">
              {section.body.split("\n").map((line) => {
                const numbered = line.match(/^(\d+(?:\.\d+)*\.)\s+(.*)$/);
                return numbered ? (
                  <p key={line} className="pl-8 -indent-8 text-justify">
                    <span className="font-bold">{numbered[1]}</span> {numbered[2]}
                  </p>
                ) : (
                  <p key={line} className="text-justify">
                    {line}
                  </p>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {agreement.legalBasis ? (
        <p className="mt-5 text-caption italic leading-5 text-slate-600">
          Хууль зүйн үндэслэл: {agreement.legalBasis}
        </p>
      ) : null}
    </article>
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * «PDF» — the full text on paper, through the browser's print (save as PDF):
 * the agreement can be read and kept before it is accepted (§2.1).
 */
function printAgreement(agreement: Agreement) {
  const html = `<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>${escapeHtml(
    agreement.title,
  )}</title><style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Noto Serif", "Times New Roman", serif; color: #0f172a; font-size: 10.5pt; line-height: 1.5; }
h1 { text-align: center; font-size: 15pt; margin: 0 0 2mm; text-transform: uppercase; }
.sub { text-align: center; color: #475569; font-style: italic; margin: 0 0 1mm; }
.ver { text-align: center; color: #64748b; font-size: 9pt; margin: 0 0 5mm; }
table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
th, td { border: 1px solid #cbd5e1; padding: 2mm 3mm; text-align: left; vertical-align: top; font-size: 9.5pt; }
th { width: 30%; background: #f8fafc; }
h2 { font-size: 11pt; margin: 5mm 0 1.5mm; }
p { margin: 0 0 1.5mm; text-align: justify; }
</style></head><body>
<p style="text-align:right;font-size:8.5pt;color:#64748b;border-bottom:1px solid #cbd5e1;padding-bottom:1mm;margin:0 0 6mm">NOMADKIDS.MN • ЦАХИМ ҮЙЛЧИЛГЭЭНИЙ ГЭРЭЭ</p>
<h1>${escapeHtml(agreement.title)}</h1><hr style="border:0;border-top:1px solid #2f6fb0;margin:2mm 0 3mm">
${agreement.subtitle ? `<p class="sub">${escapeHtml(agreement.subtitle)}</p>` : ""}
<p class="ver">Гэрээний хувилбар: ${escapeHtml(versionNumber(agreement))} | ${escapeHtml(agreement.form ?? DEFAULT_FORM)}</p>
${
  agreement.parties?.length
    ? `<table>${agreement.parties
        .map(
          (party) =>
            `<tr><th>${escapeHtml(party.label)}</th><td>${escapeHtml(party.value)}</td></tr>`,
        )
        .join("")}</table>`
    : ""
}
${agreement.sections
  .map(
    (section) =>
      `<h2>${escapeHtml(section.heading)}</h2>${section.body
        .split("\n")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("")}`,
  )
  .join("")}
${agreement.legalBasis ? `<p style="font-style:italic;font-size:9pt;color:#475569;margin-top:5mm">Хууль зүйн үндэслэл: ${escapeHtml(agreement.legalBasis)}</p>` : ""}
</body></html>`;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  document.body.appendChild(frame);
}

/**
 * The first-sign-in agreement window — 2026-10-12, the user: a teacher and a
 * guardian read the agreement to the end, press «Зөвшөөрөх», are welcomed, and
 * carry on. It cannot be closed any other way: the system is not used before
 * the agreement is accepted.
 */
export function AgreementGate() {
  const { session } = useSession();
  const logout = useLogout();
  const { pending, ready, accept, accepting, acceptError } = useAgreements();
  const [welcomed, setWelcomed] = useState<"no" | "showing" | "done">("no");
  /** The agreement whose «уншиж, зөвшөөрч байна» is ticked — per agreement. */
  const [ticked, setTicked] = useState<AgreementKind | null>(null);
  /** «Татгалзах» pressed: nothing opens without it (§2.4). */
  const [declined, setDeclined] = useState(false);
  const current = pending[0] ? agreementFor(pending[0], session) : null;

  if (!ready) return null;

  if (current && declined) {
    return (
      <ModalOverlay label="Гэрээг зөвшөөрөөгүй" onClose={() => {}} dismissable={false}>
        <div className="flex w-full max-w-[400px] flex-col gap-3 rounded-card bg-white p-6 text-center shadow-xl">
          <h2 className="text-lead font-bold text-ink">Гэрээг зөвшөөрөөгүй</h2>
          <p className="text-body text-slate-600">
            Гэрээг зөвшөөрөөгүй тул үйлчилгээ нээгдэхгүй. Дахин уншиж зөвшөөрөх эсвэл системээс гарч
            болно.
          </p>
          <div className="mt-1 flex flex-col gap-2">
            <Button onClick={() => setDeclined(false)}>Гэрээ рүү буцах</Button>
            <Button variant="ghost" onClick={() => void logout()}>
              Системээс гарах
            </Button>
          </div>
        </div>
      </ModalOverlay>
    );
  }

  if (current) {
    const isTicked = ticked === current.kind;
    return (
      <ModalOverlay label={current.title} onClose={() => {}} dismissable={false}>
        <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[720px] flex-col rounded-card bg-white shadow-xl">
          <div
            key={current.kind}
            tabIndex={0}
            aria-label="Гэрээний эх бичвэр"
            className="min-h-0 flex-1 overflow-y-auto p-5"
          >
            <AgreementText agreement={current} />
          </div>
          <div className="flex flex-col gap-3 border-t border-border-soft p-4">
            <label className="flex items-start gap-2 text-compact text-ink">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={isTicked}
                onChange={(event) => setTicked(event.target.checked ? current.kind : null)}
              />
              {current.consent ?? "Гэрээг уншиж, нөхцөлийг зөвшөөрч байна."}
            </label>
            {acceptError ? (
              <p role="alert" className="text-caption text-danger">
                Зөвшөөрөл хадгалагдсангүй: {acceptError}
              </p>
            ) : null}
            {current.consentNote ? (
              <p className="text-caption text-muted">{current.consentNote}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={accepting}
                onClick={() => setDeclined(true)}
              >
                Татгалзах
              </Button>
              <Button
                className="flex-[2]"
                disabled={!isTicked || accepting}
                onClick={() => {
                  accept(current.kind);
                  if (pending.length === 1) setWelcomed("showing");
                }}
              >
                {accepting ? "Хадгалж байна…" : (current.acceptLabel ?? "Зөвшөөрөх")}
              </Button>
            </div>
          </div>
        </div>
      </ModalOverlay>
    );
  }

  if (welcomed === "showing") {
    return (
      <ModalOverlay label="Системд тавтай морил" onClose={() => setWelcomed("done")}>
        <div className="flex w-full max-w-[380px] flex-col items-center gap-2 rounded-card bg-white p-6 text-center shadow-xl">
          <CheckCircle2 className="size-10 text-mint-ink" aria-hidden="true" />
          <h2 className="text-lead font-extrabold text-[#102f5d]">Системд тавтай морил</h2>
          <p className="text-body text-slate-600">
            Гэрээг зөвшөөрлөө. «Хувийн тохиргоо» → «Миний гэрээ»-нээс хүссэн үедээ дахин харна.
          </p>
          <Button className="mt-2" onClick={() => setWelcomed("done")}>
            Эхлэх
          </Button>
        </div>
      </ModalOverlay>
    );
  }

  return null;
}

/**
 * «Миний гэрээ» at the right of «Хувийн тохиргоо» — named as the agreement
 * names it (§2.4, 2026-10-14); — the accepted agreement, to read
 * again. Nothing for a role without one (a director signs by e-mail).
 */
export function AgreementButton() {
  const { session } = useSession();
  const { kinds, accepted } = useAgreements();
  const [open, setOpen] = useState(false);
  if (kinds.length === 0) return null;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <FileText aria-hidden="true" />
        Миний гэрээ
      </Button>
      {open ? (
        <ModalOverlay label="Миний гэрээ" onClose={() => setOpen(false)}>
          <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[560px] flex-col gap-4 overflow-y-auto rounded-card bg-white p-5 shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Хаах"
              className="absolute right-2 top-2 grid size-10 place-items-center rounded-pill text-slate-500 hover:bg-slate-100"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            {kinds.map((kind) => {
              const agreement = agreementFor(kind, session);
              const row = accepted.find(
                (item) => item.kind === kind && item.version === agreement.version,
              );
              return (
                <article key={kind} className="flex flex-col gap-3 pt-4">
                  <AgreementText agreement={agreement} />
                  <p className="border-t border-border-soft pt-3 text-center text-caption text-muted">
                    {row ? `Зөвшөөрсөн: ${formatDateTime(row.acceptedAt)}` : "Зөвшөөрөөгүй байна."}
                  </p>
                </article>
              );
            })}
          </div>
        </ModalOverlay>
      ) : null}
    </>
  );
}
