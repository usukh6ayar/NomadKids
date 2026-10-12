"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, X } from "lucide-react";
import { useCallback, useEffect, useState, type UIEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { get, mutate } from "@/lib/api/browser";
import { isNotFound } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import {
  AGREEMENTS,
  acceptedAgreementsSchema,
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
      !accepted.some((row) => row.kind === kind && row.version === AGREEMENTS[kind].version),
  );

  const acceptOnServer = useMutation({
    mutationFn: (kind: AgreementKind) =>
      mutate("/me/agreements", z.unknown(), {
        method: "POST",
        body: { kind, version: AGREEMENTS[kind].version },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.agreements() }),
  });

  const accept = useCallback(
    (kind: AgreementKind) => {
      if (!offline) return acceptOnServer.mutate(kind);
      if (!userId) return;
      const next = [
        ...local.filter((row) => row.kind !== kind),
        { kind, version: AGREEMENTS[kind].version, acceptedAt: new Date().toISOString() },
      ];
      writeLocal(userId, next);
      setLocal(next);
    },
    [offline, acceptOnServer, userId, local],
  );

  return {
    kinds,
    accepted,
    pending,
    /** Known: the server answered, or said it cannot (404). */
    ready: kinds.length === 0 || server.isSuccess || offline,
    accept,
    accepting: acceptOnServer.isPending,
  };
}

/**
 * The agreement as a document — 2026-10-12, the user: formal, small, minimal.
 * A centred title with its version, numbered sections, justified text.
 */
function AgreementText({ agreement }: { agreement: Agreement }) {
  return (
    <div className="text-caption leading-5 text-slate-700">
      <header className="mb-4 text-center">
        <p className="text-caption tracking-[0.14em] text-slate-400">NOMADKIDS</p>
        <h2 className="mt-1 text-compact font-bold uppercase tracking-wide text-ink">
          {agreement.title}
        </h2>
        <p className="mt-0.5 text-caption text-slate-400">Хувилбар: {agreement.version}</p>
      </header>
      <div className="flex flex-col gap-3">
        {agreement.sections.map((section) => (
          <section key={section.heading}>
            <h3 className="font-semibold text-ink">{section.heading}</h3>
            <p className="mt-0.5 text-justify">{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The first-sign-in agreement window — 2026-10-12, the user: a teacher and a
 * guardian read the agreement to the end, press «Зөвшөөрөх», are welcomed, and
 * carry on. It cannot be closed any other way: the system is not used before
 * the agreement is accepted.
 */
export function AgreementGate() {
  const { pending, ready, accept, accepting } = useAgreements();
  const [welcomed, setWelcomed] = useState<"no" | "showing" | "done">("no");
  /** Which agreement has been read to its end — per agreement, not once. */
  const [readKind, setReadKind] = useState<AgreementKind | null>(null);
  const current = pending[0] ? AGREEMENTS[pending[0]] : null;
  const readToEnd = current !== null && readKind === current.kind;

  /*
    ★ Measured when the box appears, not in an effect. The effect ran while the
    window was still hidden (the gate waits for the server first), found no box,
    and never ran again — so a text short enough to need no scrolling left
    «Зөвшөөрөх» disabled for ever (2026-10-12).
  */
  const measure = useCallback(
    (box: HTMLDivElement | null) => {
      if (box && current && box.scrollHeight <= box.clientHeight + 8) setReadKind(current.kind);
    },
    [current],
  );

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const box = event.currentTarget;
    if (current && box.scrollTop + box.clientHeight >= box.scrollHeight - 8) {
      setReadKind(current.kind);
    }
  }

  if (!ready) return null;

  if (current) {
    return (
      <ModalOverlay label={current.title} onClose={() => {}} dismissable={false}>
        <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[520px] flex-col gap-3 rounded-card bg-white p-5 shadow-xl">
          <div
            key={current.kind}
            ref={measure}
            onScroll={onScroll}
            tabIndex={0}
            aria-label="Гэрээний эх бичвэр"
            className="min-h-0 flex-1 overflow-y-auto border-b border-border-soft px-1 pb-4"
          >
            <AgreementText agreement={current} />
          </div>
          <p className="text-center text-caption text-muted">
            {readToEnd
              ? "Гэрээг уншиж танилцсан бол «Зөвшөөрөх» дарна уу."
              : "Гэрээг бүтэн уншина уу. Доош гүйлгэхэд «Зөвшөөрөх» идэвхжинэ."}
          </p>
          <Button
            block
            disabled={!readToEnd || accepting}
            onClick={() => {
              accept(current.kind);
              if (pending.length === 1) setWelcomed("showing");
            }}
          >
            {accepting ? "Хадгалж байна…" : "Зөвшөөрөх"}
          </Button>
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
          <p className="text-body text-slate-600">Гэрээг зөвшөөрлөө. Одоо ажиллаж эхэлнэ үү.</p>
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
 * «Гэрээ» at the right of «Хувийн тохиргоо» — the accepted agreement, to read
 * again. Nothing for a role without one (a director signs by e-mail).
 */
export function AgreementButton() {
  const { kinds, accepted } = useAgreements();
  const [open, setOpen] = useState(false);
  if (kinds.length === 0) return null;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <FileText aria-hidden="true" />
        Гэрээ
      </Button>
      {open ? (
        <ModalOverlay label="Гэрээ" onClose={() => setOpen(false)}>
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
              const agreement = AGREEMENTS[kind];
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
