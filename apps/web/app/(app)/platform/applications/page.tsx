"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import {
  CONTRACT_STATUS_LABEL,
  applicationApprovalSchema,
  kindergartenApplicationSchema,
  paginated,
  type BillingPeriod,
  type KindergartenApplication,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";
import { suggestUsername } from "@/lib/username";
import {
  FROZEN_NAME,
  FROZEN_NO,
  FilterChips,
  FilterSelect,
  SortHeader,
  labelOf,
  type Chip,
} from "@/components/platform/table-kit";
import { KINDERGARTEN_MONTHLY_PER_GROUP, contractSchedule } from "@/lib/pricing";

/*
 * ★ What the applicant is — 2026-10-14, the user: «Бүгд / Багш дангаар /
 * Цэцэрлэг / ЭСИС цэцэрлэг». The API does not send it yet (asked of the
 * admin); until it does every application is «Цэцэрлэг», which is true today —
 * they all come from the public kindergarten form.
 */
const applicationRowSchema = kindergartenApplicationSchema.extend({
  kind: z.enum(["kindergarten", "esis", "solo"]).nullish(),
});
type ApplicationRow = z.infer<typeof applicationRowSchema>;
type ApplicationKind = "kindergarten" | "esis" | "solo";

const listSchema = paginated(applicationRowSchema);

const KIND_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "solo", label: "Багш дангаар" },
  { value: "kindergarten", label: "Цэцэрлэг" },
  { value: "esis", label: "ЭСИС цэцэрлэг" },
] as const;

function kindOf(row: ApplicationRow): ApplicationKind {
  return row.kind ?? "kindergarten";
}

const TABS = [
  { value: "PENDING", label: "Хүлээгдэж буй" },
  { value: "APPROVED", label: "Батлагдсан" },
  { value: "REJECTED", label: "Татгалзсан" },
] as const;

/**
 * Байгууллагын хүсэлт — `docs/CONTRACT_ONBOARDING.md` steps 3–4.
 *
 * ★★ The screen where a person decides whether a stranger's form becomes a
 * tenant. Nothing before this point creates a `Kindergarten`, and that is the
 * whole safety argument for having a public registration form at all.
 *
 * ★ Superadmin only, and the endpoints answer **404** rather than 403 to
 * everybody else — a 403 would confirm the queue exists.
 */
export default function ApplicationsPage() {
  return (
    <RequireSuperAdmin>
      <Applications />
    </RequireSuperAdmin>
  );
}

type SortKey = "name" | "groups" | "created" | "reviewed";

/** «Бүгд», per term or per school year — the period the kindergarten asked for. */
const PERIOD_OPTIONS = [
  { value: "", label: "Бүгд" },
  { value: "term", label: "Улирлаар" },
  { value: "year", label: "Жилээр" },
] as const;

function compareApplications(
  a: ApplicationRow,
  b: ApplicationRow,
  key: SortKey,
  dir: 1 | -1,
): number {
  const value = (row: ApplicationRow): string | number | null =>
    key === "name"
      ? row.kindergartenName
      : key === "groups"
        ? (row.groupCount ?? null)
        : key === "reviewed"
          ? row.reviewedAt
          : row.createdAt;
  const x = value(a);
  const y = value(b);
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  const order =
    typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y), "mn");
  return order * dir;
}

/*
 * ★ A minimal table, as the kindergartens are — 2026-10-14, the user
 * ("хүснэгтээр минимал … хайх шүүлтүүр"). The three states stay tabs, each a
 * query of its own; the search and the period filter narrow the page the API
 * returned (50). The last column follows the state: «Шалгах» while pending,
 * the contract once approved, the reason once refused.
 */
