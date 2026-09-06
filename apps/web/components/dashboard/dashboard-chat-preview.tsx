"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CloudOff, MessageCircle } from "lucide-react";
import { chatRoomsSchema } from "@/components/chat/chat-widget";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { formatRelative, fullName } from "@/lib/format";
import { BoardCard, BoardCardEmpty } from "./board-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/states";

/** A real room preview; the full conversation stays on the dedicated chat page. */
export function DashboardChatPreview() {
  const rooms = useQuery({
    queryKey: qk.chatRooms(),
    queryFn: () => get("/chat/rooms", chatRoomsSchema),
    staleTime: 15_000,
    retry: false,
  });

  if (rooms.isLoading) {
    return (
      <Card pad="roomy" className="flex h-full flex-col gap-4">
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </Card>
    );
  }

  return (
    <BoardCard
      title="Сургуулийн чат"
      footer={
        <Link
          href="/chat"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-body font-medium text-primary hover:text-primary-strong"
        >
          Бүх чатыг харах
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      }
    >
      {rooms.isError ? (
        <BoardCardEmpty
          icon={<CloudOff size={22} />}
          title="Чат ачаалж чадсангүй"
          hint="Чатын хуудаснаас дахин оролдоно уу."
        />
      ) : !rooms.data?.length ? (
        <BoardCardEmpty
          icon={<MessageCircle size={22} />}
          title="Нээлттэй чат алга"
          hint="Бүлгийн чат үүсэхэд энд харагдана."
        />
      ) : (
        <ul className="divide-y divide-border-soft">
          {rooms.data.slice(0, 3).map((room) => {
            const author = room.lastMessage?.author ? fullName(room.lastMessage.author) : room.name;

            return (
              <li key={room.key}>
                <Link href="/chat" className="flex min-h-[68px] items-center gap-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-pill bg-primary-soft text-body font-bold text-primary"
                  >
                    {room.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-body font-semibold text-ink">{author}</span>
                      {room.lastMessage ? (
                        <span className="shrink-0 text-caption text-muted">
                          {formatRelative(room.lastMessage.createdAt)}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-caption text-muted">
                      {room.lastMessage?.body ?? `${room.name} · ${room.memberCount} гишүүн`}
                    </span>
                  </span>
                  {room.unreadCount > 0 ? (
                    <span className="flex min-w-5 shrink-0 items-center justify-center rounded-pill bg-danger px-1 text-caption font-bold leading-5 text-white">
                      {room.unreadCount > 99 ? "99+" : room.unreadCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </BoardCard>
  );
}
