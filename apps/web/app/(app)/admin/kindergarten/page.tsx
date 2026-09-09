"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { SingleImageUpload } from "@/components/media/single-image-upload";

/**
 * The kindergarten's own details, for its director.
 *
 * The sidebar entry has always been called "Бүлэг, цэцэрлэгийн мэдээлэл", but
 * only the бүлэг half existed: an admin could create school years, groups and
 * users and had nowhere to correct their own kindergarten's name, address or
 * telephone number. `PATCH /kindergartens/:id` has been there since Phase 4
 * with no screen in front of it.
 *
 * ★ `isActive` is deliberately not offered here.
 *
 * The endpoint accepts it, but deactivating a kindergarten is a platform
 * decision — it is how the operator suspends a tenant, not something its own
 * director should be able to do to themselves by mis-clicking a switch on a
 * profile form. It lives on the platform routes instead.
 */
const detailSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  description: z.string().nullish(),
  logoMediaFileId: uuidSchema.nullish(),
});

export default function AdminKindergartenPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminKindergarten />
    </RequireRole>
  );
}

function AdminKindergarten() {
  const { primaryKindergartenId } = useSession();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.adminKindergarten(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}`, detailSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  if (isLoading) return <LoadingState rows={3} />;
  if (isError) return <ErrorState description={errorMessage(error)} />;

  return (
    /*
      ★ The form is capped at a readable measure rather than the shell's width.

      Every control here ran the full 1,140px of the content column, so the
      phone number and the email address each got an input wide enough for a
      paragraph. An input's width is a hint about what belongs in it, and one
      this wide says nothing except that the layout had space left over — while
      making the eye travel from a label on the left edge to a value that stops
      a third of the way across.

      760px is the page-level counterpart to the measures the modal forms
      already keep — `auth-shell` at 440 and `FormDialog` at 480 — which are
      narrower because a dialog floats over the page and a full screen would
      look thin at either. It applies to the wrapper, so the logo card above
      and the form below stay the same width instead of stepping.
    */
    <div className="flex max-w-[760px] flex-col gap-6 lg:gap-8">
      <PageHeader title="Цэцэрлэгийн мэдээлэл" />

      {/*
        RFP §3.2 asks for the logo, and §10.3 puts it on every generated PDF —
        which is the reason it sits at the top of this form rather than at the
        bottom. It is not decoration on a profile page; it is the mark on every
        report the kindergarten issues.

        Its own card, outside the form: it saves on selection, and a file input
        inside a form whose Save button does not apply to it is a reliable way
        to have somebody upload a logo and then wonder why "Хадгалах" is
        greyed out.
      */}
      {/*
        ★ The logo outlived the edit form — 2026-09-08.

        The client's instruction was that the record is not hand-corrected
        here: it arrives from ESIS. A logo does not. `organization/info` carries
        no image of any kind, so removing this upload with the form would mean
        the mark RFP §10.3 prints on every generated report could never be set
        or replaced again.

        It was behind the edit gate; with no gate left it is simply the card,
        and `SingleImageUpload` saves on selection — there was never a Хадгалах
        between the file picker and the change.
      */}
      <Card pad="roomy">
        <SectionHeader title="Лого" />
        <SingleImageUpload
          endpoint={`/kindergartens/${primaryKindergartenId}/logo`}
          currentMediaId={data?.logoMediaFileId}
          label="Лого нэмэх"
          alt={`${data?.name ?? "Цэцэрлэг"}-ийн лого`}
          hint="Тайлан, PDF бүрд хэвлэгдэнэ. JPEG, PNG эсвэл WebP."
          invalidateKeys={[qk.adminKindergarten(primaryKindergartenId ?? ""), qk.session()]}
        />
      </Card>

      {/*
        ★ The kindergarten's record, from ESIS — 2026-09-08, at the client's
        instruction, and since the same day the *only* version of it: "цэцэрлэгийн
        мэдээлэл байгаа бас засах хэрэггүй".

        This screen used to read the local record back as a card of five
        fields and open a form over it; both are gone, and the sixteen ESIS
        fields are the whole of it. `PATCH /kindergartens/:id` still exists and
        still works — nothing in this product calls it any more, so the name,
        address, telephone and e-mail the reports print are whatever they were
        last set to.

        Import is the step that would make that a temporary state, and it does
        not exist yet (`ESIS_API_READINESS.md` C5).
      */}
      <EsisDataPanel resource="organization" />

      {/*
        ★ The premises, under the institution they belong to — 2026-09-09, at
        the client's request ("байгууллагын барилга байгууламж").

        `organization/info` describes the kindergarten as a legal entity;
        `building/list` describes what it occupies — purpose, capacity,
        ownership and the valuation the ministry carries. RFP §3.2 asks for the
        premises, and this is the screen that already answers "what is this
        kindergarten", so it is where the second half of that answer goes.

        ★★ `room/list` (api-29) is its companion and is not carried: a room
        list is a seating plan, and nothing in this product reads one yet.
      */}
      <EsisDataPanel
        resource="buildings"
        title="Барилга байгууламж"
        description="Зориулалт, багтаамж, эзэмшлийн төрөл, бүртгэлийн үнэ"
      />
    </div>
  );
}
