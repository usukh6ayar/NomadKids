"use client";

import { CalendarCheck } from "lucide-react";
import { formatLongDate } from "@/lib/format";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { GroupPicker } from "@/components/shell/group-picker";

/**
 * Today's register — the top-level entry the client's navigation drawing asks
 * for, and the reason `GroupPicker` exists. Its docblock carries the argument.
 */
export default function AttendancePage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <div className="flex flex-col gap-6 lg:gap-8">
        <PageHeader title="Ирц" lede={`${formatLongDate(new Date())} — бүлэг сонгоно уу.`} />

        <GroupPicker
          icon={<CalendarCheck size={20} aria-hidden />}
          href={(groupId) => `/groups/${groupId}/attendance`}
          emptyDescription="Ирц бүртгэхийн өмнө бүлэг үүсгэх шаардлагатай."
        />
      </div>
    </RequireRole>
  );
}
