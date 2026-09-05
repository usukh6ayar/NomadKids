"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Download, Send } from "lucide-react";
import { z } from "zod";
import {
  attendanceSubmissionSchema,
  dailyAttendanceSchema,
  groupListItemSchema,
  paginated,
  type DailyAttendance,
  type DailyAttendanceRow,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { downloadUrl } from "@/lib/api/client";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { StatCard } from "@/components/ui/stat-card";
import { TableShell, Td, Th } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SelectBox, SelectionBar, useSelection } from "@/components/ui/selection";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

const groupsSchema = paginated(groupListItemSchema);

/**
 * "Өдөр тутмын ирц" — the director's attendance register.
 *
 * ★ It has no buttons, and that is the whole reason it exists.
 *
 * `/groups/:id/attendance` is the teacher's day sheet: a child per row and six
 * status buttons on each, because a teacher's job there is to record. A
 * director does not press those. The client said so directly on 2026-09-04 —
 * "ерөөсөө захирал тэнд ирсэн, хагас өдөр гэх мэт тийм товчнуудыг дарахгүй,
 * цаанаасаа бүртгэлтэй тэр нь тоонууд зэрэг нь л харагдна" — and they are
 * right: a director's question is "has Дэлбээ filled in Tuesday, and what did
 * it come to", which is one row per group per day and nothing to click.
 *
 * ★★ Three attendance screens, and each answers a different question.
 *
 *   · `/groups/:id/attendance` — one group, one day, *writable*. The teacher's.
 *   · `/attendance/daily` — every group, every day, as counts. This one.
 *   · `/attendance/journal` — every child, every day, as a grid. The one an
 *     accountant opens when a figure on this screen needs explaining.
 *
 * They share `buildRegister` on the API, so no two of them can disagree about
 * what "recorded" means.
 *
 * ★★★ The columns are the client's list, in their order, with `Хичээлийн жил`
 * moved in front — a register with no school year on it cannot be filed. The
 * Excel export writes the same columns from the same `summariseDays`, so the
 * file is what is on screen.
 */
export default function DailyAttendancePage() {
  return (
    <RequireRole roles={["ADMIN", "ACCOUNTANT"]}>
      <DailyAttendance />
    </RequireRole>
  );
}

