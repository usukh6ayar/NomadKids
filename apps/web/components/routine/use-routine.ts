"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { useToast } from "@/components/ui/toast";
import { clubSchema, routineSchema } from "@/lib/routine";
import type { RoutineActions } from "./routine-view";

/**
 * A routine from `path` (`/groups/:id/routine` or `/children/:id/routine`),
 * and the actions that write it.
 *
 * ★ No sample routine on a 404 any more (2026-10-11). The API answers these
 * routes, so a 404 now means "not yours to see" (CLAUDE.md §1.7) — showing a
 * template in its place would tell a stranger there is something here, and
 * show them a routine as if it were the group's. The error goes to the page.
 */
export function useRoutine(path: string, base: { group: string } | { child: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ["routine", path] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => get(path, routineSchema),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const fail = (error: unknown): never => {
    toast.error(errorMessage(error));
    throw error;
  };

  const groupPath = "group" in base ? `/groups/${base.group}` : null;
  const childPath = "child" in base ? `/children/${base.child}` : null;

  const actions: RoutineActions = groupPath
    ? {
        saveItems: async (items) => {
          await mutate(`${groupPath}/routine/items`, z.unknown(), {
            method: "PUT",
            body: { items },
          }).catch(fail);
          await refresh();
        },
        savePlan: async (plan) => {
          await mutate(`${groupPath}/routine/plan`, z.unknown(), {
            method: "PUT",
            body: { plan },
          }).catch(fail);
          await refresh();
        },
        saveClub: async (input, id) => {
          await mutate(id ? `${groupPath}/clubs/${id}` : `${groupPath}/clubs`, clubSchema, {
            method: id ? "PUT" : "POST",
            body: input,
          }).catch(fail);
          await refresh();
        },
        deleteClub: async (id) => {
          await mutate(`${groupPath}/clubs/${id}`, z.unknown(), { method: "DELETE" }).catch(fail);
          await refresh();
        },
        decide: async (requestId, approve) => {
          await mutate(
            `${groupPath}/club-requests/${requestId}/${approve ? "approve" : "reject"}`,
            z.unknown(),
            { method: "POST" },
          ).catch(fail);
          await refresh();
        },
      }
    : {
        requestClub: async (clubId) => {
          await mutate(`${childPath}/club-requests`, z.unknown(), {
            method: "POST",
            body: { clubId },
          }).catch(fail);
          await refresh();
        },
      };

  return {
    routine: query.data,
    isLoading: query.isLoading,
    error: query.isError ? query.error : null,
    actions,
  };
}
