"use client";

import { useId, useState, type ReactNode } from "react";
import { MoreVertical, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RowMenu } from "@/components/ui/menu";
import { LoadingState } from "@/components/ui/states";
import { Field, Select } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABEL,
  FEEDBACK_SIGNATURE,
  FEEDBACK_STATUS,
  FEEDBACK_STATUS_LABEL,
  type Feedback,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * One note as a mail row — 2026-10-08, the client: the inbox "том зай эзэлж
 * байна", "мэйл шиг байх". Two short lines — who or what, then status, category
 * and the opening words — and the rest behind the press, as a mail client
 * opens a message in place.
 *
 * ★ No status badge on the row — 2026-10-08, the client: "захианы урд шинэ
 * хариулсан гэж гарахгүй шууд төрлүүд рүүгээ хуваагдаад ор". The status is
 * the tab the row sits under (`FeedbackFilters`), not a label in front of it.
 *
 * ★ The press and the "⋯" are siblings, not nested: a button inside a button
 * is invalid HTML and a screen reader announces it as one control.
 */
export function FeedbackRow({
  row,
  open,
  onToggle,
  from,
  headline,
  showCategory = true,
  unread = false,
  note,
  menu,
  children,
}: {
  row: Pick<Feedback, "category" | "status" | "createdAt" | "body">;
  open: boolean;
  onToggle: () => void;
  /** The first line — the sender in the inbox, the category in a guardian's list. */
  from: ReactNode;
  /**
   * Set in the inbox: `from` drops to a small line above and this is the
   * large one — 2026-10-08, the client: the group and the parent small, the
   * category large, then the text.
   */
  headline?: ReactNode;
  /** Off where `from` already is the category. */
  showCategory?: boolean;
  /** Bold, with a dot — a note nobody has opened the box for yet. */
  unread?: boolean;
  /** A third line on the closed row only — "an answer came". */
  note?: ReactNode;
  menu?: ReactNode;
  /** What opening it shows under the full text. */
  children?: ReactNode;
}) {
  const detailsId = useId();
  const dot = unread ? (
    <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-primary" />
  ) : null;
  const date = (
    <span className="shrink-0 text-caption tabular-nums text-muted">
      {formatDate(row.createdAt)}
    </span>
  );
  return (
    <li className={cn("transition-colors", open && "bg-canvas/50")}>
      <div className="flex items-start">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5 pl-4 pr-2 text-left hover:bg-canvas/60"
        >
          {headline ? (
            <>
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-caption text-muted">{from}</span>
                {date}
              </span>
              <span className="flex w-full items-center gap-2">
                {dot}
                <span
                  className={cn(
                    "min-w-0 truncate text-body text-ink",
                    unread ? "font-semibold" : "font-medium",
                  )}
                >
                  {headline}
                </span>
              </span>
              {open ? null : (
                <span className="w-full min-w-0 truncate text-caption text-muted">{row.body}</span>
              )}
            </>
          ) : (
            <>
              <span className="flex w-full items-center gap-2">
                {dot}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-body text-ink",
                    unread ? "font-semibold" : "font-medium",
                  )}
                >
                  {from}
                </span>
                {date}
              </span>
              <span className="flex w-full min-w-0 items-center gap-2 text-caption">
                {showCategory ? (
                  <span className="shrink-0 font-medium text-ink">
                    {FEEDBACK_CATEGORY_LABEL[row.category]}
                  </span>
                ) : null}
                {open ? null : <span className="min-w-0 truncate text-muted">{row.body}</span>}
              </span>
            </>
          )}
          {open ? null : note}
        </button>
        {menu ? <div className="shrink-0 pr-1 pt-1">{menu}</div> : null}
      </div>
      {open ? (
        <div id={detailsId} className="flex flex-col gap-3 px-4 pb-3.5">
          <p className="whitespace-pre-line text-body text-ink">{row.body}</p>
          {children}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The row's "⋯" — one entry, «Устгах», behind a confirmation (CLAUDE.md §5).
 * What a removal means is the caller's sentence: it differs by side.
 */
export function FeedbackRowMenu({
  ariaLabel,
  description,
  pending,
  onDelete,
}: {
  ariaLabel: string;
  description: string;
  pending: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <RowMenu
        ariaLabel={ariaLabel}
        triggerIcon={<MoreVertical size={18} aria-hidden="true" />}
        items={[
          {
            label: "Устгах",
            icon: <Trash2 size={16} />,
            tone: "danger",
            onSelect: () => setConfirming(true),
          },
        ]}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => (next ? undefined : setConfirming(false))}
        title="Энэ саналыг устгах уу?"
        description={description}
        confirmLabel="Устгах"
        pendingLabel="Устгаж байна…"
        tone="danger"
        pending={pending}
        onConfirm={onDelete}
      />
    </>
  );
}

/**
 * The list as one box with its filters along the top edge — a mail client's
 * toolbar, not a row of buttons competing with the notes (client, 2026-10-08:
 * "анхаарал татахааргүй болгоод дээш шах").
 */
export function FeedbackMailbox({
  filters,
  loading,
  empty,
  children,
}: {
  filters: ReactNode;
  loading?: boolean;
  /** Set when there is nothing to list: what to do next, in one sentence each. */
  empty?: { title: string; description: string } | null;
  children?: ReactNode;
}) {
  return (
    <Card pad="none" className="overflow-hidden">
      {filters}
      {loading ? (
        <div className="p-3">
          <LoadingState rows={3} />
        </div>
      ) : empty ? (
        <div className="px-4 py-8 text-center">
          <p className="text-body font-medium text-ink">{empty.title}</p>
          <p className="mt-1 text-caption text-muted">{empty.description}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border-soft">{children}</ul>
      )}
    </Card>
  );
}

/**
 * The administration's answer, drawn as a letter — the client's "мэйл
 * цэцэрлэгийн захиргаа гэх зэргээр хариу өгдөг шиг". A greeting is not
 * invented: the body is what the administration wrote, signed and dated.
 */
export function ReplyLetter({ reply }: { reply: NonNullable<Feedback["reply"]> }) {
  return (
    <article
      aria-label="Албан хариу"
      className="flex flex-col gap-2 rounded-row border border-border-soft bg-canvas px-4 py-3"
    >
      <p className="text-caption font-medium text-muted">Албан хариу</p>
      <p className="whitespace-pre-line text-body text-ink">{reply.body}</p>
      <p className="self-end text-right text-caption text-muted">
        <span className="block font-semibold text-ink">
          {reply.signature || FEEDBACK_SIGNATURE}
        </span>
        <span className="tabular-nums">{formatDate(reply.repliedAt)}</span>
      </p>
    </article>
  );
}

/**
 * Шинэ · Хүлээн авсан · Хариулсан, and the category — the same two filters on
 * the administration's inbox and on a guardian's own list (client, 2026-10-08).
 * No «Бүгд»: every note lives under its own status, which is why the row
 * carries no status badge (client, 2026-10-08). Quiet on purpose: small text tabs on the mailbox's top edge, the chosen one
 * marked by weight and an underline rather than a filled pill.
 */
export function FeedbackFilters({
  status,
  onStatus,
  category,
  onCategory,
  groups,
  group = "",
  onGroup,
}: {
  status: FeedbackStatus;
  onStatus: (next: FeedbackStatus) => void;
  category: FeedbackCategory | "";
  onCategory: (next: FeedbackCategory | "") => void;
  /**
   * The administration's group filter — 2026-10-08, the client: "удирдлага
   * бүлгээр шүүж хардаг". Left out on a guardian's own list.
   */
  groups?: { value: string; label: string }[];
  group?: string;
  onGroup?: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 border-b border-border-soft px-2">
      <div role="group" aria-label="Төлөвөөр шүүх" className="flex min-w-0 flex-wrap">
        {FEEDBACK_STATUS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => onStatus(value)}
            className={cn(
              "-mb-px min-h-[40px] border-b-2 px-2.5 text-caption transition-colors",
              status === value
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {FEEDBACK_STATUS_LABEL[value]}
          </button>
        ))}
      </div>
      <div className="ml-auto flex">
        {groups && onGroup ? (
          <div className="w-36">
            <Field label="Бүлгээр шүүх" labelHidden>
              {({ id }) => (
                <Select
                  id={id}
                  value={group}
                  onChange={(e) => onGroup(e.target.value)}
                  className="h-8 border-transparent bg-transparent px-2 text-caption text-muted"
                >
                  <option value="">Бүх бүлэг</option>
                  {groups.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        ) : null}
        <div className="w-40">
          <Field label="Чиглэлээр шүүх" labelHidden>
            {({ id }) => (
              <Select
                id={id}
                value={category}
                onChange={(e) => onCategory(e.target.value as FeedbackCategory | "")}
                className="h-8 border-transparent bg-transparent px-2 text-caption text-muted"
              >
                <option value="">Бүх чиглэл</option>
                {FEEDBACK_CATEGORIES.map((code) => (
                  <option key={code} value={code}>
                    {FEEDBACK_CATEGORY_LABEL[code]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </div>
  );
}

/** Said once, above sample rows, so nobody mistakes them for real notes. */
export function DemoBanner({ children }: { children: string }) {
  return (
    <p role="status" className="rounded-row bg-sun px-3 py-2 text-caption text-sun-ink">
      {children}
    </p>
  );
}
