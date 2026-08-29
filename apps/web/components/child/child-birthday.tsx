"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Cake, ChevronDown, Pencil, Sun } from "lucide-react";
import { birthdayNoteSchema, birthdaySectionSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { FormError, LoadingState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { YEAR_ANIMAL_ICON, ZODIAC_ICON } from "@/lib/zodiac-icons";

/**
 * The four facts RFP §4.2 asks for above the notes: the birth date, the age,
 * the өрнийн орд and the монгол жилийн амьтан.
 *
 * ★ The lunar-new-year caveat is rendered, not hidden.
 *
 * The animal year turns at Цагаан сар, which falls between late January and
 * early March and moves every year. For a child born inside that window the API
 * sets `beforeLunarNewYear`, and this note is the honest version of that: a
 * printed portfolio asserting the wrong animal is worse than one that says
 * which two it lies between. Five births in six are outside the window and get
 * no note at all.
 */
export function ChildBirthdayFacts({ section }: { section: z.infer<typeof birthdaySectionSchema> }) {
  const facts = [
    {
      icon: <Cake size={14} aria-hidden="true" className="shrink-0" />,
      label: "Төрсөн огноо",
      value: formatDate(section.dateOfBirth),
    },
    {
      icon: <Sun size={14} aria-hidden="true" className="shrink-0" />,
      label: "Нас",
      value: `${section.ageYears} нас`,
    },
    {
      icon: <span aria-hidden="true">{ZODIAC_ICON[section.zodiac.code] ?? "✨"}</span>,
      label: "Өрнийн орд",
      value: section.zodiac.name,
    },
    {
      icon: <span aria-hidden="true">{YEAR_ANIMAL_ICON[section.yearAnimal.code] ?? "⭐"}</span>,
      label: "Монгол жил",
      value: `${section.yearAnimal.name} жил`,
    },
  ];

  return (
    <Card pad="roomy">
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {facts.map(({ icon, label, value }) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="flex items-center gap-1.5 text-caption text-muted">
              {icon}
              {label}
            </dt>
            <dd className="text-body font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {section.yearAnimal.beforeLunarNewYear ? (
        <p className="mt-3 text-caption text-muted">
          Цагаан сараас өмнө төрсөн тул монгол жил нь өмнөх жилийнх байж болно. Нягтлан
          баталгаажуулна уу.
        </p>
      ) : null}
    </Card>
  );
}

export function ChildBirthdayNotes({
  childId,
  section,
  isLoading,
  currentAge,
}: {
  childId: string;
  section: z.infer<typeof birthdaySectionSchema> | null;
  isLoading: boolean;
  /** Birthdays not yet had arrive collapsed, as the age sections do. */
  currentAge: number | null;
}) {
  const queryClient = useQueryClient();
  const [editingAge, setEditingAge] = useState<number | null>(null);
  const [text, setText] = useState("");
  const notes = section?.notes ?? [];

  const save = useMutation({
    mutationFn: (age: number) =>
      mutate(`/children/${childId}/birthday-notes/${age}`, birthdayNoteSchema, {
        method: "PATCH",
        body: { note: text.trim() || null },
      }),
    onSuccess: () => {
      setEditingAge(null);
      void queryClient.invalidateQueries({ queryKey: qk.birthdayNotes(childId) });
    },
  });

  return (
    <section aria-labelledby="birthdays-heading">
      <SectionHeader id="birthdays-heading" title="Төрсөн өдрийн тэмдэглэл" />

      {isLoading ? (
        <LoadingState rows={1} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {PORTFOLIO_AGES.map((age) => {
            const note = notes.find((n) => n.age === age);
            const isEditing = editingAge === age;

            /*
             * ★ A birthday that has not happened arrives closed.
             *
             * The four cards rendered open regardless, so a two-year-old's
             * portfolio ended with three "Тэмдэглэл бичээгүй байна." boxes for
             * birthdays up to three years away, each offering to write the note
             * early. An existing note opens the card whatever the age.
             */
            const reached = currentAge === null || age <= currentAge;

            return (
              <Card key={age} pad="roomy">
                <details
                  open={Boolean(note?.note) || reached}
                  className="flex flex-col gap-2 [&[open]_svg.chevron]:rotate-180"
                >
                  <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <h3 className="font-medium text-ink">{age} нас</h3>
                    {!reached && !note?.note ? <Badge tone="neutral">Ирээдүйд</Badge> : null}
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className="chevron ml-auto shrink-0 text-faint transition-transform"
                    />
                  </summary>

                  <div className="mt-2 flex flex-col gap-2">
                    {!isEditing ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        onClick={() => {
                          setEditingAge(age);
                          setText(note?.note ?? "");
                          save.reset();
                        }}
                      >
                        <Pencil size={16} />
                        Засах
                      </Button>
                    ) : null}

                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!save.isPending) save.mutate(age);
                        }}
                        className="flex flex-col gap-3"
                      >
                        <FormError message={save.isError ? errorMessage(save.error) : null} />
                        <Field label={`${age} насны төрсөн өдрийн тэмдэглэл`}>
                          {({ id, describedBy }) => (
                            <Textarea
                              id={id}
                              aria-describedby={describedBy}
                              value={text}
                              onChange={(e) => setText(e.target.value)}
                              autoFocus
                            />
                          )}
                        </Field>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" disabled={save.isPending}>
                            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => setEditingAge(null)}>
                            Цуцлах
                          </Button>
                        </div>
                      </form>
                    ) : note?.note ? (
                      <p className="whitespace-pre-wrap text-body text-ink">{note.note}</p>
                    ) : (
                      // Not `EmptyState`: it renders a `Card`, and this sits
                      // inside one already.
                      <p className="text-body text-muted">
                        Тэмдэглэл бичээгүй. «Засах» дарж нэмнэ үү.
                      </p>
                    )}
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
