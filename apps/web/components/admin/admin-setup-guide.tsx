"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ListChecks, X } from "lucide-react";
import { z } from "zod";
import { adminDashboardSchema, schoolYearSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { cn } from "@/lib/utils";

const yearsSchema = z.array(schoolYearSchema);

/**
 * "Хэрхэн хичээлийн жил, бүлэг, багш нэмэх" — the client, 2026-09-22:
 * "Удирдлага хэсэг рүү нэвтрэхэд цонх нээгдэж хэрхэн хичээлийн жил бүлэг багш
 * нэмэх. Step guide зураглал оруулах."
 *
 * ★ **It reads the kindergarten's real state rather than being a slideshow.**
 *
 * A static three-panel walkthrough would say "create a school year" to a
 * director who created one in August, which is the fastest way to teach
 * somebody to dismiss a dialog without reading it. Each step here is ticked
 * from data, so the guide is also the answer to "what is left to do".
 *
 * ★★ **The order is a dependency, not a preference.** A group belongs to a
 * school year — `@@unique([schoolYearId, name])` — and `/admin/groups` answers
 * 409 naming this screen when no current year exists (the ESIS roster import
 * does the same). A teacher is then assigned *to* a group. So the three steps
 * are the only order in which they can be done, and saying so is most of the
 * guide's value.
 *
 * ★★★ **It opens itself only while something is unfinished.**
 *
 * "цонх нээгдэж" asks for a window on the way in. A window that opens every
 * time on a kindergarten that finished setting up in August is a nag, and the
 * client's complaint about this product has twice been that screens waste the
 * reader's space. So: auto-open while a step is unmet and undismissed, a button
 * to reopen it afterwards, and the dismissal is remembered per kindergarten —
 * two kindergartens on one deployment are two different setups.
 */
export function AdminSetupGuide() {
  const { primaryKindergartenId } = useSession();

  const overview = useQuery({
    // The same key `AdminOverview` uses, so this costs no second request.
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
    staleTime: 60_000,
  });

  /*
   * ★ The school years themselves, not `currentTerm` from the dashboard.
   *
   * They are different facts and the difference matters here: a kindergarten
   * can have a school year with no term inside it yet, and `currentTerm` is
   * null for both that and "no year at all". Telling a director to create a
   * year they already have is exactly the misleading state this guide exists to
   * clear up, so it asks the question it actually wants answered.
   */
  const years = useQuery({
    queryKey: qk.adminSchoolYears(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 60_000,
  });

  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  const storageKey = primaryKindergartenId ? `nk.setup-guide.${primaryKindergartenId}` : null;

  /*
   * ★ Read in an effect rather than in a `useState` initialiser.
   *
   * `use-form-draft.ts` explains the general rule — the server render has no
   * `localStorage`, so reading it during the first render is a hydration
   * mismatch. Here it also has to wait for `primaryKindergartenId`, which
   * arrives with the session.
   */
  useEffect(() => {
    if (!storageKey) return;
    setDismissed(window.localStorage.getItem(storageKey) === "done");
  }, [storageKey]);

  const ready = overview.isSuccess && years.isSuccess;
  const steps = [
    {
      title: "Хичээлийн жил үүсгэх",
      body: "Бүлэг, ирц, үнэлгээ бүгд хичээлийн жилд харьяалагдана. Тиймээс эхний алхам нь энэ — жилгүйгээр бүлэг үүсгэх боломжгүй.",
      href: "/admin/school-years",
      action: "Хичээлийн жил",
      done: (years.data?.length ?? 0) > 0,
    },
    {
      title: "Бүлэг нэмэх",
      body: "Бүлэг тус бүрд нас, хөтөлбөрийн төрөл, ирцийн хэлбэрийг заана. ESIS-ээс бүлэг, хүүхдийг нэг товчоор татаж болно.",
      href: "/admin/groups",
      action: "Бүлгүүд",
      done: (overview.data?.counts.groups ?? 0) > 0,
    },
    {
      title: "Багш, ажилтан бүртгэх",
      body: "Ажилтан цэцэрлэгийн ESIS дугаараар өөрөө бүртгүүлнэ, эсвэл та урина. Дараа нь бүлэг рүү үндсэн ба туслах багшаар хуваарилна.",
      href: "/admin/users",
      action: "Багш, ажилтан",
      done: (overview.data?.counts.staff ?? 0) > 0,
    },
  ];

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

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <ListChecks size={16} aria-hidden />
          Тохиргооны заавар
          {remaining > 0 ? (
            <span className="ml-1 rounded-pill bg-primary-soft px-2 py-0.5 text-caption font-semibold text-primary">
              {remaining}
            </span>
          ) : null}
        </Button>
      </div>
    );
  }

  return (
    <ModalOverlay label="Цэцэрлэгийг тохируулах заавар" onClose={close}>
      <Card className="w-full max-w-[560px] p-0">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-ink">Цэцэрлэгийг тохируулах</h2>
            <p className="mt-1 text-caption text-muted">
              {remaining === 0
                ? "Гурван алхам бүгд хийгдсэн. Ажиллаж болно."
                : `Гурван алхмыг дарааллаар хийнэ. ${remaining} алхам үлдсэн.`}
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
