"use client";

import { useQuery } from "@tanstack/react-query";
import { Award } from "lucide-react";
import { esisResourceReadSchema } from "@kinder/contracts";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";

/**
 * The signed-in teacher's own qualification requests.
 *
 * No register-number input exists here. The API resolves API 119 from the
 * authenticated user's `User.registerNumber`, then validates every 167/170
 * `requestId` against that result before it calls ESIS. The browser therefore
 * cannot turn this personal page into a lookup for another teacher.
 */
export default function QualificationsPage() {
  return (
    <RequireRole roles={["TEACHER"]}>
      <MyQualifications />
    </RequireRole>
  );
}

function MyQualifications() {
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

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Мэргэшлийн зэрэг"
        lede="Таны ESIS-д бүртгэлтэй мэргэшлийн зэргийн хүсэлт, шийдвэрлэлт болон түүх."
      />

      <Card pad="roomy">
        <SectionHeader
          title="Миний хүсэлт"
          lede="Хүсэлтийн дугаарыг таны бүртгэлтэй РД-гаар ESIS-ээс автоматаар авч байна. Өөр багшийн мэдээлэл энэ хуудсанд харагдахгүй."
        />
      </Card>

      {request.isPending ? (
        <LoadingState rows={2} shape="cards" />
      ) : request.isError ? (
        <ErrorState description={errorMessage(request.error)} />
      ) : request.data?.status === "FAILED" ? (
        <ErrorState
          title="ESIS-ээс мэдээлэл авч чадсангүй"
          description="Түр хүлээгээд дахин оролдоно уу."
        />
      ) : requestIds.length === 0 ? (
        <EmptyState
          icon={<Award size={24} aria-hidden />}
          title="Мэргэшлийн зэргийн хүсэлт алга"
          description="Таны регистрийн дугаарт холбогдсон хүсэлт ESIS-д одоогоор олдсонгүй."
        />
      ) : (
        requestIds.map((requestId) => (
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
        ))
      )}
    </div>
  );
}
