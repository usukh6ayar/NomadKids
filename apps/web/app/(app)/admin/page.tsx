"use client";

import { RequireRole } from "@/components/shell/require-role";
import { AdminOverview } from "@/components/admin/admin-overview";

/**
 * The administrator's landing screen.
 *
 * ★ It was a hub, and is a dashboard — 2026-09-04.
 *
 * This page used to be six tiles linking to the administration screens, plus a
 * row of counts. Two changes took the tiles away from underneath it. On
 * 2026-08-31 every screen behind them was given its own sidebar row, so the
 * grid became a list of what the menu two inches to its left already named. And
 * `AdminOverview` — reachable then only through a branch inside `/dashboard`
 * that the login redirect never reached — was already drawing the same counts
 * from the same endpoint, with the attendance, coverage and domain panels
 * beside them that this page had no version of.
 *
 * So the tiles went and the dashboard moved here, onto the URL that
 * `primaryDashboard()` has been sending administrators to all along. One
 * administrator dashboard, at the address they already arrive at.
 *
 * ★★ `/admin/groups` was the one tile with nowhere else to go.
 *
 * The other five had rows; that one did not, and deleting the grid without
 * noticing would have left it reachable only from the assessment tab's
 * group-picker fallback. It is a sidebar row now — see `app/(app)/layout.tsx`.
 *
 * ★★★ The page owns neither the query nor the title.
 *
 * `AdminOverview` fetches `/dashboard/admin` and renders its own loading, error
 * and loaded branches, and the `PageHeader` goes with it because the lede is
 * the active term — a fact that only exists once the query has answered. Three
 * branches, one header helper, which is the arrangement `page-header.test.tsx`
 * exists to protect: a title hand-rolled per branch is a different size from
 * `PageHeader`'s and changes in place the moment the query resolves.
 *
 * So this file is a guard and a band. That is not nothing — `RequireRole` is
 * what sends a teacher who typed the URL back to their own screen — but it is
 * all of it.
 */
export default function AdminPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <div className="page-band py-2">
        <AdminOverview />
      </div>
    </RequireRole>
  );
}
