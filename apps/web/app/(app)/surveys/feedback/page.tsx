"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { EyeOff } from "lucide-react";
import { z } from "zod";
import { groupListItemSchema, paginated } from "@kinder/contracts";
import {
  FeedbackFilters,
  FeedbackMailbox,
  FeedbackRow,
  FeedbackRowMenu,
  ReplyLetter,
} from "@/components/feedback/feedback-parts";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { ErrorState, FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import {
  FEEDBACK_CATEGORY_LABEL,
  FEEDBACK_SIGNATURE,
  feedbackListSchema,
  feedbackSchema,
  type Feedback,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/lib/feedback";
import { formatDate, fullName, groupLabel } from "@/lib/format";

/**
 * Санал хүсэлт — the administration's inbox, 2026-10-08 (client: "зөвхөн
 * удирдлага эцэг эхээс авдаг нээлттэй санал хүсэлтийн хайрцаг").
 *
 * ★ ADMIN only, not TEACHER: a note about the kitchen or about a teacher is
 * addressed over the teacher's head, and a box the teacher can read is not one
 * a parent will write in.
 *
 * ★★ No sample inbox on a 404 any more (2026-10-12): the API answers
 * (`apps/api/src/feedback/`), so an error is shown as the error it is.
 *
 * Opening a new note is what "Хүлээн авлаа" means to the guardian, but it is a
 * press, not a side effect of scrolling past: the guardian is told a person
 * read it, and only a person can say that.
 */
export default function FeedbackInboxPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <FeedbackInbox />
    </RequireRole>
  );
}

const PAGE_SIZE = 50;

const groupsSchema = paginated(groupListItemSchema);

function inboxKey(kindergartenId: string, status: string, category: string, group: string) {
  return ["kindergartens", kindergartenId, "feedback", { status, category, group }] as const;
}

