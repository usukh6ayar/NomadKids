"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { childMealNoteSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { formatDayMonth, fullName } from "@/lib/format";

const notesSchema = z.array(childMealNoteSchema);

/** The API's own limit, mirrored so the counter and the server agree. */
const MAX = 500;

/**
 * "Нэмэлт мэдээлэл" — what a family wants the kitchen to know.
 *
 * ★ The client's own placeholder says what it is for: "бага хэмжээгээр өгч
 * болохгүй, орлуулах хоол санал болгох гэх мэт."
 *
 * ★★ It is not a chat message, and that is a privacy decision.
 *
 * The only rooms that exist are `group:` and `staff:` — a group room holds every
 * parent in the group, so "my child cannot have dairy" sent there would publish
 * one child's dietary restriction to thirty families. `POST
 * /children/:id/meals/notes` is reachable only through `canAccessChild`, like
 * everything else written about a child.
 *
 * ★★★ What was already sent stays on screen underneath.
 *
 * A box that empties and says "sent" leaves a parent with no way to check
 * whether they already mentioned the thing they are about to mention again —
 * and no way to see that the kitchen has their note at all.
 */
export function MenuNoteBox({ childId, date }: { childId: string; date: string }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const notes = useQuery({
    queryKey: qk.childMealNotes(childId, { from: date, to: date }),
    queryFn: () => get(`/children/${childId}/meals/notes?from=${date}&to=${date}`, notesSchema),
  });

  const send = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/meals/notes`, childMealNoteSchema, {
        method: "POST",
        body: { date, body: body.trim() },
      }),
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: qk.childMealNotes(childId) });
    },
  });

  const tooLong = body.length > MAX;

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!send.isPending && body.trim() && !tooLong) send.mutate();
        }}
        className="flex flex-col gap-2"
        noValidate
      >
        <FormError message={send.isError ? errorMessage(send.error) : null} />

        <Field
          label="Нэмэлт мэдээлэл"
          hint={`${body.length}/${MAX}`}
          error={tooLong ? `Хамгийн ихдээ ${MAX} тэмдэгт.` : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              invalid={invalid || tooLong}
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Жишээ нь: бага хэмжээгээр өгч болохгүй, орлуулах хоол санал болгох гэх мэт…"
            />
          )}
        </Field>

        <Button type="submit" size="lg" block disabled={send.isPending || !body.trim() || tooLong}>
          <Send size={16} aria-hidden="true" />
          {send.isPending ? "Илгээж байна…" : "Илгээх"}
        </Button>
      </form>

      {(notes.data?.length ?? 0) > 0 ? (
        <ul
          aria-label="Илгээсэн мэдээлэл"
          className="flex flex-col gap-2 border-t border-border-soft pt-3"
        >
          {notes.data!.map((note) => (
            <li key={note.id} className="rounded-row bg-canvas px-3 py-2">
              <p className="text-caption text-muted">
                {formatDayMonth(note.date)}
                {note.author ? ` · ${fullName(note.author)}` : ""}
              </p>
              <p className="text-body leading-snug text-ink">{note.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
