"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { ROLE_LABEL } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";
import { StaffRecordsButton } from "@/components/admin/staff-records-dialog";
import {
  STAFF_KIND_LABEL,
  attentionReason,
  displayName,
  positionLabel,
  staffStatus,
  type StaffDirectoryRow,
} from "./staff-model";
import { StaffSourceBadge, StaffStatusBadge } from "./staff-status";

/**
 * One staff member, in full — the other half of the table above.
 *
 * ★ **Everything this screen knows lives here, and only here.** The table
 * carries six columns because six is what a person can scan; the fields behind
 * them are not gone, they are one press away. That split is the whole
 * redesign: the screen it replaced showed every field of every person at once,
 * which is a page you read rather than a directory you use.
 *
 * ★★ A right-hand drawer on a desktop, a full-height sheet on a phone — one
 * element, two layouts. It is `inset-y-0 right-0` with a width that goes to
 * `100%` below `sm`, rather than two components that drift apart.
 *
 * ★★★ It draws only what exists. A ministry field the service left blank is
 * absent, and a whole section with nothing in it is not rendered — a drawer of
 * twelve dashes tells a director their connection is broken when it is not.
 *
 * ★★★★ **It does not trap focus, and that is a known gap rather than an
 * oversight.** `useBackdropDismiss` gives it Escape, backdrop dismissal and a
 * scroll lock; `FormDialog` and `ConfirmDialog` wrap Radix and do trap, which
 * is where a dialog that takes input should start. This one takes no input —
 * it is a read with two links out — so the close button is focused on open and
 * Escape is always a way back. A keyboard reader can still Tab past it into
 * the table behind, which is the part that wants Radix if this ever grows a
 * form.
 */
