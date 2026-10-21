"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { ArrowRight, Check, ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { Art, type ArtName } from "@/components/ui/art";
import { cn } from "@/lib/utils";

/** One step of a set-up guide, ticked from the data it describes. */
export interface SetupStep {
  title: string;
  body: string;
  href: string;
  action: string;
  art: ArtName;
  /** The label under its picture in the strip. */
  short: string;
  done: boolean;
}

/**
 * The set-up guide's window — the director's since 2026-09-22
 * (`AdminSetupGuide`), shared with the teacher's (`TeacherSetupGuide`) since
 * 2026-10-18, the client: "багш болон удирдлага анх нэвтрэхэд хэрхэн бүлэг
 * үүсгэж оруулах, яаж хүн урих боломжтойг харуулах".
 *
 * ★ The caller decides the steps from real data; this decides when to open.
 * It opens itself once `ready` while a step is unmet and the person has not
 * closed it before (remembered per `storageKey`), and otherwise leaves a
 * button to reopen it. Never before `ready`: unticked steps over unanswered
 * queries would tell somebody to do what they have done.
 */
export function SetupGuideDialog({
  steps,
  ready,
  storageKey,
  title,
  buttonLabel,
}: {
  steps: SetupStep[];
  ready: boolean;
  /** Per person and kindergarten — `null` until the session names them. */
  storageKey: string | null;
  title: string;
  buttonLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  /*
   * ★ Read in an effect rather than in a `useState` initialiser: the server
   * render has no `localStorage`, and the key waits for the session.
   */
  useEffect(() => {
    if (!storageKey) return;
    setDismissed(window.localStorage.getItem(storageKey) === "done");
  }, [storageKey]);

  const remaining = steps.filter((step) => !step.done).length;

  /*
   * ★ Auto-open once the data has arrived, never before. Opening on an
   * unanswered query would show three unticked steps to a kindergarten that has
   * all three — the same loading-versus-empty confusion `/admin/users`'s staff
   * table had.
   */
  useEffect(() => {
    if (ready && !dismissed && remaining > 0) setOpen(true);
  }, [ready, dismissed, remaining]);

  function close() {
    setOpen(false);
    /*
      ★ Remembered on close, whether or not the steps are finished. Somebody who
      shuts this to get on with something else has said what they want, and
      reopening it on their next visit would override that. The button below is
      how they get it back.
    */
    if (storageKey) window.localStorage.setItem(storageKey, "done");
    setDismissed(true);
  }

  if (!ready) return null;

  /*
    ★ A small grey link, not a button on its own row — 2026-10-20, the client:
    "маш минимал болгоод анзаарагдахааргүй зай бага эзлэх". It sits in the
    page header beside what is already there.
  */
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-6 items-center gap-1 rounded-control text-caption text-faint transition-colors hover:text-primary"
      >
        <ListChecks size={13} aria-hidden />
        {buttonLabel}
        {remaining > 0 ? <span className="tabular-nums">· {remaining}</span> : null}
      </button>
    );
  }

  return (
    <ModalOverlay label={`${title} заавар`} onClose={close}>
      <Card className="w-full max-w-[560px] p-0">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-caption text-muted">
              {remaining === 0
                ? `${steps.length} алхам бүгд хийгдсэн. Ажиллаж болно.`
                : `${steps.length} алхмыг дарааллаар хийнэ. ${remaining} алхам үлдсэн.`}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Хаах"
            className="shrink-0 rounded-control p-1.5 text-muted hover:bg-sunken hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/*
          ★ The order as a picture — 2026-09-30, the client asked for a step
          guide "зураглал"-тай. Year → group → teacher is a dependency chain,
          not a checklist, and a strip of three pictures with arrows says so
          before a word is read.
        */}
        <div
          aria-hidden
          className="flex items-center justify-center gap-2 border-b border-border-soft bg-sunken/60 px-5 py-4 sm:gap-4"
        >
          {steps.map((step, index) => (
            <Fragment key={step.href}>
              {index > 0 ? <ArrowRight size={18} className="shrink-0 text-faint" /> : null}
              <span className="flex flex-col items-center gap-1.5">
                <span
                  className={cn(
                    "relative grid size-14 place-items-center rounded-card bg-surface shadow-sm ring-1",
                    step.done ? "ring-mint" : "ring-border-soft",
                  )}
                >
                  <Art name={step.art} size={40} className="size-10 object-contain" />
                  {step.done ? (
                    <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-pill bg-mint text-mint-ink">
                      <Check size={12} />
                    </span>
                  ) : null}
                </span>
                <span className="text-caption font-medium text-muted">
                  {index + 1}. {step.short}
                </span>
              </span>
            </Fragment>
          ))}
        </div>

        <ol className="flex flex-col">
          {steps.map((step, index) => (
            <li
              key={step.href}
              className="flex gap-3.5 border-b border-border-soft p-5 last:border-b-0"
            >
              {/*
                ★ The number and the tick share one slot. A tick beside a number
                would leave a done step still numbered "1", reading as a
                to-do with a decoration on it.
              */}
              <span
                aria-hidden
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-pill text-caption font-semibold",
                  step.done ? "bg-mint text-mint-ink" : "bg-primary-soft text-primary",
                )}
              >
                {step.done ? <Check size={16} /> : index + 1}
              </span>

              <Art
                name={step.art}
                size={44}
                className="hidden size-11 shrink-0 object-contain sm:block"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-body font-semibold text-ink">
                  {step.title}
                  {step.done ? (
                    <span className="ml-2 text-caption font-normal text-muted">(хийгдсэн)</span>
                  ) : null}
                </h3>
                <p className="mt-1 text-caption text-muted">{step.body}</p>
                <Button asChild size="sm" variant="secondary" className="mt-3">
                  <Link href={step.href} onClick={close}>
                    {step.action}
                    <ArrowRight size={15} aria-hidden />
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ol>

        {/*
          ★ Not a second "Хаах". The X above already says that, and two controls
          with one accessible name is a screen reader announcing the same button
          twice — it is also what made a test ask which of them it meant. This
          one says what closing *means* here, which differs by state.
        */}
        <div className="flex justify-end border-t border-border p-4">
          <Button size="sm" variant="secondary" onClick={close}>
            {remaining === 0 ? "Ойлголоо" : "Дараа нь"}
          </Button>
        </div>
      </Card>
    </ModalOverlay>
  );
}
