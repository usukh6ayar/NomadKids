"use client";

import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { groupSchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";

const groupsSchema = paginated(groupSchema);

/** Inferred here rather than exported from contracts — one consumer, one file. */
type Group = z.infer<typeof groupSchema>;

/**
 * The group this dashboard is about.
 *
 * ★ A teacher here is responsible for one group, so the dashboard never asks
 * which — it resolves the group and speaks about it directly. There is no
 * switcher, and adding one would be inventing a choice the product does not
 * offer.
 *
 * ★★ The key is `qk.groups({ pageSize: 20 })` — byte-identical to the one
 * `GroupsSection` already registers, deliberately. Three consumers on this
 * screen need the group (the header, the attendance card, the actions list)
 * and a key that differed by so much as a filter object would turn one request
 * into three. Sharing it means the second and third are cache hits.
 *
 * ★★★ It still reads `items[0]` rather than assuming a length.
 *
 * `TeacherAssignment` permits a teacher covering a second group, and an admin
 * sees every group in the kindergarten. Neither is the case this screen is
 * designed for, but both are cases it must not render nonsense for — so the
 * first group is what the dashboard describes, and `count` lets a caller say
 * so out loud instead of silently picking one of several.
 */
export function useMyGroup({
  /**
   * ★ Off for anyone who is not staff.
   *
   * `GET /groups` is staff-only, so a parent calling it gets a refusal — and
   * once the sidebar started reading this hook, "the dashboard fetches it"
   * stopped being true of every caller. The gate lives on the query rather
   * than at the call site because hooks cannot be called conditionally.
   */
  enabled = true,
}: { enabled?: boolean } = {}): {
  group: Group | null;
  count: number;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.groups({ pageSize: 20 }),
    queryFn: () => get("/groups?page=1&pageSize=20", groupsSchema),
    enabled,
    /*
     * The shell renders on every navigation, so without this the group would
     * be refetched on each one. A group's name does not change during a
     * session; five minutes is generous and still bounded.
     */
    staleTime: 5 * 60_000,
  });

  return {
    group: data?.items[0] ?? null,
    count: data?.items.length ?? 0,
    isLoading,
    isError,
  };
}
