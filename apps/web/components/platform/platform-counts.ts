"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";

/**
 * How much is waiting for the operator — the dashboard's «Анхаарах» rows and
 * the red counts on the platform menu (2026-10-13). One page of one row each:
 * only `total` is read, so the list routes that exist already serve as counts.
 */
const totalSchema = z.object({ total: z.number().int().nonnegative() });

/** Applications still waiting to be approved or refused. */
export function usePendingApplicationsCount(enabled = true): number | null {
  const { data } = useQuery({
    queryKey: qk.platformPendingApplications(),
    queryFn: () => get("/platform/applications?status=PENDING&page=1&pageSize=1", totalSchema),
    staleTime: 60_000,
    retry: false,
    enabled,
  });
  return data?.total ?? null;
}

/** Solo teachers' workspaces not yet merged into a kindergarten. */
export function useSoloWorkspacesCount(enabled = true): number | null {
  const { data } = useQuery({
    queryKey: qk.platformSoloWorkspacesCount(),
    queryFn: () => get("/platform/solo-workspaces?page=1&pageSize=1", totalSchema),
    staleTime: 60_000,
    retry: false,
    enabled,
  });
  return data?.total ?? null;
}
