"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Award, Plus, Sparkles } from "lucide-react";
import { esisResourceReadSchema } from "@kinder/contracts";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { RequestRow, SectionTop } from "@/components/qualifications/request-parts";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import {
  QUALIFICATION_DEGREES,
  isDecided,
  qualificationRequestSchema,
  qualificationRequestsSchema,
  type NewQualificationRequest,
} from "@/lib/qualifications";

/**
 * The signed-in teacher's own qualification requests — and, since
 * 2026-10-07, a new one (client: "багш дээр мэргэшлийн зэрэг шинээр хийж бас
 * өөрийн хүсэлтээ харах хэсэг API-тай холбоход бэлэн болго").
 *
 * ★ Ready for an API that does not exist yet, as on the admin's page:
 *
 *   GET  /me/qualification-requests?page=&pageSize=   → «Миний хүсэлт»
 *   POST /me/qualification-requests                    ← «Шинэ хүсэлт»
 *
 * `lib/qualifications.ts` is the contract. While the GET answers 404 the page
 * says so in one line; a POST that answers 404 says the same in a toast and
 * keeps what the teacher typed.
 *
 * ★★ The ESIS reads stay, folded under «ЭСИС дэх хүсэлт». No register-number
 * input exists there: the API resolves API 119 from the authenticated user's
 * `User.registerNumber` and validates every 167/170 `requestId` against that
 * result before it calls ESIS, so this page cannot become a lookup for
 * another teacher.
 */
export default function QualificationsPage() {
  return (
    <RequireRole roles={["TEACHER"]}>
      <MyQualifications />
    </RequireRole>
  );
}

const MINE_KEY = ["me", "qualification-requests"] as const;