function Applications() {
  const [status, setStatus] = useState<(typeof TABS)[number]["value"]>("PENDING");
  const [reviewing, setReviewing] = useState<KindergartenApplication | null>(null);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created", dir: -1 });

  const list = useQuery({
    queryKey: ["platform", "applications", status],
    queryFn: () => get(`/platform/applications?status=${status}&page=1&pageSize=50`, listSchema),
  });

  const items = list.data?.items ?? [];
  const needle = query.trim().toLocaleLowerCase("mn");
  const rows = items
    .filter(
      (row) =>
        (!needle ||
          [
            row.kindergartenName,
            row.registrationNumber,
            row.directorName,
            row.phone,
            row.email,
            row.address ?? "",
          ].some((text) => text.toLocaleLowerCase("mn").includes(needle))) &&
        (!kind || kindOf(row) === kind) &&
        (!period || row.billingPeriod === period),
    )
    .sort((a, b) => compareApplications(a, b, sort.key, sort.dir));
  const chips = [
    query.trim() && { key: "q", label: `«${query.trim()}»`, clear: () => setQuery("") },
    kind && { key: "kind", label: labelOf(KIND_OPTIONS, kind), clear: () => setKind("") },
    period && { key: "period", label: labelOf(PERIOD_OPTIONS, period), clear: () => setPeriod("") },
  ].filter((chip): chip is Chip => Boolean(chip));
  const clearAll = () => {
    setQuery("");
    setKind("");
    setPeriod("");
  };
  const sortBy = (key: SortKey) =>
    setSort((current) => ({ key, dir: current.key === key ? (-current.dir as 1 | -1) : 1 }));
  const decided = status !== "PENDING";

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PlatformPageHeading title="Байгууллагын хүсэлт" />

      <div role="group" aria-label="Хүсэлтийн төлөв" className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={status === tab.value}
            onClick={() => setStatus(tab.value)}
            className={`-mb-px min-h-10 border-b-2 px-3 text-compact font-semibold ${
              status === tab.value
                ? "border-primary text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section aria-label="Хүсэлтийн жагсаалт" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 sm:max-w-[480px]">
            <span className="sr-only">Хүсэлт хайх</span>
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <Input
              type="search"
              aria-label="Хүсэлт хайх"
              placeholder="Цэцэрлэг, РД, эрхлэгч, утас, и-мэйлээр хайх"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 pl-9 text-compact"
            />
          </label>
          {list.data ? (
            <span className="ml-auto text-caption text-muted">
              {chips.length ? `${items.length}-оос ${rows.length}` : rows.length} хүсэлт
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterSelect
            label="Төрөл"
            ariaLabel="Төрлөөр шүүх"
            value={kind}
            onChange={setKind}
            options={KIND_OPTIONS}
          />
          <FilterSelect
            label="Төлбөрийн хугацаа"
            ariaLabel="Төлбөрийн хугацаагаар шүүх"
            value={period}
            onChange={setPeriod}
            options={PERIOD_OPTIONS}
          />
        </div>
        <FilterChips chips={chips} onClearAll={clearAll} />

        {list.isLoading ? <LoadingState rows={3} /> : null}
        {list.isError ? <ErrorState description={errorMessage(list.error)} /> : null}

        {list.data && items.length === 0 ? (
          <EmptyState
            title="Хүсэлт алга"
            description="Цэцэрлэг nomadkids.mn дээрх “Байгууллагын бүртгэл”-ээр хүсэлт илгээхэд энд харагдана."
          />
        ) : null}
        {items.length > 0 && rows.length === 0 ? (
          <EmptyState title="Тохирох хүсэлт алга" description="Шүүлтүүрээ өөрчилж үзнэ үү." />
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-control border border-border bg-white">
            <table className="w-full min-w-[1380px] border-separate border-spacing-0 text-left text-caption">
              <thead className="bg-slate-50 text-muted">
                <tr className="[&>th]:whitespace-nowrap [&>th]:border-b [&>th]:border-r [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold [&>th:last-child]:border-r-0">
                  <th scope="col" className={`${FROZEN_NO} bg-slate-50 text-right`}>
                    №
                  </th>
                  <SortHeader
                    label="Цэцэрлэг"
                    column="name"
                    sort={sort}
                    onSort={sortBy}
                    className={`${FROZEN_NAME} bg-slate-50`}
                  />
                  <th scope="col">Төрөл</th>
                  <th scope="col">РД</th>
                  <th scope="col">Эрхлэгч</th>
                  <th scope="col">Утас</th>
                  <th scope="col">И-мэйл</th>
                  <th scope="col">Хаяг</th>
                  <SortHeader
                    label="Бүлэг"
                    column="groups"
                    sort={sort}
                    onSort={sortBy}
                    align="right"
                  />
                  <th scope="col">Хугацаа</th>
                  <th scope="col">Тэмдэглэл</th>
                  <SortHeader label="Илгээсэн" column="created" sort={sort} onSort={sortBy} />
                  {decided ? (
                    <SortHeader
                      label="Шийдвэрлэсэн"
                      column="reviewed"
                      sort={sort}
                      onSort={sortBy}
                    />
                  ) : null}
                  <th scope="col">
                    {status === "APPROVED" ? (
                      "Гэрээ"
                    ) : status === "REJECTED" ? (
                      "Шалтгаан"
                    ) : (
                      <span className="sr-only">Үйлдэл</span>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((application, index) => (
                  <ApplicationTableRow
                    key={application.id}
                    application={application}
                    index={index + 1}
                    decided={decided}
                    onReview={() => setReviewing(application)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {reviewing ? (
        <ReviewDialog application={reviewing} onClose={() => setReviewing(null)} />
      ) : null}
    </div>
  );
}

function ApplicationTableRow({
  application,
  index,
  decided,
  onReview,
}: {
  application: ApplicationRow;
  index: number;
  decided: boolean;
  onReview: () => void;
}) {
  const cell =
    "border-b border-r border-border-soft px-3 py-2 align-middle bg-white group-hover:bg-slate-50 last:border-r-0";
  const contract = application.contract;
  return (
    <tr className="group">
      <td className={`${cell} ${FROZEN_NO} text-right tabular-nums text-muted`}>{index}</td>
      <td className={`${cell} ${FROZEN_NAME} font-semibold text-ink`}>
        {application.kindergartenName}
      </td>
      <td className={`${cell} whitespace-nowrap`}>{labelOf(KIND_OPTIONS, kindOf(application))}</td>
      <td className={`${cell} tabular-nums`}>{application.registrationNumber}</td>
      <td className={`${cell} whitespace-nowrap`}>{application.directorName}</td>
      <td className={`${cell} whitespace-nowrap tabular-nums`}>{application.phone}</td>
      <td className={`${cell} max-w-[200px] truncate`}>{application.email}</td>
      <td className={`${cell} max-w-[220px] truncate`} title={application.address ?? undefined}>
        {application.address || "—"}
      </td>
      <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>
        {groupsOf(application)}
      </td>
      <td className={`${cell} whitespace-nowrap`}>
        {application.billingPeriod ? PERIOD_LABEL[application.billingPeriod] : "—"}
      </td>
      <td className={`${cell} max-w-[220px] truncate`} title={application.note ?? undefined}>
        {application.note || "—"}
      </td>
      <td className={`${cell} whitespace-nowrap tabular-nums`}>
        {formatDate(application.createdAt)}
      </td>
      {decided ? (
        <td className={`${cell} whitespace-nowrap tabular-nums`}>
          {application.reviewedAt ? formatDate(application.reviewedAt) : "—"}
        </td>
      ) : null}
      <td className={`${cell} whitespace-nowrap`}>
        {application.status === "PENDING" ? (
          <Button size="sm" onClick={onReview}>
            Шалгах
          </Button>
        ) : application.status === "REJECTED" ? (
          <span
            className="block max-w-[280px] truncate whitespace-normal text-muted"
            title={application.reviewNote ?? undefined}
          >
            {application.reviewNote || "—"}
          </span>
        ) : contract ? (
          /*
            ★ The contract appears the moment it is created — step 4. The PDF
            is rendered on the queue (CLAUDE.md §6), so `pdfMediaFileId` is null
            for the first seconds and the cell says so rather than showing a
            dead link.
          */
          <span className="inline-flex items-center gap-2">
            <span className="font-medium text-ink">№{contract.number}</span>
            <Badge tone="sky">{CONTRACT_STATUS_LABEL[contract.status]}</Badge>
            {contract.pdfMediaFileId ? (
              <button
                type="button"
                onClick={() => void openContractPdf(contract.id)}
                className="font-semibold text-primary hover:underline"
              >
                PDF
              </button>
            ) : (
              <span className="text-muted">PDF бэлтгэгдэж байна…</span>
            )}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

/**
 * Opens the contract PDF.
 *
 * ★ The link is fetched and followed rather than rendered as an `<a href>`,
 * because it is minted per click and lives for minutes. A presigned URL sitting
 * in the DOM is a bearer credential in a page somebody may leave open.
 */
async function openContractPdf(contractId: string): Promise<void> {
  const { url } = await get(
    `/platform/contracts/${contractId}/download`,
    z.object({ url: z.string() }),
  );
  window.open(url, "_blank", "noopener");
}

const PERIOD_LABEL: Record<BillingPeriod, string> = { term: "Улирлаар", year: "Жилээр" };

/**
 * «6» — since #195 an application is priced per group; one made before carries
 * a child count instead, and says so: «80 хүүхэд».
 */
function groupsOf(application: KindergartenApplication): string {
  if (application.groupCount !== null) return String(application.groupCount);
  return application.childCount !== null ? `${application.childCount} хүүхэд` : "—";
}

/**
 * The decision.
 *
 * ★★★ The prices are typed in here and **frozen onto the contract row**. They
 * are not read from a settings table, now or ever: a contract is a document two
 * parties sign, and if its figures were live then changing a price would
 * silently rewrite every contract already printed and sealed.
 */
function ReviewDialog({
  application,
  onClose,
}: {
  application: KindergartenApplication;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const thisYear = new Date().getUTCFullYear();
  // Suggested from the kindergarten's name, never the director's — two
  // directors can share a name (the user, 2026-10-14).
  const [adminUsername, setAdminUsername] = useState(() =>
    suggestUsername(application.kindergartenName),
  );
  /*
    ★ Pre-filled from the application and the price sheet (`lib/pricing.ts`),
    then the operator's to confirm or change: the contract freezes whatever is
    sent. An application from before #195 has no groups, so that field starts
    empty and must be filled.
  */
  const [groupCount, setGroupCount] = useState(
    application.groupCount !== null ? String(application.groupCount) : "",
  );
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(
    application.billingPeriod ?? "year",
  );
  const [startsOn, setStartsOn] = useState(`${thisYear}-09-01`);
  const [endsOn, setEndsOn] = useState(`${thisYear + 1}-05-31`);
  /*
    ★ The price is worked out, not typed — 2026-10-14, the user: the contract's
    terms (or years) at the price of the day, the discount on the lines it
    applies to, and the contract's whole sum sent as `periodFee`, which the PDF
    prints as «Нийт төлбөр». A negotiated price is typed only after ticking
    «Тохиролцсон үнээр өөрчлөх». `perGroupMonthlyFee` is the base rate.
  */
  const groups = Number(groupCount);
  const schedule = contractSchedule(groups, billingPeriod, startsOn, endsOn);
  const [negotiated, setNegotiated] = useState(false);
  const [negotiatedFee, setNegotiatedFee] = useState("");
  const perGroupMonthlyFee = String(KINDERGARTEN_MONTHLY_PER_GROUP);
  const periodFee = negotiated ? negotiatedFee.trim() : schedule ? String(schedule.total) : "";
  const usernameBad =
    adminUsername.trim() !== "" && !/^[a-zA-Z0-9._-]+$/.test(adminUsername.trim());
  const [reviewNote, setReviewNote] = useState("");

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["platform", "applications"] });

  const approve = useMutation({
    mutationFn: () =>
      mutate(`/platform/applications/${application.id}/approve`, applicationApprovalSchema, {
        method: "POST",
        body: {
          adminUsername: adminUsername.trim(),
          groupCount: groups,
          billingPeriod,
          perGroupMonthlyFee,
          periodFee,
          startsOn,
          endsOn,
          ...(reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}),
        },
      }),
    onSuccess: () => {
      refresh();
    },
  });

  const reject = useMutation({
    mutationFn: () =>
      mutate(`/platform/applications/${application.id}/reject`, kindergartenApplicationSchema, {
        method: "POST",
        body: { reviewNote: reviewNote.trim() },
      }),
    onSuccess: () => {
      toast.success("Хүсэлтээс татгалзлаа.");
      refresh();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const busy = approve.isPending || reject.isPending;
  const errors = fieldErrors(approve.error);

  /*
    ★★★ The invitation is shown **once**, and the dialog stays open to show it.

    The token exists in plaintext for exactly this moment — it is stored hashed
    — so closing the dialog on success, as the reject path does, would destroy
    the one thing the operator has to hand over. This is the same handover
    `PlatformService.create` has always required; making it a screen rather
    than a JSON field is the whole UX difference.
  */
  if (approve.isSuccess) {
    const approved = approve.data;
    return (
      <FormDialog
        open
        onOpenChange={(next) => !next && onClose()}
        busy={false}
        title="Батлагдлаа"
        // ★ No footer: `InvitationHandover` renders its own close button, and
        // two "Хаах" buttons in one dialog is a dialog nobody trusts.
      >
        <div className="flex flex-col gap-4">
          <Card pad="roomy" tone="mint" className="flex flex-col gap-1">
            <p className="text-body font-semibold text-ink">Гэрээ №{approved.contract?.number}</p>
            <p className="text-caption text-muted">
              PDF дараалалд орлоо. Хэдхэн секундын дараа “PDF татах” товч гарч ирнэ.
            </p>
          </Card>

          {/*
            ★ `InvitationHandover`, not a second handover screen. It already
            draws the QR locally — never sending the token to an image service
            to be rendered — shows the link for reading out over the phone, and
            says in as many words that this appears once. Two components doing
            this would be two places to get a credential's presentation wrong.
          */}
          <InvitationHandover
            token={approved.invitationToken}
            title={`${application.kindergartenName} — эрхлэгчийн урилга`}
            subtitle={`Нэвтрэх нэр: ${approved.adminUsername}`}
            onClose={onClose}
          />
        </div>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      busy={busy}
      title={`${application.kindergartenName} — шалгах`}
      footer={
        <>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy || reviewNote.trim().length < 4}
            onClick={() => reject.mutate()}
          >
            <X size={16} aria-hidden="true" />
            Татгалзах
          </Button>
          <Button
            type="submit"
            form="review-form"
            size="sm"
            disabled={busy || adminUsername.trim().length < 3 || usernameBad || !periodFee}
          >
            <Check size={16} aria-hidden="true" />
            {approve.isPending ? "Батлаж байна…" : "Батлах"}
          </Button>
        </>
      }
    >
      <form
        id="review-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) approve.mutate();
        }}
      >
        <FormError
          message={
            approve.isError && Object.keys(errors).length === 0 ? errorMessage(approve.error) : null
          }
        />

        <p className="text-body text-muted">
          Батласнаар <strong>цэцэрлэг, эрхлэгчийн бүртгэл, гэрээ</strong> гурав зэрэг үүснэ. Доорх
          дүнгүүд гэрээн дээр хэвлэгдэж, дараа нь өөрчлөгдөхгүй.
        </p>

        <Field
          label="Эрхлэгчийн нэвтрэх нэр"
          error={usernameBad ? "Латин үсэг, тоо, . _ - тэмдэгтээр бичнэ үү" : errors.adminUsername}
          hint="Латин үсэг, тоо, . _ - · Эрхлэгч энэ нэрээр нэвтэрнэ"
          required
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={adminUsername}
              onChange={(event) => setAdminUsername(event.target.value)}
              placeholder="жишээ: azjargal"
              autoFocus
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Бүлгийн тоо" error={errors.groupCount} required>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                inputMode="numeric"
                value={groupCount}
                onChange={(event) => setGroupCount(event.target.value)}
              />
            )}
          </Field>

          <Field label="Төлбөрийн хугацаа" error={errors.billingPeriod} required>
            {({ id, invalid }) => (
              <Select
                id={id}
                invalid={invalid}
                value={billingPeriod}
                onChange={(event) => setBillingPeriod(event.target.value as BillingPeriod)}
              >
                <option value="term">Улирал</option>
                <option value="year">Хичээлийн жил</option>
              </Select>
            )}
          </Field>

          <Field label="Эхлэх огноо" error={errors.startsOn} required>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            )}
          </Field>

          <Field label="Дуусах огноо" error={errors.endsOn} required>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            )}
          </Field>
        </div>

        <ContractBreakdown schedule={schedule} error={negotiated ? undefined : errors.periodFee} />

        <label className="flex items-center gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={negotiated}
            onChange={(event) => setNegotiated(event.target.checked)}
            className="size-4"
          />
          Тохиролцсон үнээр өөрчлөх
        </label>
        {negotiated ? (
          <Field
            label="Тохиролцсон нийт дүн"
            error={errors.periodFee}
            hint="Гэрээн дээр «Нийт төлбөр» болж хэвлэгдэнэ"
            required
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                inputMode="numeric"
                value={negotiatedFee}
                onChange={(event) => setNegotiatedFee(event.target.value)}
                placeholder={schedule ? String(schedule.total) : undefined}
              />
            )}
          </Field>
        ) : null}

        <Field
          label="Тэмдэглэл"
          hint="Татгалзахад заавал — цэцэрлэгт шалтгааныг хэлнэ"
          error={errors.reviewNote}
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={2}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
            />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}

/** «6,000₮». */
function tugrug(value: number): string {
  return `${value.toLocaleString("en-US")}₮`;
}

/**
 * «Төлбөрийн задаргаа» — each term (or school year) of the contract at the
 * price of the day, and the contract's sum. Nothing to type: the figures
 * follow the groups, the period and the dates.
 */
function ContractBreakdown({
  schedule,
  error,
}: {
  schedule: ReturnType<typeof contractSchedule>;
  error?: string;
}) {
  return (
    <section
      aria-label="Төлбөрийн задаргаа"
      className="rounded-control border border-border bg-white text-caption"
    >
      <p className="border-b border-border-soft bg-slate-50 px-3 py-2 font-semibold text-muted">
        Төлбөрийн задаргаа
      </p>
      {schedule ? (
        <>
          <ul className="divide-y divide-border-soft">
            {schedule.lines.map((line) => (
              <li
                key={line.label}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2"
              >
                <span className="min-w-0 flex-1 text-ink">{line.label}</span>
                <span className="tabular-nums text-muted">
                  {line.perMonth !== null
                    ? `${tugrug(line.perMonth)} × ${line.months} сар × ${line.groups} бүлэг`
                    : `${tugrug(line.perGroup)} × ${line.groups} бүлэг`}
                </span>
                <span className="w-24 text-right font-semibold tabular-nums text-ink">
                  {tugrug(line.amount)}
                </span>
                {line.discounted ? (
                  <Badge tone="mint">Хямдрал</Badge>
                ) : (
                  <span className="w-[62px]" aria-hidden="true" />
                )}
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border px-3 py-2">
            <span className="font-semibold text-ink">Гэрээний нийт дүн</span>
            <span className="text-lead font-bold tabular-nums text-ink">
              {tugrug(schedule.total)}
            </span>
          </p>
          <p className="px-3 pb-2 text-muted">
            Суурь үнэ: бүлэг тутам сард {tugrug(KINDERGARTEN_MONTHLY_PER_GROUP)}
            {schedule.standardTotal > schedule.total
              ? ` · Суурь үнээр ${tugrug(schedule.standardTotal)} — ${tugrug(
                  schedule.standardTotal - schedule.total,
                )} хэмнэлт`
              : ""}
          </p>
        </>
      ) : (
        <p className="px-3 py-2 text-muted">
          Бүлгийн тоо, гэрээний огноог оруулахад дүн бодогдоно.
        </p>
      )}
      {error ? <p className="px-3 pb-2 text-danger">{error}</p> : null}
    </section>
  );
}
