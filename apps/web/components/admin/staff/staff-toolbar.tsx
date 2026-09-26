"use client";

import { Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import {
  STAFF_KIND_LABEL,
  STAFF_STATUS_LABEL,
  type StaffFilters,
  type StaffKind,
  type StaffStatus,
} from "./staff-model";
import { groupLabel } from "@/lib/format";

/**
 * Search, three filters, and the screen's one primary action.
 *
 * ★ Filtered in the browser. The directory is already whole — a staff list is
 * a few dozen people and the screen asks for two hundred — so a round trip per
 * keystroke would be slower and would make the rows flicker between answers.
 * The same call the group roster makes, for the same reason, and it changes
 * the day a kindergarten is large enough for the page size to be wrong.
 */
export function StaffToolbar({
  filters,
  onChange,
  groups,
  action,
}: {
  filters: StaffFilters;
  onChange: (next: StaffFilters) => void;
  /** The kindergarten's groups, for the Бүлэг select. */
  groups: { id: string; name: string }[];
  action?: React.ReactNode;
}) {
  const set = <K extends keyof StaffFilters>(key: K, value: StaffFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <SearchField
        label="Нэр, овгоор хайх"
        placeholder="Нэрээр хайх…"
        value={filters.query}
        onChange={(value) => set("query", value)}
        className="sm:max-w-[320px]"
      />

      <Select
        aria-label="Төрлөөр шүүх"
        value={filters.kind}
        onChange={(event) => set("kind", event.target.value as StaffKind | "")}
        className="w-full sm:w-[150px]"
      >
        <option value="">Бүх төрөл</option>
        <option value="TEACHER">{STAFF_KIND_LABEL.TEACHER}</option>
        <option value="OTHER">{STAFF_KIND_LABEL.OTHER}</option>
      </Select>

      <Select
        aria-label="Бүлгээр шүүх"
        value={filters.groupId}
        onChange={(event) => set("groupId", event.target.value)}
        className="w-full sm:w-[170px]"
      >
        <option value="">Бүх бүлэг</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {groupLabel(group.name)}
          </option>
        ))}
        {/* The one option that is not a group — the teachers assigned to none. */}
        <option value="NONE">Бүлэггүй</option>
      </Select>

      <Select
        aria-label="Төлөвөөр шүүх"
        value={filters.status}
        onChange={(event) => set("status", event.target.value as StaffStatus | "")}
        className="w-full sm:w-[150px]"
      >
        <option value="">Бүх төлөв</option>
        <option value="ACTIVE">{STAFF_STATUS_LABEL.ACTIVE}</option>
        <option value="ATTENTION">{STAFF_STATUS_LABEL.ATTENTION}</option>
        <option value="CLOSED">{STAFF_STATUS_LABEL.CLOSED}</option>
      </Select>

      {action ? <div className="ms-auto">{action}</div> : null}
    </div>
  );
}