function MyQualifications() {
  const [creating, setCreating] = useState(false);

  const mine = useQuery({
    queryKey: MINE_KEY,
    queryFn: () =>
      get("/me/qualification-requests?page=1&pageSize=100", qualificationRequestsSchema),
    retry: false,
  });
  const notReady = mine.isError && isNotFound(mine.error);
  const rows = mine.data?.items ?? [];
  const open = rows.filter((row) => !isDecided(row.status));
  const decided = rows.filter((row) => isDecided(row.status));

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title="Мэргэшлийн зэрэг" />

      {notReady ? (
        <p role="status" className="rounded-row bg-canvas px-4 py-3 text-body text-muted">
          Хүсэлтийн сервер холболт хараахан бэлэн болоогүй байна.
        </p>
      ) : null}
      {mine.isError && !notReady ? <ErrorState description={errorMessage(mine.error)} /> : null}

      <Card pad="none" className="overflow-hidden">
        <SectionTop title="Миний хүсэлт" lede="Өөрийн илгээсэн хүсэлтүүд">
          <span className="grid min-w-10 place-items-center rounded-pill bg-canvas px-3 py-1.5 text-body tabular-nums text-ink">
            {rows.length}
          </span>
        </SectionTop>

        {mine.isLoading ? (
          <div className="p-4">
            <LoadingState rows={2} />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="grid size-16 place-items-center rounded-pill bg-canvas text-ink">
              <Sparkles size={22} aria-hidden="true" />
            </span>
            <p className="mt-2 text-lead font-semibold text-ink">Одоогоор хүсэлт байхгүй</p>
            <p className="max-w-xs text-body text-muted">
              Шинэ хүсэлт үүсгээд явцыг эндээс хянах боломжтой.
            </p>
            <Button className="mt-3" onClick={() => setCreating(true)}>
              <Plus size={18} aria-hidden="true" />
              Шинэ хүсэлт
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {open.length > 0 ? (
              <section aria-label="Явцад" className="flex flex-col gap-2">
                <h3 className="px-1 text-caption font-medium text-muted">Явцад</h3>
                <ul className="flex flex-col gap-2">
                  {open.map((row) => (
                    <RequestRow
                      key={row.id}
                      row={row}
                      showName={false}
                      showStatus
                      showDate
                      bordered
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {decided.length > 0 ? (
              <section aria-label="Шийдвэрлэгдсэн" className="flex flex-col gap-2">
                <h3 className="px-1 text-caption font-medium text-muted">Шийдвэрлэгдсэн</h3>
                <ul className="flex flex-col gap-2">
                  {decided.map((row) => (
                    <RequestRow key={row.id} row={row} showName={false} showStatus bordered />
                  ))}
                </ul>
              </section>
            ) : null}
            <Button className="self-end" size="sm" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              Шинэ хүсэлт
            </Button>
          </div>
        )}
      </Card>

      {creating ? <NewRequestDialog onClose={() => setCreating(false)} /> : null}

      <Disclosure title="ЭСИС дэх хүсэлт" compact>
        <EsisRequests />
      </Disclosure>
    </div>
  );
}

/**
 * «Шинэ хүсэлт» — the degree, the position, years of service and a note.
 *
 * Nothing goes to ESIS from here: the backend owns that step (API 165) and
 * will run it once its contract is confirmed. This only asks for the request.
 */
function NewRequestDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [degree, setDegree] = useState<string>(QUALIFICATION_DEGREES[0]);
  const [position, setPosition] = useState("Бүлгийн багш");
  const [years, setYears] = useState("");
  const [note, setNote] = useState("");

  const yearsNumber = Number(years);
  const valid =
    position.trim().length > 0 &&
    years.trim() !== "" &&
    Number.isInteger(yearsNumber) &&
    yearsNumber >= 0 &&
    yearsNumber <= 60;

  const create = useMutation({
    mutationFn: () => {
      const body: NewQualificationRequest = {
        degree: degree as NewQualificationRequest["degree"],
        position: position.trim(),
        yearsOfService: yearsNumber,
        note: note.trim() || null,
      };
      return mutate("/me/qualification-requests", qualificationRequestSchema, {
        method: "POST",
        body,
      });
    },
    onSuccess: () => {
      toast.success("Хүсэлт илгээгдлээ.");
      void queryClient.invalidateQueries({ queryKey: MINE_KEY });
      onClose();
    },
    onError: (error) =>
      toast.error(
        isNotFound(error)
          ? "Хүсэлтийн сервер холболт хараахан бэлэн болоогүй байна."
          : errorMessage(error),
      ),
  });

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Шинэ хүсэлт"
      busy={create.isPending}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={create.isPending}>
            Болих
          </Button>
          <Button size="sm" onClick={() => create.mutate()} disabled={!valid || create.isPending}>
            {create.isPending ? "Илгээж байна…" : "Илгээх"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormError
          message={create.isError && !isNotFound(create.error) ? errorMessage(create.error) : null}
        />
        <Field label="Мэргэшлийн зэрэг" required>
          {({ id }) => (
            <Select id={id} value={degree} onChange={(event) => setDegree(event.target.value)}>
              {QUALIFICATION_DEGREES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Албан тушаал" required>
            {({ id }) => (
              <Input
                id={id}
                value={position}
                onChange={(event) => setPosition(event.target.value)}
              />
            )}
          </Field>
          <Field label="Ажилласан жил" required>
            {({ id }) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                value={years}
                onChange={(event) => setYears(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Тайлбар" hint={`${note.length}/2000`}>
          {({ id }) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </div>
    </FormDialog>
  );
}

/** What ESIS itself holds for this teacher — the page's former body, unchanged. */
function EsisRequests() {
  const { primaryKindergartenId } = useSession();
  const query = new URLSearchParams({ resource: "degreeRequest" }).toString();
  const request = useQuery({
    queryKey: qk.esisResource(primaryKindergartenId ?? "none", "degreeRequest", query),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/resource?${query}`, esisResourceReadSchema),
    enabled: Boolean(primaryKindergartenId),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const requestIds = [
    ...new Set(
      (request.data?.status === "SUCCEEDED" ? request.data.rows : [])
        .map((row) => row.requestId?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  if (request.isPending) return <LoadingState rows={2} shape="cards" />;
  if (request.isError) return <ErrorState description={errorMessage(request.error)} />;
  if (request.data?.status === "FAILED") {
    return (
      <ErrorState
        title="ESIS-ээс мэдээлэл авч чадсангүй"
        description="Түр хүлээгээд дахин оролдоно уу."
      />
    );
  }
  if (requestIds.length === 0) {
    return (
      <EmptyState
        icon={<Award size={24} aria-hidden />}
        title="Мэргэшлийн зэргийн хүсэлт алга"
        description="Таны регистрийн дугаарт холбогдсон хүсэлт ESIS-д одоогоор олдсонгүй."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {requestIds.map((requestId) => (
        <Card key={requestId} pad="roomy" className="flex flex-col gap-5">
          <SectionHeader
            title={`Хүсэлт №${requestId}`}
            lede="Зөвхөн таны бүртгэлтэй хүсэлтийн мэдээлэл."
          />
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            <EsisDataPanel
              resource="degreeDecisions"
              title="Хүсэлтийн шийдвэрлэлт"
              description="Шийдвэрлэлтийн төлөв"
              params={{ requestId }}
              askForParams={false}
            />
            <EsisDataPanel
              resource="degreeHistory"
              title="Хүсэлтийн түүх"
              description="Хүсэлтийн өөрчлөлтийн түүх"
              params={{ requestId }}
              askForParams={false}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}
