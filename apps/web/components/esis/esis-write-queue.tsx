"use client";

import { useQuery } from "@tanstack/react-query";
import { esisWriteRequestsPageSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { Card } from "@/components/ui/card";
import { ESIS_WRITE_SERVICE_LABEL } from "./esis-group-write";

const STATE_LABEL: Record<string, string> = {
  PREPARED: "Хүлээгдэж байна",
  APPROVED: "Батлагдсан",
  SENT: "Илгээгдсэн",
  FAILED: "Уналаа",
  CANCELLED: "Болисон",
};

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
    return <Card className="text-caption text-muted">Уншиж байна…</Card>;
  }

  const items = writes.data?.items ?? [];

  if (items.length === 0) {
    return (
      <Card className="flex flex-col gap-1.5">
        <p className="text-body text-ink">ЭСИС рүү илгээсэн зүйл хараахан байхгүй.</p>
        <p className="text-caption text-muted">
          Бүлгийн дэлгэц дээрх «ЭСИС-д бүртгүүлэх»-ээс эхэлнэ.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <Card key={item.id} className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-body font-medium text-ink">
              {ESIS_WRITE_SERVICE_LABEL[item.service] ?? item.service}
            </p>
            <p className="text-caption text-muted">{STATE_LABEL[item.state] ?? item.state}</p>
          </div>

          {item.group ? <p className="text-caption text-muted">{item.group.name}</p> : null}

          {item.approvedBy ? (
            <p className="text-caption text-muted">
              Баталсан: {item.approvedBy.lastName} {item.approvedBy.firstName}
            </p>
          ) : null}

          {item.errorCode ? (
            <p className="text-caption text-danger">Алдаа: {item.errorCode}</p>
          ) : null}

          {item.response ? (
            <pre className="overflow-x-auto rounded-control bg-sunken p-2 text-caption text-ink">
              {JSON.stringify(item.response, null, 2)}
            </pre>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