export function StaffDetailDrawer({
  row,
  kindergartenId,
  onClose,
  onInvite,
  onLink,
}: {
  row: StaffDirectoryRow;
  kindergartenId: string | null;
  onClose: () => void;
  /** Opens the screen's existing invitation dialog, pre-filled from this row. */
  onInvite: (row: StaffDirectoryRow) => void;
  /**
   * Opens the link dialog for an ESIS person with no account here.
   *
   * ★ Absent when there is nothing to link to — every local account already
   * carries an `esisPersonId`. The button is then not drawn at all, rather
   * than drawn and answering "нэг ч бүртгэл алга" after a press.
   */
  onLink?: (row: StaffDirectoryRow) => void;
}) {
  const backdrop = useBackdropDismiss(onClose);
  const position = positionLabel(row);
  const attention = attentionReason(row);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${displayName(row)} — дэлгэрэнгүй`}
      {...backdrop}
      className="fixed inset-0 z-50 flex justify-end bg-ink/50"
    >
      <div className="flex h-full w-full flex-col overflow-y-auto border-s border-border bg-surface sm:max-w-[420px]">
        <header className="sticky top-0 flex items-start gap-3 border-b border-border bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title font-semibold text-ink">{displayName(row)}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-caption text-muted">{STAFF_KIND_LABEL[row.kind]}</span>
              <StaffStatusBadge status={staffStatus(row)} />
              <StaffSourceBadge row={row} />
            </p>
          </div>
          {/* Focused on open: without it the keyboard stays on the row behind. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            autoFocus
            className="grid size-11 shrink-0 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-col gap-5 px-5 py-5">
          {/*
            ★ The reason first, because it is what a row marked Анхаарах was
            opened to find out. Amber, which the design direction reserves for
            a missing or unsynced state — never red, since nothing has failed.
          */}
          {attention ? (
            <p className="rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
              {attention}
            </p>
          ) : null}

          <Section title="Ерөнхий мэдээлэл">
            <DetailRow label="Утас" value={row.contact.phone} />
            <DetailRow label="И-мэйл" value={row.contact.email} />
            <DetailRow label="Нэвтрэх нэр" value={row.contact.username} />
            <DetailRow
              label="Албан и-мэйл"
              value={row.employment?.officialEmail ?? row.teaching?.officialEmail ?? null}
            />
          </Section>

          <Section title="Ажил эрхлэлт">
            <DetailRow label="Албан тушаал" value={position} />
            <DetailRow label="Мэргэшил" value={row.employment?.minor ?? null} />
            <DetailRow label="Ажилласан жил" value={row.employment?.yearsOfService ?? null} />
            <DetailRow
              label="Боловсролын салбарт"
              value={row.employment?.educationSectorYears ?? null}
            />
            <DetailRow label="Багшийн төрөл" value={row.teaching?.instructorTypeName ?? null} />
            <DetailRow
              label="Заах аргын нэгдэл"
              value={row.teaching?.subjectDepartmentName ?? null}
            />
          </Section>

          <Section title="Бүлэг">
            {row.assignedGroups.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {row.assignedGroups.map((group) => (
                  <li key={group.groupId} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/groups/${group.groupId}`}
                      className="text-body text-primary hover:underline"
                    >
                      {group.name}
                    </Link>
                    <span className="text-caption text-muted">
                      {group.role === "ASSISTANT" ? "Туслах багш" : "Үндсэн багш"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-muted">Бүлэг хуваарилаагүй байна.</p>
            )}
            {/*
              ★ The assignment is made on `/admin/groups`, and this links there
              rather than growing a second control that writes `GroupTeacher`.
              That row decides what a teacher may see (SECURITY.md §7); two
              screens that can change it is two places to audit.
            */}
            <Button asChild variant="secondary" size="sm" className="mt-1 self-start">
              <Link href="/admin/groups">Бүлэг хуваарилах</Link>
            </Button>
          </Section>

          <Section title="NomadKids бүртгэл">
            {row.localUserId ? (
              <>
                <DetailRow
                  label="Бүртгэл"
                  value={row.isActive ? "Бүртгэлтэй" : "Хаагдсан бүртгэл"}
                />
                <DetailRow
                  label="Эрх"
                  value={
                    row.roles.length > 0
                      ? row.roles.map((role) => ROLE_LABEL[role]).join(", ")
                      : null
                  }
                />
                <DetailRow label="ЭСИС холболт" value={row.esisPersonId ? "Холбогдсон" : null} />
                {kindergartenId ? (
                  <div className="mt-1">
                    <StaffRecordsButton
                      user={{
                        id: row.localUserId,
                        lastName: row.lastName,
                        firstName: row.firstName,
                      }}
                      kindergartenId={kindergartenId}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-body text-muted">
                  ЭСИС-д бүртгэлтэй ч энэ системд бүртгэлгүй байна.
                </p>
                {/*
                  ★ The screen's own invitation dialog, pre-filled — not a new
                  flow. An invitation issues a token the person redeems by
                  choosing their own password, and a second path to that would
                  be a second place for the rule "an administrator never types
                  somebody else's password" to be got wrong.
                */}
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onInvite(row)}>
                    Бүртгэл урих
                  </Button>
                  {/*
                    ★ The second answer to the same row, and usually the right
                    one. "ЭСИС-д байгаа, энд байхгүй" has two causes: the person
                    genuinely has no account, or they have one that nobody tied
                    to their ministry identity — which was 12 of 13 accounts on
                    live data. Offering only "урих" would have a director invite
                    somebody who is already registered.
                  */}
                  {onLink ? (
                    <Button variant="secondary" size="sm" onClick={() => onLink(row)}>
                      Одоо байгаа бүртгэлтэй холбох
                    </Button>
                  ) : null}
                </div>
              </>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

/** A titled block, drawn only when something inside it survived. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4 first:border-0 first:pt-0">
      <h3 className="text-caption font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

/**
 * One label and its value — **or nothing at all**.
 *
 * ★ A missing ministry field is omitted rather than dashed. The drawer already
 * has a dozen possible rows and most people have half of them; drawing the
 * absent ones would bury the four that are filled among eight dashes. Where a
 * dash does belong — a column that must mean the same thing on every row — the
 * table above draws it.
 */
function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    /*
      Deliberately not `<dt>`/`<dd>`: these rows sit beside a list of groups and
      a button inside the same section, and a `<dl>` may contain neither. Two
      spans carry the same pairing without making the markup invalid.
    */
    <p className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-caption text-muted">{label}</span>
      <span className="min-w-0 break-words text-right text-body text-ink">{value}</span>
    </p>
  );
}
