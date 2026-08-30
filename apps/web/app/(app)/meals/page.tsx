"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { useSwitchableGroups } from "@/components/shell/group-switcher";
import { errorMessage } from "@/lib/api/errors";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

/**
 * Хоолны бүртгэл — the entry the sidebar points at, which resolves a group and gets
 * out of the way.
 *
 * ★ It used to be a "which group?" page and is now a doorway.
 *
 * This register is recorded per group, so something has to answer that
 * question — but a list of groups was the wrong shape for the answer. A teacher
 * with one group met a page with one row every morning; a director had to come
 * back to it to look at a second group, losing the date they had set. The
 * groups are chips along the top of the register itself now
 * (`GroupSwitcher`), so this route picks the first and forwards.
 *
 * ★★ `replace`, never `push`.
 *
 * Otherwise the back button lands here, which immediately forwards again — a
 * page a reader cannot get out of by going back.
 */
export default function MealsPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <MealsLanding />
    </RequireRole>
  );
}

function MealsLanding() {
  const router = useRouter();
  const groups = useSwitchableGroups();
  const first = groups.data?.items[0];

  useEffect(() => {
    if (first) router.replace(`/groups/${first.id}/meals`);
  }, [first, router]);

  if (groups.isError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Хоолны бүртгэл" />
        <ErrorState description={errorMessage(groups.error)} />
      </div>
    );
  }

  if (groups.data && groups.data.items.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Хоолны бүртгэл" />
        <EmptyState
          title="Бүлэг байхгүй байна"
          description="Хоол бүртгэхийн өмнө бүлэг үүсгэх шаардлагатай."
        />
      </div>
    );
  }

  // Loading, or forwarding. Both look the same to a reader and should.
  return <LoadingState rows={5} label="Ачаалж байна…" />;
}
