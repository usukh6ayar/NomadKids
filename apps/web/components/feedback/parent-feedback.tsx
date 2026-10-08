"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { z } from "zod";
import {
  DemoBanner,
  FeedbackFilters,
  FeedbackMailbox,
  FeedbackRow,
  FeedbackRowMenu,
  ReplyLetter,
} from "@/components/feedback/feedback-parts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABEL,
  FEEDBACK_NOT_READY,
  FEEDBACK_RELATIONS,
  FEEDBACK_RELATION_LABEL,
  feedbackListSchema,
  feedbackSchema,
  filterFeedback,
  type Feedback,
  type FeedbackCategory,
  type FeedbackRelation,
  type FeedbackStatus,
  type NewFeedback,
} from "@/lib/feedback";
import { DEMO_MINE } from "@/lib/feedback-demo";
import { capitalize } from "@/lib/format";
import { useSelectedChild } from "@/lib/selected-child";

/** The administration is who reads it — said once, wherever the form is. */
export const FEEDBACK_LEDE = "Цэцэрлэгийн удирдлагад шууд очно. Багш нар харахгүй.";

const MINE_KEY = ["me", "feedback"] as const;

/**
 * The guardian's own notes, and the form behind «+ Санал хүсэлт» — the
 * `/feedback` page's body, and the floating panel's on «Миний судалгаанууд»
 * (`feedback-widget.tsx`).
 *
 * ★ The form is closed until asked for — 2026-10-08, the client: "эцэг эх
 * бичих хэсэг байнга бэлэн байхгүй, +Санал хүсэлт товч дараад бичнэ". A family
 * comes back far more often to read an answer than to write, and an open form
 * pushed the answers below the fold.
 */
export function ParentFeedbackPanel() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const [status, setStatus] = useState<FeedbackStatus>("NEW");
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [demoRows, setDemoRows] = useState<Feedback[]>(DEMO_MINE);
  const mine = useQuery({
    queryKey: MINE_KEY,
    queryFn: () => get("/me/feedback?page=1&pageSize=50", feedbackListSchema),
    retry: false,
  });
  /*
    ★ Sample notes while the endpoint is missing — 2026-10-08, the client
    asked to see the list filled. A send in this state lands here only, and
    the banner says it was not delivered.
  */
  const demo = mine.isError && isNotFound(mine.error);
  const all = demo ? demoRows : (mine.data?.items ?? []);
  const rows = filterFeedback(all, status, category);
  const loaded = demo || Boolean(mine.data);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (demo) return setDemoRows((current) => current.filter((row) => row.id !== id));
      return mutate(`/me/feedback/${id}`, z.unknown(), { method: "DELETE" });
    },
    onSuccess: () => {
      toast.success("Санал устгагдлаа.");
      if (!demo) void queryClient.invalidateQueries({ queryKey: MINE_KEY });
    },
    onError: (error) => toast.error(isNotFound(error) ? FEEDBACK_NOT_READY : errorMessage(error)),
  });

  return (
    <section aria-labelledby="my-feedback" className="flex w-full flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="my-feedback" className="text-lead font-semibold text-ink">
          Миний илгээсэн
        </h2>
        {writing ? null : (
          <Button size="sm" onClick={() => setWriting(true)}>
            <Plus size={16} aria-hidden="true" />
            Санал хүсэлт
          </Button>
        )}
      </div>

      {writing ? (
        <NewFeedbackForm
          onClose={() => setWriting(false)}
          onDemoSend={demo ? (row) => setDemoRows((current) => [row, ...current]) : undefined}
        />
      ) : null}

      {demo ? (
        <DemoBanner>
          Жишээ санал хүсэлт харагдаж байна. Сервер холбогдох хүртэл илгээсэн санал удирдлагад
          хүрэхгүй.
        </DemoBanner>
      ) : null}
      {mine.isError && !demo ? <ErrorState description={errorMessage(mine.error)} /> : null}

      <FeedbackMailbox
        filters={
          <FeedbackFilters
            status={status}
            onStatus={setStatus}
            category={category}
            onCategory={setCategory}
          />
        }
        loading={mine.isLoading}
        empty={
          loaded && rows.length === 0
            ? all.length === 0
              ? {
                  title: "Одоогоор илгээсэн санал алга",
                  description: "«Санал хүсэлт» товчийг дараад бичээрэй.",
                }
              : {
                  title: "Тохирох санал алга",
                  description: "Өөр төлөв эсвэл чиглэл сонгоод үзээрэй.",
                }
            : null
        }
      >
        {rows.map((row) => (
          <MyFeedbackRow
            key={row.id}
            row={row}
            removing={remove.isPending && remove.variables === row.id}
            onDelete={() => remove.mutate(row.id)}
          />
        ))}
      </FeedbackMailbox>
    </section>
  );
}

