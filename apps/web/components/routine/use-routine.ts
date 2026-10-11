"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useToast } from "@/components/ui/toast";
import {
  ROUTINE_NOT_READY,
  clubSchema,
  demoRoutine,
  routineSchema,
  type Routine,
} from "@/lib/routine";
import type { RoutineActions } from "./routine-view";

/**
 * A routine from `path` (`/groups/:id/routine` or `/children/:id/routine`),
 * or — while that answers 404 — the template, edited here and nowhere else.
 * The actions write to the API, or to that local copy in sample mode.
 */
export function useRoutine(
  path: string,
  group: { id: string; name: string },
  base: { group: string } | { child: string },
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ["routine", path] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => get(path, routineSchema),
    retry: false,
  });
  const demo = query.isError && isNotFound(query.error);
  const [local, setLocal] = useState<Routine | null>(null);
  const routine: Routine | undefined = demo ? (local ?? demoRoutine(group)) : query.data;

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const fail = (error: unknown): never => {
    toast.error(isNotFound(error) ? ROUTINE_NOT_READY : errorMessage(error));
    throw error;
  };
  const edit = (change: (current: Routine) => Routine) =>
    setLocal((current) => change(current ?? demoRoutine(group)));

  const groupPath = "group" in base ? `/groups/${base.group}` : null;
  const childPath = "child" in base ? `/children/${base.child}` : null;

  const actions: RoutineActions = groupPath
    ? {
        saveItems: async (items) => {
          if (demo) return edit((r) => ({ ...r, items }));
          await mutate(`${groupPath}/routine/items`, z.unknown(), {
            method: "PUT",
            body: { items },
          }).catch(fail);
          await refresh();
        },
        savePlan: async (plan) => {
          if (demo) return edit((r) => ({ ...r, plan }));
          await mutate(`${groupPath}/routine/plan`, z.unknown(), {
            method: "PUT",
            body: { plan },
          }).catch(fail);
          await refresh();
        },
        saveClub: async (input, id) => {
          if (demo)
            return edit((r) => ({
              ...r,
              clubs: id
                ? r.clubs.map((c) => (c.id === id ? { ...input, id } : c))
                : [...r.clubs, { ...input, id: `demo-${Date.now()}` }],
            }));
          await mutate(id ? `${groupPath}/clubs/${id}` : `${groupPath}/clubs`, clubSchema, {
            method: id ? "PUT" : "POST",
            body: input,
          }).catch(fail);
          await refresh();
        },
        deleteClub: async (id) => {
          if (demo)
            return edit((r) => ({
              ...r,
              clubs: r.clubs.filter((c) => c.id !== id),
              requests: r.requests.filter((q) => q.clubId !== id),
            }));
          await mutate(`${groupPath}/clubs/${id}`, z.unknown(), { method: "DELETE" }).catch(fail);
          await refresh();
        },
        decide: async (requestId, approve) => {
          if (demo)
            return edit((r) => ({
              ...r,
              requests: r.requests.map((q) =>
                q.id === requestId ? { ...q, status: approve ? "APPROVED" : "REJECTED" } : q,
              ),
            }));
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
          if (demo)
            return edit((r) => ({
              ...r,
              requests: [
                ...r.requests,
                {
                  id: `demo-${Date.now()}`,
                  clubId,
                  childId: (base as { child: string }).child,
                  childName: "",
                  status: "PENDING",
                  createdAt: new Date().toISOString(),
                },
              ],
            }));
          await mutate(`${childPath}/club-requests`, z.unknown(), {
            method: "POST",
            body: { clubId },
          }).catch(fail);
          await refresh();
        },
      };

  return {
    routine,
    demo,
    isLoading: query.isLoading,
    error: query.isError && !demo ? query.error : null,
    actions,
  };
}
