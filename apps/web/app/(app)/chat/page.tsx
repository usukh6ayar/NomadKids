"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Plus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { chatRoomSchema } from "@kinder/contracts";
import { ChatList, ChatRoom, type ChatChrome } from "@/components/chat/chat-widget";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
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
  const [pickerOpen, setPickerOpen] = useState(false);

  const rooms = useQuery({
    queryKey: qk.chatRooms(),
    queryFn: () => get("/chat/rooms", roomsSchema),
    staleTime: 15_000,
  });

  const active = rooms.data?.find((room) => room.key === roomKey) ?? null;

  useEffect(() => {
    const firstRoom = rooms.data?.[0];
    if (!firstRoom || roomKey) return;

    const desktop = window.matchMedia("(min-width: 1024px)");
    const openFirstRoom = () => {
      if (desktop.matches) setRoomKey(firstRoom.key);
    };
    openFirstRoom();
    desktop.addEventListener("change", openFirstRoom);
    return () => desktop.removeEventListener("change", openFirstRoom);
  }, [roomKey, rooms.data]);

  return (
    <div className="h-full w-full">
      <h1 className="sr-only">Чат</h1>

      {/* The shell gives this route the remaining viewport height. Both panes
          scroll internally so a long conversation never pushes the composer
          below the fold. */}
      <div className="flex h-full min-h-0 flex-col lg:flex-row lg:gap-4">
        {/*
          Below `lg` exactly one pane is mounted, as in the widget. From `lg`
          both are, and the list becomes a fixed rail beside the room.
        */}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface shadow-sm lg:flex lg:w-[360px] lg:shrink-0 xl:w-[380px]",
            active ? "hidden" : "flex flex-1",
          )}
        >
          <ChatList
            rooms={rooms.data}
            loading={rooms.isLoading}
            error={rooms.isError}
            onRetry={() => void rooms.refetch()}
            onOpen={setRoomKey}
            activeKey={roomKey}
            action={
              <Button
                size="sm"
                onClick={() => setPickerOpen(true)}
                disabled={rooms.isLoading || !rooms.data?.length}
                className="min-w-[184px]"
              >
                <Plus size={19} aria-hidden="true" />
                Шинэ чат
              </Button>
            }
            searchPlaceholder="Яриа хайх..."
            chrome={pageChrome}
          />
        </div>

        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-surface shadow-sm",
            active ? "flex" : "hidden lg:flex",
          )}
        >
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
            <div className="hidden min-h-full place-items-center px-6 py-10 text-center lg:grid">
              <div>
                <span className="mx-auto mb-5 grid size-16 place-items-center rounded-card bg-primary-soft text-primary">
                  <MessageCircle size={32} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <p className="text-title font-bold text-ink">Чатаа сонгоно уу</p>
                <p className="mt-2 max-w-sm text-body text-muted">
                  Зүүн талын жагсаалтаас бүлэг эсвэл ажилтны чатыг нээнэ үү.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <FormDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Шинэ чат нээх"
        description="Таны харьяалагдах бүлэг болон ажилтны чатуудаас сонгоно уу."
      >
        <div className="overflow-hidden rounded-card border border-border">
          {rooms.data?.map((room) => (
            <button
              key={room.key}
              type="button"
              onClick={() => {
                setRoomKey(room.key);
                setPickerOpen(false);
              }}
              className="flex min-h-[68px] w-full items-center gap-3 border-b border-border-soft px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-canvas"
            >
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-pill bg-primary-soft font-bold text-primary"
              >
                {room.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-ink">{room.name}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-caption text-muted">
                  <Users size={14} aria-hidden="true" />
                  {room.memberCount} гишүүн
                </span>
              </span>
            </button>
          ))}
        </div>
      </FormDialog>
    </div>
  );
}
