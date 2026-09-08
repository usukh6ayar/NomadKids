"use client";

import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { AttendanceRequestQueue } from "@/components/attendance/request-queue";

/**
 * The review queue on its own page.
 *
 * ★ Kept, although the sidebar no longer points at it.
 *
 * The queue is rendered on the attendance register now, which is where the
 * work belongs — but this route is what a notification links to, what a
 * bookmark points at, and where a teacher who has been sent "хүсэлт ирлээ"
 * lands. Removing a URL to shorten a menu breaks every one of those.
 */
export default function AttendanceRequestReviewPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <div className="flex flex-col gap-6 lg:gap-8">
        <PageHeader
          title="Ирцийн мэдэгдэл — хянах"
        />
        <AttendanceRequestQueue />
      </div>
    </RequireRole>
  );
}
