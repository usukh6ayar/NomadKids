"use client";

import { UtensilsCrossed } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { GroupPicker } from "@/components/shell/group-picker";

/**
 * The weekly menu and the meal register, by group.
 *
 * ★ CLAUDE.md §7 lists the allergy cross-check as delivered, and until the
 * dashboard's `TodayMenu` was restored it had no surface at all. That widget
 * shows one day for one group; this is where a week is planned.
 */
export default function MealsPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <div className="flex flex-col gap-6 lg:gap-8">
        <PageHeader
          title="Хоол ба цэс"
          lede="Долоо хоногийн цэс, хоолны бүртгэл. Бүлэг сонгоно уу."
        />

        <GroupPicker
          icon={<UtensilsCrossed size={20} aria-hidden />}
          href={(groupId) => `/groups/${groupId}/meals`}
          emptyDescription="Цэс оруулахын өмнө бүлэг үүсгэх шаардлагатай."
        />
      </div>
    </RequireRole>
  );
}
