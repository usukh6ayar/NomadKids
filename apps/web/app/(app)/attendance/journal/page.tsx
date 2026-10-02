import { redirect } from "next/navigation";

/**
 * «Ирцийн дэлгэрэнгүй» was removed on 2026-10-01, at the client's request: its
 * child-by-day grid is «Ирц»'s «Сараар» and «Жилээр», and «Суралцагчаар» its
 * per-child totals. The route stays so bookmarks and old links still land —
 * on «Суралцагчаар», carrying the period and the group across.
 */
export default async function AttendanceJournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams({ view: "child" });
  for (const key of ["from", "groupId"]) {
    const value = params[key];
    if (typeof value === "string" && value) next.set(key, value);
  }
  redirect(`/attendance/daily?${next}`);
}
