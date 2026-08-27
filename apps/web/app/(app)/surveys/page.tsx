"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { surveySchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowList } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";

const surveysSchema = z.array(surveySchema);

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Ноорог",
  PUBLISHED: "Нийтэлсэн",
  CLOSED: "Хаасан",
};

const STATUS_TONE: Record<string, "neutral" | "mint" | "sun"> = {
  DRAFT: "neutral",
  PUBLISHED: "mint",
  CLOSED: "sun",
};

const SCOPE_LABEL: Record<string, string> = {
  CHILD: "Хүүхэд тус бүрээр",
  KINDERGARTEN: "Цэцэрлэгээр нэг удаа",
};

export default function SurveysPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <SurveysList />
    </RequireRole>
  );
}

function SurveysList() {
  const { primaryKindergartenId } = useSession();
  const [creating, setCreating] = useState(false);

  const surveys = useQuery({
    queryKey: qk.kindergartenSurveys(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/surveys`, surveysSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Судалгаа"
        lede="Гэр бүлээс санал асуулга авах."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            Шинэ судалгаа
          </Button>
        }
      />

      {surveys.isLoading ? <LoadingState rows={3} /> : null}
      {surveys.isError ? <ErrorState description={errorMessage(surveys.error)} /> : null}

      {surveys.data && surveys.data.length === 0 ? (
        <EmptyState
          title="Судалгаа алга"
          description="Эхний судалгаагаа үүсгэж эхэлнэ үү."
          action={<Button onClick={() => setCreating(true)}>Шинэ судалгаа</Button>}
        />
      ) : null}

      {surveys.data && surveys.data.length > 0 ? (
        <RowList>
          {surveys.data.map((survey) => (
            <Link
              key={survey.id}
              href={`/surveys/${survey.id}`}
              className="flex min-h-[64px] flex-wrap items-center justify-between gap-2 rounded-row border border-border bg-surface px-4 py-3 transition-colors hover:border-primary"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{survey.title}</p>
                <p className="text-body text-muted">{SCOPE_LABEL[survey.scope]}</p>
              </div>
              <Badge tone={STATUS_TONE[survey.status]}>{STATUS_LABEL[survey.status]}</Badge>
            </Link>
          ))}
        </RowList>
      ) : null}

      {creating && primaryKindergartenId ? (
        <CreateSurveyDialog
          kindergartenId={primaryKindergartenId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

function CreateSurveyDialog({
  kindergartenId,
  onClose,
}: {
  kindergartenId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<"CHILD" | "KINDERGARTEN">("CHILD");

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/surveys`, surveySchema, {
        method: "POST",
        body: { title, scope },
      }),
    onSuccess: (survey) => router.push(`/surveys/${survey.id}`),
  });

  const errors = fieldErrors(create.error);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Шинэ судалгаа"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[480px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <h2 className="text-title font-semibold text-ink">Шинэ судалгаа</h2>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <Field label="Гарчиг" error={errors.title} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            )}
          </Field>

          <Field
            label="Хэнд зориулагдсан"
            hint="Хүүхэд тус бүрээр гэвэл эцэг эх хүүхдийнхээ нэрээр хариулна."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={scope}
                onChange={(e) => setScope(e.target.value as "CHILD" | "KINDERGARTEN")}
              >
                <option value="CHILD">Хүүхэд тус бүрээр</option>
                <option value="KINDERGARTEN">Цэцэрлэгээр нэг удаа</option>
              </Select>
            )}
          </Field>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Үүсгэж байна…" : "Үргэлжлүүлэх"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
              Болих
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
