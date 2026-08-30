"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { chatRoomSchema } from "@kinder/contracts";
import { ChatList, ChatRoom, type ChatChrome } from "@/components/chat/chat-widget";
import { PageHeader } from "@/components/shell/app-shell";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { cn } from "@/lib/utils";

const roomsSchema = z.array(chatRoomSchema);

/**
 * A heading, not a dialog label.
 *
 * The panes take their title and dismiss control from the frame that mounts
 * them (`ChatChrome`). Inside the widget that is Radix; here there is no dialog
 * to label and nothing to dismiss, so the title is a plain `<h2>` and `Close`
 * is left off — which is what removes the stray "Хаах" button a full page
 * should never have shown.
 */
const pageChrome: ChatChrome = {
  Title: ({ className, children }) => <h2 className={className}>{children}</h2>,
};

/**
 * Чат — the full-screen view of the same rooms the floating widget shows.
 *
 * ★ Why this exists when the widget already floats everywhere.
 *
 * The sidebar deliberately had no Чат row: the argument, written in
 * `(app)/layout.tsx`, was that a link pointing at a button already on screen is
 * a second way into one feature. The client asked for the row twice — in the
 * 2026-08-30 navigation drawing and again in writing — so the row exists, and
 * it needed somewhere to go that is not the widget.
 *
 * A page earns its place by being a better frame than a 400×600 panel rather
 * than by being another door to it: at `lg` the room list and the open room sit
 * side by side, so switching rooms costs no navigation at all. Below `lg` it
 * behaves exactly as the widget does — the list, then the room, with a back
 * arrow — because a phone has no room for two columns and inventing a third
 * behaviour for the same data is how the two drift.
 *
 * ★★ It renders the panes rather than copying them. `ChatList` and `ChatRoom`
 * are the widget's own components; the unread badge, the read cursor and the
 * ten-second poll are written once and behave identically in both frames.
 */
export default function ChatPage() {
  const [roomKey, setRoomKey] = useState<string | null>(null);

  const rooms = useQuery({
    queryKey: qk.chatRooms(),
    queryFn: () => get("/chat/rooms", roomsSchema),
    staleTime: 15_000,
  });

  const active = rooms.data?.find((room) => room.key === roomKey) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col px-4 py-4 lg:py-6">
      <PageHeader title="Чат" lede="Бүлгийнхээ багш, эцэг эхтэй шууд харилцах." />

      {/*
        A fixed height rather than page flow: both panes scroll internally, and a
        column that grows with its messages would leave the composer below the
        fold on a long conversation. `100dvh` minus the chrome — `dvh` and not
        `vh` because mobile Safari's toolbar collapses, and `vh` there measures
        the tall state and pushes the composer under the browser's own bar.
      */}
      <div className="flex min-h-[420px] flex-col overflow-hidden rounded-card border border-border bg-surface lg:h-[calc(100dvh-13rem)] lg:flex-row">
        {/*
          Below `lg` exactly one pane is mounted, as in the widget. From `lg`
          both are, and the list becomes a fixed rail beside the room.
        */}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col lg:flex lg:w-[320px] lg:shrink-0 lg:border-e lg:border-border",
            active ? "hidden" : "flex flex-1",
          )}
        >
          <ChatList
            rooms={rooms.data}
            loading={rooms.isLoading}
            onOpen={setRoomKey}
            activeKey={roomKey}
            chrome={pageChrome}
          />
        </div>

        <div className={cn("min-h-0 min-w-0 flex-1 flex-col", active ? "flex" : "hidden lg:flex")}>
          {active ? (
            /*
              `key` remounts the pane when the room changes. `ChatRoom` marks a
              room read in an effect keyed on `room.key` and keeps the draft in
              local state; without this, switching rooms on desktop would carry
              a half-typed message into somebody else's conversation.
            */
            <ChatRoom
              key={active.key}
              room={active}
              onBack={() => setRoomKey(null)}
              // From `lg` the list is beside this pane, so an arrow pointing
              // back at it would appear to do nothing.
              hideBackAtLg
              chrome={pageChrome}
            />
          ) : (
            <p className="hidden place-items-center px-6 py-10 text-center text-body text-muted lg:grid">
              Зүүн талаас чатаа сонгоно уу.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