/**
 * One of the guardian's own notes as a mail row. An answered one says so on
 * the closed row — the answer is why they came back.
 */
function MyFeedbackRow({
  row,
  removing,
  onDelete,
}: {
  row: Feedback;
  removing: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <FeedbackRow
      row={row}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      from={FEEDBACK_CATEGORY_LABEL[row.category]}
      showCategory={false}
      note={
        row.reply ? (
          <span className="text-caption font-medium text-primary">Албан хариу ирсэн</span>
        ) : null
      }
      menu={
        <FeedbackRowMenu
          ariaLabel={`${FEEDBACK_CATEGORY_LABEL[row.category]} санал — үйлдэл`}
          description="Таны жагсаалтаас хасагдана. Удирдлагад илгээсэн санал буцаагдахгүй."
          pending={removing}
          onDelete={onDelete}
        />
      }
    >
      {row.anonymous ? <p className="text-caption text-muted">Нэрээ нууж илгээсэн</p> : null}
      {row.reply ? <ReplyLetter reply={row.reply} /> : null}
    </FeedbackRow>
  );
}

function NewFeedbackForm({
  onClose,
  onDemoSend,
}: {
  onClose: () => void;
  /** Set while the endpoint is missing: the note is listed here, not sent. */
  onDemoSend?: (row: Feedback) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { selectedChildId } = useSelectedChild();
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [relation, setRelation] = useState<FeedbackRelation | "">("");

  const valid =
    Boolean(category) &&
    body.trim().length > 0 &&
    Boolean(selectedChildId) &&
    (anonymous || Boolean(relation));

  const send = useMutation({
    mutationFn: async () => {
      const payload: NewFeedback = {
        childId: selectedChildId!,
        category: category as FeedbackCategory,
        body: body.trim(),
        anonymous,
        // An anonymous note names nobody, not even "the father".
        relation: anonymous ? null : (relation as FeedbackRelation),
      };
      if (onDemoSend) {
        const row: Feedback = {
          id: `demo-${Date.now()}`,
          category: payload.category,
          body: payload.body,
          anonymous: payload.anonymous,
          relation: payload.relation ? FEEDBACK_RELATION_LABEL[payload.relation] : null,
          status: "NEW",
          createdAt: new Date().toISOString(),
        };
        onDemoSend(row);
        return row;
      }
      return mutate("/me/feedback", feedbackSchema, { method: "POST", body: payload });
    },
    onSuccess: () => {
      toast.success(
        onDemoSend ? "Жишээ горим: санал жагсаалтад нэмэгдлээ." : "Санал хүсэлт илгээгдлээ.",
      );
      setCategory("");
      setBody("");
      setAnonymous(false);
      setRelation("");
      onClose();
      void queryClient.invalidateQueries({ queryKey: MINE_KEY });
    },
    onError: (error) => toast.error(isNotFound(error) ? FEEDBACK_NOT_READY : errorMessage(error)),
  });

  return (
    <Card pad="none" className="flex flex-col gap-3 px-4 py-4">
      <FormError
        message={send.isError && !isNotFound(send.error) ? errorMessage(send.error) : null}
      />
      <Field label="Чиглэл" required>
        {({ id }) => (
          <Select
            id={id}
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
          >
            <option value="">Сонгоно уу</option>
            {FEEDBACK_CATEGORIES.map((code) => (
              <option key={code} value={code}>
                {FEEDBACK_CATEGORY_LABEL[code]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Санал, хүсэлт" hint={`${body.length}/3000`} required>
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            rows={4}
            maxLength={3000}
            placeholder="Жишээ нь: Өдрийн хоолны амт сүүлийн үед муу байна."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
      <Checkbox
        label="Нэрээ нууж илгээх"
        description={
          anonymous
            ? "Удирдлага таны нэрийг харахгүй. Хүлээн авсан эсэхийг харж болно, гэхдээ албан хариу ирэхгүй."
            : "Нэрээ мэдэгдвэл удирдлага танд албан хариу өгнө."
        }
        checked={anonymous}
        onChange={(e) => setAnonymous(e.target.checked)}
      />
      {anonymous ? null : (
        <Field label="Та хүүхдийн хэн бэ?" required>
          {({ id }) => (
            <Select
              id={id}
              value={relation}
              onChange={(e) => setRelation(e.target.value as FeedbackRelation)}
            >
              <option value="">Сонгоно уу</option>
              {FEEDBACK_RELATIONS.map((code) => (
                <option key={code} value={code}>
                  {capitalize(FEEDBACK_RELATION_LABEL[code])}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onClose} disabled={send.isPending}>
          Болих
        </Button>
        <Button size="sm" onClick={() => send.mutate()} disabled={!valid || send.isPending}>
          {send.isPending ? "Илгээж байна…" : "Илгээх"}
        </Button>
      </div>
    </Card>
  );
}