function FeedbackInbox() {
  const { primaryKindergartenId } = useSession();
  const kg = primaryKindergartenId ?? "";
  const [status, setStatus] = useState<FeedbackStatus>("NEW");
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [group, setGroup] = useState("");

  const params = new URLSearchParams({ page: "1", pageSize: String(PAGE_SIZE), status });
  if (category) params.set("category", category);
  if (group) params.set("groupId", group);

  const inbox = useQuery({
    queryKey: inboxKey(kg, status, category, group),
    queryFn: () => get(`/kindergartens/${kg}/feedback?${params.toString()}`, feedbackListSchema),
    enabled: Boolean(kg),
    retry: false,
  });
  // ★ `pageSize=100`, the API's maximum — a kindergarten has far fewer groups.
  const groupList = useQuery({
    queryKey: ["groups", "feedback-filter"],
    queryFn: () => get("/groups?pageSize=100", groupsSchema),
    enabled: Boolean(kg),
  });
  const groups = (groupList.data?.items ?? []).map((g) => ({
    value: g.id,
    label: groupLabel(g.name),
  }));
  const rows = inbox.data?.items ?? [];

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title="Санал хүсэлт"
        backHref="/surveys/parents"
        lede="Эцэг эхчүүдээс ирсэн санал, гомдол. Зөвхөн удирдлага харна."
      />

      {inbox.isError ? <ErrorState description={errorMessage(inbox.error)} /> : null}

      <FeedbackMailbox
        filters={
          <FeedbackFilters
            status={status}
            onStatus={setStatus}
            category={category}
            onCategory={setCategory}
            groups={groups}
            group={group}
            onGroup={setGroup}
          />
        }
        loading={inbox.isLoading}
        empty={
          inbox.data && rows.length === 0
            ? {
                title: "Санал хүсэлт алга",
                description:
                  status === "NEW" && !category && !group
                    ? "Эцэг эхчүүд «Санал хүсэлт»-ээр илгээхэд энд харагдана."
                    : "Өөр төлөв эсвэл чиглэл сонгоод үзээрэй.",
              }
            : null
        }
      >
        {rows.map((row) => (
          <FeedbackItem key={row.id} row={row} kindergartenId={kg} />
        ))}
      </FeedbackMailbox>

      {inbox.data && inbox.data.total > rows.length ? (
        <p className="text-caption text-muted">
          Сүүлийн {rows.length} нь харагдаж байна, нийт {inbox.data.total}. Төлөв, чиглэлээр шүүнэ
          үү.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Who sent it — the client, 2026-10-08: "ямар бүлгийн хэн багшийн хэний эцэг
 * эх". Labelled rather than run together into a sentence, because Mongolian
 * case endings cannot be assembled from a name ("Тэмүүлэнгийн" is not
 * "Тэмүүлэн" + a fixed suffix).
 */
function SenderDetails({ row }: { row: Feedback }) {
  if (row.anonymous || !row.author) return null;
  const facts: [string, string | null | undefined][] = [
    ["Эцэг эх", parentLabel(row)],
    ["Хүүхэд", row.childName],
    ["Бүлэг", row.groupName],
    ["Багш", row.teacherName],
    ["Утас", row.author.phone],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-row bg-canvas px-3 py-2 text-caption">
      {facts
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 text-ink">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function parentLabel(row: Feedback): string {
  return [fullName(row.author), row.relation ? `(${row.relation})` : null]
    .filter(Boolean)
    .join(" ");
}

/**
 * The mail row's small line — the group first, then the parent (client,
 * 2026-10-08: "Нарлаг бүлэг · Мөнх Ганбаатар (аав)"), or nobody.
 */
function SenderLine({ row }: { row: Feedback }) {
  if (row.anonymous || !row.author) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <EyeOff size={14} aria-hidden="true" />
        Нэргүй
      </span>
    );
  }
  return <>{[row.groupName, parentLabel(row)].filter(Boolean).join(" · ")}</>;
}

function FeedbackItem({ row, kindergartenId }: { row: Feedback; kindergartenId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["kindergartens", kindergartenId, "feedback"] });
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const acknowledge = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/feedback/${row.id}/acknowledge`, feedbackSchema, {
        method: "POST",
      }),
    onSuccess: () => {
      toast.success("Хүлээн авсныг эцэг эхэд мэдэгдлээ.");
      void refresh();
    },
    onError,
  });

  const answer = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/feedback/${row.id}/reply`, feedbackSchema, {
        method: "POST",
        body: { body: reply.trim() },
      }),
    onSuccess: () => {
      toast.success("Албан хариу илгээгдлээ.");
      setReplying(false);
      setReply("");
      void refresh();
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/feedback/${row.id}`, z.unknown(), {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Санал устгагдлаа.");
      void refresh();
    },
    onError,
  });

  const named = !row.anonymous && Boolean(row.author);

  return (
    <FeedbackRow
      row={row}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      from={<SenderLine row={row} />}
      headline={FEEDBACK_CATEGORY_LABEL[row.category]}
      unread={row.status === "NEW"}
      menu={
        <FeedbackRowMenu
          ariaLabel={`${FEEDBACK_CATEGORY_LABEL[row.category]} санал — үйлдэл`}
          description="Таны хайрцгаас хасагдана. Эцэг эх өөрийн илгээсэн санал, хариугаа харсаар байна."
          pending={remove.isPending}
          onDelete={() => remove.mutate()}
        />
      }
    >
      <SenderDetails row={row} />

      {row.reply ? <ReplyLetter reply={row.reply} /> : null}

      {replying ? (
        <div className="flex flex-col gap-2">
          <FormError message={answer.isError ? errorMessage(answer.error) : null} />
          <Field
            label="Албан хариу"
            hint={`Доор нь «${FEEDBACK_SIGNATURE} · ${formatDate(new Date())}» гэж автоматаар гарна.`}
            required
          >
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={4}
                maxLength={3000}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setReplying(false)}
              disabled={answer.isPending}
            >
              Цуцлах
            </Button>
            <Button
              size="sm"
              onClick={() => answer.mutate()}
              disabled={!reply.trim() || answer.isPending}
            >
              {answer.isPending ? "Илгээж байна…" : "Илгээх"}
            </Button>
          </div>
        </div>
      ) : row.status !== "ANSWERED" ? (
        <div className="flex flex-wrap justify-end gap-2">
          {row.status === "NEW" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => acknowledge.mutate()}
              disabled={acknowledge.isPending}
            >
              Хүлээн авлаа
            </Button>
          ) : null}
          {/* An anonymous note has nobody to address a letter to. */}
          {named ? (
            <Button size="sm" onClick={() => setReplying(true)}>
              Албан хариу өгөх
            </Button>
          ) : null}
        </div>
      ) : null}
    </FeedbackRow>
  );
}
