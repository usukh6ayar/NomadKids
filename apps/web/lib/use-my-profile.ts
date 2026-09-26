"use client";

import { useQuery } from "@tanstack/react-query";
import { userProfileSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";

/**
 * The signed-in person's own profile — where their photograph lives.
 *
 * ★ The session (`/auth/me`) carries no photo, so every place that draws the
 * reader's own face reads this instead. Same key as the settings screen, which
 * invalidates it on upload, so a new photograph shows everywhere at once.
 */
export function useMyProfile() {
  const { session } = useSession();
  return useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", userProfileSchema),
    enabled: Boolean(session?.user),
    retry: false,
  });
}
