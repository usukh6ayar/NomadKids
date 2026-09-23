"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useEsisRows } from "@/components/esis/use-esis-rows";

/**
 * Does the ministry's register of this class agree with ours?
 *
 * ★ **This compares; it does not import.** `group/student/list` (api-13)
 * answers "who does ESIS say is in this group", keyed by `Group.esisGroupId`.
 * The roster importer reads `students/list` (api-8) instead — one call for the
 * whole institution, placing each child by the `studentGroupId` on their own
 * row — and it stays that way on evidence rather than by preference: probed
 * live against institution 42778 on 2026-09-23
 * (`scripts/esis-group-roster-probe.ts`), the two services agreed **exactly**
 * on all four groups, 32 · 18 · 21 · 22 for 93 children, with no child in
 * either list and not the other.
 *
 * So api-13 is not a second import path — it would create no row api-8 does
 * not already create, and a second writer into `Enrollment` is a second place
 * for a child to be moved between classes. What it is good for is the check a
 * director actually wants: *has anything drifted since the last import*. That
 * is one number against another, and it is what this draws.
 *
 * ★★ Read on demand, from the roster tab. It is an outbound request to the
 * ministry and an `AuditLog` VIEW row for each group opened.
 *
 * ★★★ A mismatch is reported, never corrected here. The fix is the import
 * button on `/admin/groups`, which is the one path that writes `Enrollment`
 * and the one place the rules about moving a child between groups live.
 */
export function GroupRosterCheck({
  esisGroupId,
  localCount,
}: {
  esisGroupId: string | null | undefined;
  localCount: number;
}) {
  const esis = useEsisRows("groupStudents", {
    params: { studentGroupId: esisGroupId },
  });

  /*
   * A class the ministry has never been told about — created by hand, or not
   * yet imported. Saying "0 vs 21" there would read as a mismatch; there is
   * simply nothing to compare against.
   */
  if (!esisGroupId) {
    return <p className="text-caption text-muted">Энэ бүлэг ЭСИС-д бүртгэгдээгүй байна.</p>;
  }

  if (esis.isUnavailable) return null;
  if (esis.isPending) {
    return <p className="text-caption text-muted">ЭСИС-ийн бүртгэлтэй тулгаж байна…</p>;
  }
  if (esis.isError) {
    return <p className="text-caption text-sun-ink">ЭСИС-ээс мэдээлэл шинэчлэхэд алдаа гарлаа.</p>;
  }

  const esisCount = esis.rows.length;
  const agrees = esisCount === localCount;

  return (
    <p
      className={`flex items-center gap-1.5 text-caption ${agrees ? "text-muted" : "text-sun-ink"}`}
    >
      {agrees ? (
        <Check size={14} aria-hidden="true" className="shrink-0 text-mint-ink" />
      ) : (
        <TriangleAlert size={14} aria-hidden="true" className="shrink-0" />
      )}
      {agrees ? (
        <>ЭСИС-ийн бүртгэлтэй тохирч байна ({esisCount} суралцагч).</>
      ) : (
        <>
          ЭСИС-д {esisCount}, энд {localCount} суралцагч бүртгэлтэй. «Бүлгүүд» хэсгээс ЭСИС-ээс
          дахин татна уу.
        </>
      )}
    </p>
  );
}
