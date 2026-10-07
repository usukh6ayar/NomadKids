"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Search, Sparkles } from "lucide-react";
import { z } from "zod";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Select } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { fullName } from "@/lib/format";
import {
  QUALIFICATION_STATUS_LABEL as STATUS_LABEL,
  isDecided,
  qualificationRequestsSchema as requestsSchema,
  type QualificationRequest,
} from "@/lib/qualifications";
import { RequestRow, SectionTop } from "@/components/qualifications/request-parts";

/**
 * Мэргэшлийн зэрэг — the client's 2026-10-07 design: «Миний хүсэлт»,
 * «Хүсэлтийн жагсаалт» by status, and «Шийдвэрлэгдсэн».
 *
 * ★ Frontend first, by the client's instruction ("эхлээд фронт хий тэгээд
 * бакдаа хэлнэ"). The ESIS services this page used to drive one at a time
 * (119 by register number, 167/170 by `requestId`) cannot list a
 * kindergarten's requests: building the list here would be two or three ESIS
 * calls per teacher, which CLAUDE.md §3.4 forbids. So the page reads one
 * endpoint the API does not have yet:
 *
 *   GET /kindergartens/:id/qualification-requests?schoolYearId=&page=&pageSize=
 *   → paginated(QualificationRequest)
 *
 * Until it exists the request answers 404, and the page says so in one line
 * rather than breaking. `lib/qualifications.ts` is the contract to hand the
 * backend.
 *
 * ★★ «Шинэ хүсэлт» is drawn and disabled: it is API 165, the ESIS write this
 * page has always refused to send before its full contract is confirmed.
 *
 * The one-at-a-time ESIS tools stay, folded at the foot — they still answer
 * "what does ESIS say about this one request" while the list is being built.
 */

const yearsSchema = z.array(
  z.object({ id: z.string(), name: z.string(), isCurrent: z.boolean().nullish() }),
);

export default function AdminQualificationsPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <Qualifications />
    </RequireRole>
  );
}

