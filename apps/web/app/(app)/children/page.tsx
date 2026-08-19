"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Search } from "lucide-react";
import { useState } from "react";
import { childSummarySchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { useDebounced } from "@/lib/use-debounced";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { formatAge, fullName } from "@/lib/format";
import { z } from "zod";

const listSchema = paginated(childSummarySchema);
const ownSchema = z.array(childSummarySchema);

/**
 * Find a child.
 *
 * Two audiences, one route — see `(app)/layout.tsx` for why the route tree is
 * shared. A teacher gets a searchable, paginated list of everyone in their
 * groups; a parent gets their own children, which is one or two rows and needs
 * neither search nor pagination.
 *
 * The split is by role because the *endpoints* differ (`/children` versus
 * `/children/mine`), not because the UI hides anything: `/children` already
 * returns only what the caller may see.
 */
export default function ChildrenPage() {
  const { hasRole } = useSession();
  const isStaff = hasRole("TEACHER") || hasRole("ADMIN");

  return isStaff ? <StaffChildren /> : <MyChildren />;
}

// ── Staff ────────────────────────────────────────────────────────────────────

function StaffChildren() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(query.trim());

  const filters = { q: search || undefined, page, pageSize: 25 };

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useQuery({
    queryKey: qk.children(filters),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (search) params.set("q", search);
      return get(`/children?${params}`, listSchema);
    },
    // Keeps the previous page visible while the next loads, so the list does
    // not collapse to a skeleton and jump the scroll position on every search
    // keystroke.
    placeholderData: (previous) => previous,
  });

  return (
    <div className="flex flex-col gap-5 py-2">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Хүүхдүүд</h1>
        {data ? (
          <p className="text-sm text-muted" aria-live="polite">
            Нийт {data.total}
          </p>
        ) : null}
      </header>

      <div className="relative">
        <Search
          size={18}
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <Input
          type="search"
          // A visible label would be redundant beside a magnifier and a
          // placeholder this explicit, but a screen reader still needs one.
          aria-label="Хүүхдийн нэрээр хайх"
          placeholder="Нэр эсвэл овгоор хайх"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // A new search starts at page 1 — otherwise a search from page 3
            // shows an empty result that looks like "no matches".
            setPage(1);
          }}
          className="pl-11"
        />
      </div>

      {isLoading ? <LoadingState rows={5} /> : null}

      {isError ? (
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          title={search ? "Хайлтад тохирох хүүхэд олдсонгүй" : "Хүүхэд бүртгэгдээгүй байна"}
          description={
            search
              ? "Өөр нэрээр хайж үзнэ үү."
              : "Таны хариуцаж буй бүлэгт хүүхэд бүртгэгдээгүй байна."
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <Card
            className={`divide-y divide-border ${isPlaceholderData ? "opacity-60" : ""}`}
            aria-busy={isPlaceholderData}
          >
            {data.items.map((child) => (
              <ChildRow key={child.id} child={child} />
            ))}
          </Card>

          {data.totalPages > 1 ? (
            <nav aria-label="Хуудаслалт" className="flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Өмнөх
              </Button>
              <span className="text-sm text-muted" aria-live="polite">
                {data.page} / {data.totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Дараах
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * One child.
 *
 * The same markup at every width — a compact row that already reads well on a
 * phone. A separate mobile card component would be two things to keep in step
 * for no visual gain, so the group and age simply wrap under the name below
 * `sm`.
 */
function ChildRow({
  child,
}: {
  child: {
    id: string;
    lastName: string;
    firstName: string;
    dateOfBirth: string;
    photoMediaFileId?: string | null;
    enrollments?: { group?: { name: string } | null }[];
  };
}) {
  const group = child.enrollments?.[0]?.group?.name;

  return (
    <Link
      href={`/children/${child.id}`}
      className="flex min-h-[64px] items-center gap-3 px-4 py-3 hover:bg-canvas"
    >
      <ChildAvatar child={child} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{fullName(child)}</span>
        <span className="block truncate text-sm text-muted">
          {[group, formatAge(child.dateOfBirth)].filter(Boolean).join(" · ")}
        </span>
      </span>
    </Link>
  );
}

// ── Parent ───────────────────────────────────────────────────────────────────

function MyChildren() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.myChildren(),
    queryFn: () => get("/children/mine", ownSchema),
  });

  return (
    <div className="flex flex-col gap-5 py-2">
      <h1 className="text-xl font-semibold text-ink">Хөгжлийн хавтас</h1>

      {isLoading ? <LoadingState rows={2} /> : null}

      {isError ? (
        <ErrorState
          description={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Дахин оролдох
            </Button>
          }
        />
      ) : null}

      {data && data.length === 0 ? (
        <EmptyState
          title="Хүүхэд холбогдоогүй байна"
          description="Танд холбогдсон хүүхэд байхгүй байна. Цэцэрлэгийн багштайгаа холбогдоно уу."
        />
      ) : null}

      {data && data.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((child) => (
            <Link key={child.id} href={`/children/${child.id}`} className="block">
              <Card className="flex min-h-[88px] items-center gap-4 px-4 py-4 hover:bg-canvas">
                <ChildAvatar child={child} size={56} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{fullName(child)}</span>
                  <span className="block text-sm text-muted">{formatAge(child.dateOfBirth)}</span>
                </span>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