function DailyAttendance() {
  const { primaryKindergartenId } = useSession();

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [groupId, setGroupId] = useState("");

  const filters = useMemo(
    () => ({ from, to, ...(groupId ? { groupId } : {}) }),
    [from, to, groupId],
  );

  const queryString = useMemo(() => new URLSearchParams(filters).toString(), [filters]);

  const daily = useQuery({
    queryKey: qk.attendanceDaily(primaryKindergartenId ?? "", filters),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/attendance/daily?${queryString}`,
        dailyAttendanceSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
    // Keeps the table on screen while a date is being changed, rather than
    // collapsing to a skeleton on every keystroke in a date field.
    placeholderData: (previous) => previous,
  });

  /*
   * `GET /groups`, not `/kindergartens/:id/groups` — the second is POST-only,
   * and the funding register records what happened when a screen assumed
   * otherwise. The key matches `useSwitchableGroups`, so this usually reads a
   * cache the shell has already filled.
   */
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    queryFn: () => get("/groups?page=1&pageSize=100", groupsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 5 * 60_000,
  });

  const data = daily.data;

  /*
   * ★ The selection is keyed by group *and* date, not by group.
   *
   * A row is one group on one day, and the same group appears once per day in
   * the range. Keying on `groupId` alone would tick five Tuesdays when somebody
   * meant one. `useSelection` only needs the keys to be unique and stable,
   * which `groupId date` is, and it prunes to what is on screen — so changing
   * the date range clears ticks rather than submitting days nobody can see.
   */
  const rowKey = (row: DailyAttendanceRow) => `${row.groupId} ${row.date}`;
  const selection = useSelection((data?.items ?? []).map(rowKey));

  const toast = useToast();
  const queryClient = useQueryClient();

  /*
   * ★ "Ирц илгээх" — what the button actually does today.
   *
   * It records the submission: who declared this register final, when, and over
   * how many children. The eventual destination is ESIS, whose transport does
   * not exist yet (`docs/ESIS_API_READINESS.md` §1 — no API documentation, no
   * signed agreement, no token), and the API attaches that call
   * to the same row when it arrives. So the button works now and gains a
   * network hop later, rather than sitting disabled until a contract is signed.
   *
   * ★★ The API refuses an incomplete register and names which groups are
   * unfinished. That message is surfaced verbatim: "Ирц бүрэн бүртгэгдээгүй
   * байна: Дэлбээ (2026-09-03)" tells a director who to chase, which a generic
   * failure toast would not.
   */
  const submit = useMutation({
    mutationFn: () => {
      const entries = (data?.items ?? [])
        .filter((row) => selection.has(rowKey(row)))
        .map((row) => ({ groupId: row.groupId, date: row.date }));

      return mutate(
        `/kindergartens/${primaryKindergartenId}/attendance/daily/submit`,
        z.array(attendanceSubmissionSchema),
        { method: "POST", body: { entries } },
      );
    },
    onSuccess: (sent) => {
      toast.success(`${sent.length} бүртгэл илгээгдлээ.`);
      selection.clear();
      void queryClient.invalidateQueries({ queryKey: ["attendance", "daily"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-4 py-2">
      {/*
        ★ "Өдөр тутмын ирц", not "Ирц" — 2026-09-04.

        The teacher's day sheet is already titled "Ирц", and two screens with
        one name is a product where "go to Ирц" means different things to
        different people. The sidebar row stays "Ирц" for both — it is the same
        job seen from two chairs — and the page says which chair you are in.
      */}
      <PageHeader
        title="Өдөр тутмын ирц"
        lede="Бүлэг тус бүрийн өдрийн ирцийн дүн, сонгосон хугацаагаар."
      />

      <Card pad="roomy" className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Эхлэх">
            {({ id }) => (
              <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            )}
          </Field>
          <Field label="Дуусах">
            {({ id }) => (
              <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            )}
          </Field>
          <Field label="Бүлэг">
            {({ id }) => (
              <Select id={id} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Бүх бүлэг</option>
                {(groups.data?.items ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/*
            ★ A link, not a fetch — the browser downloads it with the session
            cookie it already has, and fetching would buffer a spreadsheet in
            memory only to hand it straight back. Absent rather than inert when
            there is no kindergarten to point at: `disabled` does nothing to an
            anchor.
          */}
          {primaryKindergartenId ? (
            <Button size="sm" variant="secondary" asChild>
              <a
                href={downloadUrl(
                  `/kindergartens/${primaryKindergartenId}/attendance/register/export?${queryString}`,
                )}
              >
                <Download size={16} aria-hidden /> Excel татах
              </a>
            </Button>
          ) : null}
        </div>
      </Card>

      {daily.isError ? (
        <ErrorState description={errorMessage(daily.error)} />
      ) : daily.isPending ? (
        <LoadingState rows={4} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Бүртгэл алга"
          description="Сонгосон хугацаанд идэвхтэй бүлэг олдсонгүй. Хугацаагаа өргөтгөж эсвэл бүлгийн шүүлтээ цэвэрлэж үзнэ үү."
        />
      ) : (
        <>
          {/*
            ★ Two headings, so the screen reads as two sections — 2026-09-04.

            The figures and the register ran together with nothing between
            them, which is the fault the client named on the journal ("дээд
            гарчиг шиг хэсэг ялгагдахгүй"). The first lede repeats the range
            because the table's rows are dates and the reader should not have
            to scroll back to the filter to know which.
          */}
          <SectionHeader
            title="Хугацааны дүн"
            lede={`${formatDate(data.from)} — ${formatDate(data.to)} · ${data.items.length} бүлэг-өдөр`}
          />
          <Totals totals={data.totals} />

          <SectionHeader
            title="Өдөр тутмын бүртгэл"
            lede="Бүлэг тус бүрийн өдрийн дүн. Бүрэн бүртгэгдсэн мөрийг сонгож илгээнэ."
          />
          <DailyTable
            rows={data.items}
            kindergartenName={data.kindergartenName}
            selection={selection}
            rowKey={rowKey}
          />

          {/*
            ★ Илгээх lives in the selection bar, not in the header.
            The client asked for a button "дээрээ" — above the table — and it
            began there, disabled, because there was nothing to submit *to*.
            Now that it submits specific group-days it needs to know which, and
            a button that acts on a selection belongs beside the count of what
            is selected. The bar is sticky, so it is on screen wherever the
            reader has scrolled to.
          */}
          <SelectionBar count={selection.count} onClear={selection.clear}>
            <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate()}>
              <Send size={16} aria-hidden />
              {submit.isPending ? "Илгээж байна…" : "Ирц илгээх"}
            </Button>
          </SelectionBar>
        </>
      )}
    </div>
  );
}

/**
 * The period's figures, above the table they are the sum of.
 *
 * ★ "Бүртгээгүй" leads, and it is the only one that changes tone.
 *
 * The other numbers are context; this one is a to-do list. A director opening
 * this screen at nine in the morning is asking which groups have not filled in
 * today, and a figure that sits in the same grey as the rest makes them read
 * five cards to find the one that needs them.
 */
function Totals({ totals }: { totals: DailyAttendance["totals"] }) {
  return (
    <section aria-label="Хугацааны дүн" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Ирц бүртгээгүй"
        value={totals.unrecorded}
        unit={`${totals.complete} / ${totals.days} өдөр бүрэн`}
        tone={totals.unrecorded > 0 ? "sun" : "mint"}
      />
      <StatCard label="Ирсэн" value={totals.present} tone="mint" />
      <StatCard label="Өвчтэй" value={totals.sick} tone="peach" />
      <StatCard
        label="Илгээсэн"
        value={totals.sent}
        unit={`${totals.days} өдрөөс`}
        tone={totals.sent === totals.days && totals.days > 0 ? "mint" : "sky"}
      />
    </section>
  );
}

/**
 * The register itself — the client's fourteen columns, in their order.
 *
 * ★ `Ирц бүрэн` is a badge rather than a tick.
 *
 * "Тийм"/"Үгүй" carries the fact in a word, so it survives being read aloud, and
 * the tone repeats it in colour for the eye running down the column. A tick and
 * a blank would say the same thing only to somebody who can see both.
 *
 * ★★ Nothing here is clickable except the group, which opens that group's day
 * sheet at that date — the one place a director does need to go, when a row
 * says a register was never filled in.
 */
function DailyTable({
  rows,
  kindergartenName,
  selection,
  rowKey,
}: {
  rows: DailyAttendanceRow[];
  kindergartenName: string;
  selection: ReturnType<typeof useSelection>;
  rowKey: (row: DailyAttendanceRow) => string;
}) {
  return (
    <TableShell caption="Өдөр тутмын ирцийн бүртгэл" minWidth="min-w-[1260px]">
      <thead>
        <tr>
          <Th className="w-10">
            <SelectBox
              checked={selection.allSelected}
              indeterminate={selection.someSelected}
              onChange={selection.toggleAll}
              label="Бүх мөрийг сонгох"
            />
          </Th>
          <Th>Хичээлийн жил</Th>
          <Th>Сургууль, цэцэрлэг</Th>
          <Th>Анги</Th>
          <Th>Огноо</Th>
          <Th numeric>Ирц бүртгээгүй</Th>
          <Th>Ирц бүрэн</Th>
          <Th numeric>Сурагчийн тоо</Th>
          <Th numeric>Ирсэн</Th>
          <Th numeric>Чөлөөтэй</Th>
          <Th numeric>Өвчтэй</Th>
          <Th numeric>Тасалсан</Th>
          <Th>Илгээсэн</Th>
          <Th>Илгээсэн хэрэглэгч</Th>
          <Th>Үүссэн</Th>
          <Th>Үүсгэсэн хэрэглэгч (Web)</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="transition-colors hover:bg-sunken">
            <Td>
              {/*
                ★ Only a complete register can be ticked.

                The API refuses an incomplete one — submitting a day with
                children still unmarked is the mistake that turns into a wrong
                funding figure — so offering the box and then rejecting the
                press would teach a director to distrust the control. The row
                still shows its "Үгүй" badge and its unrecorded count, which is
                what says *why* it cannot be sent.
              */}
              {row.complete ? (
                <SelectBox
                  checked={selection.has(rowKey(row))}
                  onChange={() => selection.toggle(rowKey(row))}
                  label={`${row.group}, ${row.date} — сонгох`}
                />
              ) : null}
            </Td>
            <Td className="whitespace-nowrap text-muted">{row.schoolYear || "—"}</Td>
            <Td className="text-muted">{kindergartenName || "—"}</Td>
            {/*
              ★ The one link on the screen, and it goes where a row that reads
              "Үгүй" sends you: that group's day sheet, on that date, where the
              register can actually be filled in. Every other cell is a figure.
            */}
            <Td className="whitespace-nowrap font-medium">
              <Link
                href={`/groups/${row.groupId}/attendance?date=${row.date}`}
                className="text-ink underline-offset-2 hover:text-primary hover:underline"
              >
                {row.group}
              </Link>
            </Td>
            <Td className="whitespace-nowrap tabular-nums text-muted">{formatDate(row.date)}</Td>
            <Td numeric className={row.unrecorded > 0 ? "font-semibold text-ink" : "text-muted"}>
              {row.unrecorded}
            </Td>
            <Td>
              <Badge tone={row.complete ? "mint" : "sun"}>{row.complete ? "Тийм" : "Үгүй"}</Badge>
            </Td>
            <Td numeric className="text-muted">
              {row.expected}
            </Td>
            <Td numeric className="text-ink">
              {row.present}
            </Td>
            <Td numeric className="text-muted">
              {row.excused}
            </Td>
            <Td numeric className="text-muted">
              {row.sick}
            </Td>
            <Td numeric className="text-muted">
              {row.absent}
            </Td>
            <Td className="whitespace-nowrap text-muted">
              {row.sentAt ? formatStamp(row.sentAt) : "—"}
            </Td>
            <Td className="text-muted">{row.sentBy ?? "—"}</Td>
            <Td className="whitespace-nowrap tabular-nums text-muted">
              {row.createdAt ? formatStamp(row.createdAt) : "—"}
            </Td>
            <Td className="text-muted">
              {row.createdBy.length > 0 ? row.createdBy.join(", ") : "—"}
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/** `YYYY-MM-DD HH:mm` — the same UTC stamp the exported file writes. */
function formatStamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