function Qualifications() {
  const { primaryKindergartenId: kindergartenId } = useSession();
  const [chosenYear, setChosenYear] = useState("");
  const [search, setSearch] = useState("");

  const years = useQuery({
    queryKey: qk.schoolYears(kindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${kindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(kindergartenId),
    staleTime: 5 * 60_000,
  });
  const yearItems = years.data ?? [];
  const yearId =
    chosenYear || yearItems.find((year) => year.isCurrent)?.id || yearItems[0]?.id || "";
  const yearName = yearItems.find((year) => year.id === yearId)?.name;

  const requests = useQuery({
    queryKey: ["kindergarten", kindergartenId, "qualification-requests", yearId],
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/qualification-requests?${new URLSearchParams({
          ...(yearId ? { schoolYearId: yearId } : {}),
          page: "1",
          pageSize: "100",
        })}`,
        requestsSchema,
      ),
    // After the years, so the first request already carries the year.
    enabled: Boolean(kindergartenId) && !years.isPending,
    retry: false,
  });

  const notReady = requests.isError && isNotFound(requests.error);
  const items = useMemo(() => requests.data?.items ?? [], [requests.data]);
  const mine = items.filter((row) => row.isMine);

  const needle = search.trim().toLocaleLowerCase("mn-MN");
  const matches = (row: QualificationRequest) =>
    !needle ||
    [fullName(row.person), row.position ?? "", row.degree ?? ""]
      .join(" ")
      .toLocaleLowerCase("mn-MN")
      .includes(needle);
  const open = items.filter((row) => !isDecided(row.status) && matches(row));
  const decided = items.filter((row) => isDecided(row.status));

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader title="Мэргэшлийн зэрэг" />

      {notReady ? (
        <p role="status" className="rounded-row bg-canvas px-4 py-3 text-body text-muted">
          Хүсэлтийн жагсаалтын сервер холболт хараахан бэлэн болоогүй байна.
        </p>
      ) : null}
      {requests.isError && !notReady ? (
        <ErrorState description={errorMessage(requests.error)} />
      ) : null}

      {/* Миний хүсэлт */}
      <Card pad="none" className="overflow-hidden">
        <SectionTop title="Миний хүсэлт" lede="Өөрийн илгээсэн хүсэлтүүд">
          <span className="grid min-w-10 place-items-center rounded-pill bg-canvas px-3 py-1.5 text-body tabular-nums text-ink">
            {mine.length}
          </span>
        </SectionTop>
        {requests.isLoading ? (
          <div className="p-4">
            <LoadingState rows={2} />
          </div>
        ) : mine.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="grid size-16 place-items-center rounded-pill bg-canvas text-ink">
              <Sparkles size={22} aria-hidden="true" />
            </span>
            <p className="mt-2 text-lead font-semibold text-ink">Одоогоор хүсэлт байхгүй</p>
            <p className="max-w-xs text-body text-muted">
              Шинэ хүсэлт үүсгээд явцыг эндээс хянах боломжтой.
            </p>
            <Button className="mt-3" disabled title="ЭСИС-ийн API 165 идэвхжсэний дараа">
              <Plus size={18} aria-hidden="true" />
              Шинэ хүсэлт
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2 p-4">
            {mine.map((row) => (
              <RequestRow key={row.id} row={row} showStatus />
            ))}
          </ul>
        )}
      </Card>

      {/* Хүсэлтийн жагсаалт */}
      <Card pad="none" className="overflow-hidden">
        <SectionTop title="Хүсэлтийн жагсаалт" lede="Төлөвөөр ангилсан" divided={false}>
          {yearItems.length > 0 ? (
            <Select
              aria-label="Хичээлийн жил"
              value={yearId}
              onChange={(event) => setChosenYear(event.target.value)}
              className="h-11 w-auto min-w-[130px] rounded-pill"
            >
              {yearItems.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </Select>
          ) : null}
        </SectionTop>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <label className="relative block">
            <span className="sr-only">Нэр, ажлын нэрээр хайх</span>
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Нэр, ажлын нэрээр хайх…"
              className="h-11 w-full rounded-pill border border-border bg-surface pl-10 pr-4 text-body text-ink outline-none placeholder:text-faint focus:border-primary"
            />
          </label>

          {requests.isLoading ? <LoadingState rows={3} /> : null}

          {(["NEW", "IN_REVIEW"] as const).map((status) => {
            const rows = open.filter((row) => row.status === status);
            if (rows.length === 0) return null;
            return (
              <section
                key={status}
                aria-label={STATUS_LABEL[status]}
                className="flex flex-col gap-2 rounded-card bg-canvas p-3"
              >
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-body font-semibold text-ink">{STATUS_LABEL[status]}</h3>
                  <span className="text-body tabular-nums text-ink">{rows.length}</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {rows.map((row) => (
                    <RequestRow key={row.id} row={row} />
                  ))}
                </ul>
              </section>
            );
          })}

          {requests.data && open.length === 0 ? (
            <p className="px-1 py-4 text-center text-body text-muted">
              {needle ? "Хайлтад тохирох хүсэлт алга." : "Шийдвэрлэх хүсэлт алга."}
            </p>
          ) : null}
        </div>
      </Card>

      {/* Шийдвэрлэгдсэн */}
      <Card pad="none" className="overflow-hidden">
        <SectionTop title="Шийдвэрлэгдсэн" lede={`Нийт ${decided.length} хүсэлт`} divided={false}>
          {yearName ? (
            <span className="rounded-pill bg-canvas px-3 py-1.5 text-body tabular-nums text-ink">
              {yearName}
            </span>
          ) : null}
        </SectionTop>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="rounded-card bg-canvas px-4 py-3">
            <p className="text-caption text-muted">Нийт шийдвэрлэсэн</p>
            <p className="text-heading font-semibold tabular-nums text-ink">{decided.length}</p>
          </div>
          {decided.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {decided.map((row) => (
                <RequestRow key={row.id} row={row} showStatus bordered />
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      {/*
        The one-request ESIS tools, folded — they still answer "what does ESIS
        say about this one" while the list endpoint is being built.
      */}
      <Disclosure title="ЭСИС-ээс нэг хүсэлт шалгах" compact>
        <div className="flex flex-col gap-4">
          <EsisDataPanel
            resource="degreeRequest"
            title="Хүсэлтийн дугаар авах"
            description="API 119 · Багшийн РД-гаар мэргэшлийн зэргийн requestId авна"
            autoRead={false}
            actionLabel="Хүсэлтийн дугаар авах"
          />
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <EsisDataPanel
              resource="degreeDecisions"
              title="Хүсэлтийн шийдвэрлэлт"
              description="API 167 · requestId-аар шийдвэрлэлтийн төлөв шалгана"
              autoRead={false}
            />
            <EsisDataPanel
              resource="degreeHistory"
              title="Хүсэлтийн түүх"
              description="API 170 · requestId-аар хүсэлтийн өөрчлөлтийн түүх харна"
              autoRead={false}
            />
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
