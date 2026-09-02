"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileText, X } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import {
  KINDERGARTEN_APPLICATION_STATUS_LABEL,
  CONTRACT_STATUS_LABEL,
  applicationApprovalSchema,
  kindergartenApplicationSchema,
  paginated,
  type KindergartenApplication,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

const listSchema = paginated(kindergartenApplicationSchema);

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

function Applications() {
  const [status, setStatus] = useState<(typeof TABS)[number]["value"]>("PENDING");
  const [reviewing, setReviewing] = useState<KindergartenApplication | null>(null);

  const list = useQuery({
    queryKey: ["platform", "applications", status],
    queryFn: () => get(`/platform/applications?status=${status}&page=1&pageSize=50`, listSchema),
  });

  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader
        title="Байгууллагын хүсэлт"
        lede="Цэцэрлэгүүдийн нэгдэх хүсэлт. Батласнаар цэцэрлэг болон гэрээ үүснэ."
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatus(tab.value)}
            className={`min-h-[40px] rounded-pill border px-3.5 text-body font-medium transition-colors ${
              status === tab.value
                ? "border-primary bg-primary-soft text-primary"
                : "border-border bg-surface text-muted hover:bg-canvas"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {list.isLoading ? <LoadingState rows={3} /> : null}
      {list.isError ? <ErrorState description={errorMessage(list.error)} /> : null}

      {list.data && items.length === 0 ? (
        <EmptyState
          title="Хүсэлт алга"
          description="Цэцэрлэг nomadkids.mn дээрх “Байгууллагын бүртгэл”-ээр хүсэлт илгээхэд энд харагдана."
        />
      ) : null}

      <div className="flex flex-col gap-4">
        {items.map((application) => (
          <ApplicationCard
            key={application.id}
            application={application}
            onReview={() => setReviewing(application)}
          />
        ))}
      </div>

      {reviewing ? (
        <ReviewDialog application={reviewing} onClose={() => setReviewing(null)} />
      ) : null}
    </div>
  );
}

function ApplicationCard({
  application,
  onReview,
}: {
  application: KindergartenApplication;
  onReview: () => void;
}) {
  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-lead font-semibold text-ink">{application.kindergartenName}</span>
            <Badge tone={application.status === "PENDING" ? "sun" : "neutral"}>
              {KINDERGARTEN_APPLICATION_STATUS_LABEL[application.status]}
            </Badge>
          </p>
          <p className="text-caption text-muted">
            РД {application.registrationNumber} · {application.childCount} хүүхэд ·{" "}
            {formatDate(application.createdAt)}
          </p>
        </div>

        {application.status === "PENDING" ? (
          <Button size="sm" onClick={onReview}>
            Шалгах
          </Button>
        ) : null}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-body sm:grid-cols-2">
        <Detail label="Эрхлэгч" value={application.directorName} />
        <Detail label="Утас" value={application.phone} />
        <Detail label="И-мэйл" value={application.email} />
        <Detail label="Хаяг" value={application.address} />
      </dl>

      {application.note ? <p className="text-body text-muted">{application.note}</p> : null}

      {application.reviewNote ? (
        <p className="rounded-row bg-canvas px-3 py-2 text-caption text-muted">
          Шийдвэрийн тэмдэглэл: {application.reviewNote}
        </p>
      ) : null}

      {/*
        ★ The contract appears here the moment it is created — step 4. The PDF
        is rendered on the queue (CLAUDE.md §6), so `pdfMediaFileId` is null for
        the first couple of seconds and the row says so rather than showing a
        dead link.
      */}
      {application.contract ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-3">
          <FileText size={16} aria-hidden="true" className="text-muted" />
          <span className="text-body font-medium text-ink">
            Гэрээ №{application.contract.number}
          </span>
          <Badge tone="sky">{CONTRACT_STATUS_LABEL[application.contract.status]}</Badge>
          {application.contract.pdfMediaFileId ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void openContractPdf(application.contract!.id)}
            >
              PDF татах
            </Button>
          ) : (
            <span className="text-caption text-muted">PDF бэлтгэгдэж байна…</span>
          )}
        </div>
      ) : null}
    </Card>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted">{label}:</dt>
      <dd className="min-w-0 truncate text-ink">{value}</dd>
    </div>
  );
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
  const [adminUsername, setAdminUsername] = useState("");
  const [annualFee, setAnnualFee] = useState("300000");
  const [perChildMonthlyFee, setPerChildMonthlyFee] = useState("1500");
  const [startsOn, setStartsOn] = useState(`${thisYear}-09-01`);
  const [endsOn, setEndsOn] = useState(`${thisYear + 1}-05-31`);
  const [reviewNote, setReviewNote] = useState("");

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["platform", "applications"] });

  const approve = useMutation({
    mutationFn: () =>
      mutate(`/platform/applications/${application.id}/approve`, applicationApprovalSchema, {
        method: "POST",
        body: {
          adminUsername: adminUsername.trim(),
          annualFee,
          perChildMonthlyFee,
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
            disabled={busy || adminUsername.trim().length < 3}
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
          label="Админы нэвтрэх нэр"
          error={errors.adminUsername}
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
          <Field label="Суурь хураамж (жилд)" error={errors.annualFee} required>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                inputMode="numeric"
                value={annualFee}
                onChange={(event) => setAnnualFee(event.target.value)}
              />
            )}
          </Field>

          <Field label="Хүүхэд/сар" error={errors.perChildMonthlyFee} required>
            {({ id, invalid }) => (
              <Input
                id={id}
                invalid={invalid}
                inputMode="numeric"
                value={perChildMonthlyFee}
                onChange={(event) => setPerChildMonthlyFee(event.target.value)}
              />
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
