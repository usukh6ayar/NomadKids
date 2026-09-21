"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock3, Send } from "lucide-react";
import { esisWriteRequestsPageSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { EsisRawResponse, EsisResponseValues } from "./esis-response";
import { ESIS_WRITE_SERVICE_LABEL } from "./esis-group-write";

const STATE_LABEL: Record<string, string> = {
  PREPARED: "Хүлээгдэж байна",
  APPROVED: "Батлагдсан",
  SENT: "Илгээгдсэн",
  FAILED: "Уналаа",
  CANCELLED: "Болисон",
};

const STATE_TONE = {
  PREPARED: "sun",
  APPROVED: "sky",
  SENT: "sky",
  FAILED: "danger",
  CANCELLED: "neutral",
} as const;

/**
 * Every write this kindergarten has sent, or is about to.
 *
 * ★ `SENT` reads "Илгээгдсэн", not "Амжилттай". ESIS answering is not ESIS
 * agreeing — a `200` carrying a refusal inside it is still an answer — so the
 * ministry's own response is printed beside the row and the director reads it,
 * rather than this screen summarising it into a word.
 *
 * ★★ On `/admin/esis-sync` rather than the operator's platform screen, for the
 * reason `ee16625` settled for the sync panel: these routes are
 * `@Roles("ADMIN")` and need a **membership**, which a platform operator does
 * not hold. A sync is a working surface; so is this.
 */
export function EsisWriteQueue(props: { kindergartenId: string }) {
  const writes = useQuery({
    queryKey: ["admin", "esis", props.kindergartenId, "group-writes", 1],
    queryFn: ({ signal }) =>
      get(
        `/kindergartens/${props.kindergartenId}/esis/group-writes?page=1&pageSize=20`,
        esisWriteRequestsPageSchema,
        signal,
      ),
  });

  if (writes.isLoading) {
    return <LoadingState rows={2} />;
  }

  if (writes.isError) {
    return (
      <Card pad="compact" tone="peach">
        <p role="alert" className="text-body text-danger">
          {errorMessage(writes.error)}
        </p>
      </Card>
    );
  }

  const items = writes.data?.items ?? [];

  if (items.length === 0) {
    return (
      <Card pad="roomy" className="flex flex-col gap-1.5">
        <p className="text-body text-ink">ЭСИС рүү илгээсэн зүйл хараахан байхгүй.</p>
        <p className="text-caption text-muted">
          Бүлгийн дэлгэц дээрх «ЭСИС-д бүртгүүлэх»-ээс эхэлнэ.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <Card key={item.id} pad="roomy" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                {item.state === "FAILED" ? (
                  <AlertCircle size={19} aria-hidden />
                ) : item.state === "SENT" ? (
                  <Send size={19} aria-hidden />
                ) : (
                  <Clock3 size={19} aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-lead font-semibold text-ink">
                  {ESIS_WRITE_SERVICE_LABEL[item.service] ?? item.service}
                </p>
                {item.group ? (
                  <p className="mt-0.5 text-body text-muted">{item.group.name}</p>
                ) : null}
              </div>
            </div>
            <Badge tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state] ?? item.state}</Badge>
          </div>

          <dl className="grid gap-3 border-t border-border-soft pt-4 sm:grid-cols-2">
            <div>
              <dt className="text-caption text-muted">Үүсгэсэн</dt>
              <dd className="mt-0.5 text-body text-ink">
                {new Date(item.createdAt).toLocaleString("mn-MN")}
              </dd>
            </div>
            {item.approvedBy ? (
              <div>
                <dt className="text-caption text-muted">Баталсан</dt>
                <dd className="mt-0.5 text-body text-ink">
                  {item.approvedBy.lastName} {item.approvedBy.firstName}
                </dd>
              </div>
            ) : null}
            {item.sentAt ? (
              <div>
                <dt className="text-caption text-muted">Илгээсэн</dt>
                <dd className="mt-0.5 text-body text-ink">
                  {new Date(item.sentAt).toLocaleString("mn-MN")}
                </dd>
              </div>
            ) : null}
          </dl>

          {item.errorCode ? (
            <p className="rounded-control bg-danger-soft px-3 py-2 text-body text-danger">
              Илгээхэд алдаа гарсан · {item.errorCode}
            </p>
          ) : null}

          {item.response ? (
            <section
              aria-label="ЭСИС-ийн хариу"
              className="flex flex-col gap-3 border-t border-border-soft pt-4"
            >
              <div>
                <h3 className="text-body font-semibold text-ink">ЭСИС-ийн хариу</h3>
                <p className="mt-0.5 text-caption text-muted">
                  Илгээгдсэн төлөв нь ESIS зөвшөөрснийг батлахгүй. Доорх хариуг шалгана уу.
                </p>
              </div>
              <EsisResponseValues response={item.response} />
              <EsisRawResponse response={item.response} />
            </section>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
