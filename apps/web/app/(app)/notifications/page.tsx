"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { notificationSchema, paginated } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { excerpt, formatRelative, fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const listSchema = paginated(notificationSchema);

/**
 * Announcements.
 *
 * Read state comes from `reads` — the API returns only *this* user's receipt,
 * so "have I read it" is answerable without exposing who else has, which for a
 * kindergarten announcement would be a small but real disclosure about other
 * families.
 *
 * There is no realtime channel in the MVP. The unread badge and this list
 * refresh on window focus, which for announcements that arrive a few times a
 * week is indistinguishable from a push (docs/ARCHITECTURE.md §7).
 */
export default function NotificationsPage() {
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const filters = { unread: showUnreadOnly };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.notifications(filters),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "25" });
      if (showUnreadOnly) params.set("unread", "true");
      return get(`/notifications?${params}`, listSchema);
    },
  });

  return (
    <div className="flex flex-col gap-5 py-2">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Мэдэгдэл</h1>

        {/*
          A two-state toggle rendered as buttons with `aria-pressed`, so the
          current filter is announced rather than being visible only as a
          background colour.
        */}
        <div className="flex gap-1 rounded-[12px] border border-border bg-surface p-1">
          <FilterButton active={!showUnreadOnly} onClick={() => setShowUnreadOnly(false)}>
            Бүгд
          </FilterButton>
          <FilterButton active={showUnreadOnly} onClick={() => setShowUnreadOnly(true)}>
            Уншаагүй
          </FilterButton>
        </div>
      </header>

      {isLoading ? <LoadingState rows={4} /> : null}

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
          title={showUnreadOnly ? "Уншаагүй мэдэгдэл алга" : "Мэдэгдэл алга"}
          description={
            showUnreadOnly
              ? "Бүх мэдэгдлийг уншсан байна."
              : "Цэцэрлэгээс мэдэгдэл ирэхэд энд харагдана."
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <Card className="divide-y divide-border">
          {data.items.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} />
          ))}
        </Card>
      ) : null}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-[40px] rounded-[10px] px-3 text-sm font-medium",
        active ? "bg-primary-soft text-primary" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function NotificationRow({ notification }: { notification: z.infer<typeof notificationSchema> }) {
  const queryClient = useQueryClient();
  const isUnread = notification.reads.length === 0;

  const markRead = useMutation({
    mutationFn: () =>
      mutate(`/notifications/${notification.id}/read`, z.unknown(), { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  return (
    <Link
      href={`/notifications/${notification.id}`}
      // Marking read on open is the behaviour every user expects; doing it only
      // via an explicit button leaves the badge stuck at a number they have
      // already dealt with.
      onClick={() => {
        if (isUnread) markRead.mutate();
      }}
      className="flex min-h-[72px] items-start gap-3 px-4 py-3 hover:bg-canvas"
    >
      {/*
        Unread is signalled three ways — a dot, a bolder title, and an sr-only
        word — because a dot alone is invisible to a screen reader and weight
        alone is easy to miss.
      */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-2 size-2 shrink-0 rounded-full",
          isUnread ? "bg-primary" : "bg-transparent",
        )}
      />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("text-ink", isUnread ? "font-semibold" : "font-medium")}>
            {notification.title}
          </span>
          {isUnread ? <span className="sr-only">Уншаагүй</span> : null}
          {notification.isImportant ? <Badge tone="peach">Чухал</Badge> : null}
        </span>

        <span className="mt-0.5 block text-sm text-muted">{excerpt(notification.body, 110)}</span>

        <span className="mt-1 block text-xs text-muted">
          {[
            fullName(notification.author),
            formatRelative(notification.publishedAt ?? notification.createdAt),
          ]
            .filter((v) => v !== "—")
            .join(" · ")}
        </span>
      </span>
    </Link>
  );
}
