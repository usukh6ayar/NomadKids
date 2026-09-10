"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus } from "lucide-react";
import {
  AGE_ALBUM_CATEGORIES,
  AGE_ALBUM_CATEGORY_LABEL,
  mediaSchema,
  type ChildSummary,
} from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { useToast } from "@/components/ui/toast";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { fullName } from "@/lib/format";

/**
 * "Хадгалах" on a class-board photograph — RFP §2.3.
 *
 * ★ A teacher posts the morning's photographs to the board and a parent
 * recognising their own child had no way to keep it. The API copies the object
 * rather than pointing a second row at the same key, so the family's album and
 * the post have independent lifetimes — `MediaService.saveNotificationPhoto‐
 * ToChild` says why.
 *
 * ★★ It asks which child and which year, and does not guess.
 *
 * A family with two children at the same kindergarten sees the same board, and
 * a photograph filed under the wrong one is a wrong memory rather than a wrong
 * setting. The age is asked for the same reason: the album is organised by
 * year (RFP §4.3) and "which year is this" is a fact only the parent has.
 */
export function SavePostPhoto({
  mediaId,
  children: myChildren,
}: {
  mediaId: string;
  children: ChildSummary[];
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [childId, setChildId] = useState(myChildren[0]?.id ?? "");
  const [age, setAge] = useState(String(PORTFOLIO_AGES[0]));
  const [category, setCategory] = useState<string>(AGE_ALBUM_CATEGORIES[0]);

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/media/save-from-post`, mediaSchema, {
        method: "POST",
        body: { mediaId, age: Number(age), category },
      }),
    onSuccess: () => {
      setOpen(false);
      toast.success("Зураг цомогт хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.childMedia(childId) });
      void queryClient.invalidateQueries({ queryKey: qk.childAgeAlbum(childId, Number(age)) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Nothing to save it into. A guardian whose children are all elsewhere still
  // reads the board; the button would open a dialog with an empty picker.
  if (myChildren.length === 0) return null;

  const formId = `save-post-photo-${mediaId}`;

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label="Зургийг цомогт хадгалах"
        className="absolute right-1.5 top-1.5 rounded-pill bg-surface/95 shadow-sm"
        onClick={() => setOpen(true)}
      >
        <BookmarkPlus aria-hidden="true" />
      </Button>

      <FormDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : setOpen(false))}
        busy={save.isPending}
        title="Цомогт хадгалах"
        description="Энэ зургийг хүүхдийнхээ насны цомогт хуулж хадгална."
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              Болих
            </Button>
            <Button type="submit" form={formId} size="sm" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending && childId) save.mutate();
          }}
        >
          {/* Asked only when there is a choice to make. */}
          {myChildren.length > 1 ? (
            <Field label="Хүүхэд">
              {({ id }) => (
                <Select id={id} value={childId} onChange={(e) => setChildId(e.target.value)}>
                  {myChildren.map((child) => (
                    <option key={child.id} value={child.id}>
                      {fullName(child)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field label="Нас">
            {({ id }) => (
              <Select id={id} value={age} onChange={(e) => setAge(e.target.value)}>
                {PORTFOLIO_AGES.map((value) => (
                  <option key={value} value={String(value)}>
                    {value} нас
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Зургийн төрөл">
            {({ id }) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                {AGE_ALBUM_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {AGE_ALBUM_CATEGORY_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </form>
      </FormDialog>
    </>
  );
}
