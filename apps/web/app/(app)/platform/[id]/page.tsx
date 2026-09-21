"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Building2, Database } from "lucide-react";
import {
  platformKindergartenDetailSchema,
  type PlatformKindergartenDetail,
} from "@kinder/contracts";
import { useState } from "react";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import {
  AssessmentCoverageSection,
  RecentActivitySection,
  StatGrid,
} from "@/components/admin/dashboard-sections";
import { ToggleActiveButton } from "@/components/admin/toggle-kindergarten-active";
import { DeleteKindergartenButton } from "@/components/admin/delete-kindergarten-button";
import { KindergartenAdmins } from "@/components/platform/kindergarten-admins";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

/**
 * The platform operator's view into one kindergarten — the "info from
 * kindergartens" drill-down `/platform`'s flat list never offered. Same
 * counts/coverage/activity shape a kindergarten's own admin dashboard shows
 * (`/admin`), because the API computes both from the same queries scoped to
 * this one tenant rather than to the caller's memberships.
 *
 * The operator can manage the tenant's availability, director access and ESIS
 * mapping here. Classroom and child records remain with that kindergarten's
 * own administrator.
 */
export default function PlatformKindergartenPage() {
  return (
    <RequireSuperAdmin>
      <KindergartenDetail />
    </RequireSuperAdmin>
  );
}

function KindergartenDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.platformKindergarten(id),
    queryFn: () => get(`/platform/kindergartens/${id}`, platformKindergartenDetailSchema),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <LoadingState rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-6">
        <ErrorState
          title={isNotFound(error) ? "Олдсонгүй" : "Алдаа гарлаа"}
          description={isNotFound(error) ? "Энэ цэцэрлэг олдсонгүй." : errorMessage(error)}
          action={
            <Button asChild variant="secondary">
              <Link href="/platform">Цэцэрлэгүүд рүү буцах</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const kg = data!;

  return (
    <div className="flex flex-col gap-6 pb-8 lg:gap-8">
      <PlatformPageHeading
        backHref="/platform"
        title={kg.name}
        lede={kg.description || "Байгууллагын мэдээлэл, удирдлага болон ESIS холболт."}
        mark={<Building2 />}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone={kg.isActive ? "mint" : "neutral"}>
              {kg.isActive ? "Идэвхтэй" : "Идэвхгүй"}
            </Badge>
            <ToggleActiveButton kindergarten={kg} />
            {/*
              Back to the list on success: this screen reads a kindergarten
              that no longer exists, and staying on it would answer 404 the
              moment anything refetched.
            */}
            <DeleteKindergartenButton
              kindergarten={kg}
              onDeleted={() => router.replace("/platform")}
            />
          </span>
        }
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-title font-bold text-ink">Байгууллагын тойм</h2>
        <StatGrid counts={kg.counts} />
      </div>

      {/*
        Above the ESIS card on purpose: "can anybody sign in to this tenant"
        outranks "which institution does it read", and it is the question an
        operator opening this page during onboarding actually has.
      */}
      <KindergartenAdmins
        kindergartenId={kg.id}
        esisInstitutionId={kg.esisInstitutionId ?? null}
        admins={kg.admins}
      />

      <EsisMappingCard kindergarten={kg} />

      <AssessmentCoverageSection
        coverage={kg.assessmentCoverage}
        hasCurrentTerm={Boolean(kg.currentTerm)}
      />

      <RecentActivitySection entries={kg.recentActivity} />
    </div>
  );
}

const esisMappingResultSchema = z.object({
  id: z.string().uuid(),
  esisInstitutionId: z.string().nullable(),
  esisMappedAt: z.string().nullable(),
});

function EsisMappingCard({ kindergarten }: { kindergarten: PlatformKindergartenDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [institutionId, setInstitutionId] = useState(kindergarten.esisInstitutionId ?? "");
  const save = useMutation({
    mutationFn: (mapped: boolean) =>
      mutate(`/platform/kindergartens/${kindergarten.id}/esis/mapping`, esisMappingResultSchema, {
        method: "PUT",
        body: mapped ? { mapped: true, institutionId: institutionId.trim() } : { mapped: false },
      }),
    onSuccess: (result) => {
      setInstitutionId(result.esisInstitutionId ?? "");
      toast.success(
        result.esisInstitutionId ? "ESIS mapping хадгаллаа." : "ESIS mapping салгалаа.",
      );
      void queryClient.invalidateQueries({ queryKey: qk.platformKindergarten(kindergarten.id) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <section aria-labelledby="platform-esis-heading">
      <SectionHeader
        id="platform-esis-heading"
        title="ESIS байгууллагын mapping"
        lede="Энэ тохиргоо тухайн цэцэрлэгийн админ ямар ESIS institution уншихыг хязгаарлана."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/platform/${kindergarten.id}/esis`}>ESIS мэдээллийн төв</Link>
          </Button>
        }
      />
      <Card pad="roomy" className="shadow-sm">
        {/*
          ★ Two columns, and the buttons share one row — 2026-09-19.

          The grid asked for **three** columns,
          `[minmax(0,1fr)_220px_auto]`, and only two children were left to fill
          them: the "Орчин" picker that used to sit in the middle was dropped
          the same day (the ministry runs no ESIS test environment, so the
          field offered a second option that could only ever be wrong, and
          `20260919150000_drop_esis_environment` removed the column behind it).
          The button pair therefore landed in the 220px slot and wrapped —
          Хадгалах above Салгах, which is what made this card look broken.
        */}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <Field
            label="ESIS institution ID"
            hint={
              kindergarten.esisInstitutionId
                ? `Одоо холбогдсон: ${kindergarten.esisInstitutionId}`
                : "Холбогдоогүй байна."
            }
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={institutionId}
                onChange={(event) => setInstitutionId(event.target.value)}
                placeholder="Жишээ: 40305"
                inputMode="numeric"
              />
            )}
          </Field>

          {/*
            `flex-nowrap` with `shrink-0` on the pair rather than `flex-wrap`:
            at every width from 375px up the two labels fit side by side, and
            the auto column is sized to them.
          */}
          <div className="flex flex-nowrap items-center gap-2">
            <Button
              className="shrink-0"
              disabled={!institutionId.trim() || save.isPending}
              onClick={() => save.mutate(true)}
            >
              <Database aria-hidden />
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
            {kindergarten.esisInstitutionId ? (
              <Button
                variant="ghost"
                className="shrink-0 text-danger hover:bg-danger-soft"
                disabled={save.isPending}
                onClick={() => save.mutate(false)}
              >
                Салгах
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}
