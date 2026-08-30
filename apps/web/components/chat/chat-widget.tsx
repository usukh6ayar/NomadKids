"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { chatMessageSchema, chatRoomSchema, unreadCountSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/states";
import { fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

const roomsSchema = z.array(chatRoomSchema);
const historySchema = z.object({
  items: z.array(chatMessageSchema),
  nextCursor: z.string().nullable(),
});

export const chatRoomsSchema = roomsSchema;

/**
 * How the surrounding frame renders a pane's title and its dismiss control.
 *
 * ★ The panes below are shared by the floating widget and `/chat`, and this is
 * the only thing that differs between them.
 *
 * Inside the widget the title must be `Dialog.Title` — Radix requires one for
 * the dialog to be labelled, and a plain `<h2>` there is an accessibility
 * failure rather than a style choice. On the page there is no dialog to label
 * and nothing to dismiss, so the title is an ordinary heading and `Close` is
 * omitted entirely. Passing the components in keeps one implementation of the
 * room list and the room, which is the whole point: two copies is how the
 * unread badge ends up correct in one of them.
 */
export interface ChatChrome {
  Title: React.ComponentType<{ className?: string; children: ReactNode }>;
  Close?: React.ComponentType<{
    "aria-label": string;
    className?: string;
    children: ReactNode;
  }>;
}

/** The widget's chrome: Radix owns both controls. */
const dialogChrome: ChatChrome = { Title: Dialog.Title, Close: Dialog.Close };

/**
 * The floating chat launcher and its panel.
 *
 * ★ **There is no AI here.** No assistant, no generated reply, no model call —
 * the client said so three times and CLAUDE.md §7 records it. This is a message
 * board between people who already share a group.
 *
 * ★★ One component owns "which view am I in", and the two frames differ only in
 * how they are mounted.
 *
 * A desktop reader gets a 400×600 panel anchored above the button; a phone gets
 * the whole screen, because a 400px popup inside a 390px viewport is a worse
 * version of a full-screen sheet. Both are the same Radix `Dialog` with
 * different classes rather than two component trees — two trees is how the list
 * and the room drift apart on one of them.
 *
 * ★★★ It renders nothing for someone with no rooms. A platform operator holds
 * no kindergarten membership (§1.1) and belongs to no room; a floating button
 * that opens an empty panel is worse than no button.
 */
export function ChatWidget() {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [roomKey, setRoomKey] = useState<string | null>(null);

  const unread = useQuery({
    queryKey: qk.chatUnread(),
    queryFn: () => get("/chat/unread-count", unreadCountSchema),
    enabled: Boolean(session),
    // The same 60s cadence the notification bell polls at. There is no realtime
    // channel in this MVP (docs/ARCHITECTURE.md §7) and a chat that updates on
    // focus and on a minute's tick is what the rest of the product does.
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const rooms = useQuery({
    queryKey: qk.chatRooms(),
    queryFn: () => get("/chat/rooms", roomsSchema),
    enabled: Boolean(session) && open,
    staleTime: 15_000,
  });

  if (!session) return null;

  const count = unread.data?.count ?? 0;
  const active = rooms.data?.find((room) => room.key === roomKey) ?? null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Always reopen on the list. Returning to whichever room was last open
        // is the behaviour a messaging app has because it has a badge per room
        // in a sidebar; here the list *is* the sidebar.
        if (!next) setRoomKey(null);
      }}
    >
      {/*
        ★ Above the phone's bottom bar, not over it.

        `--size-bottom-nav` is the token four surfaces now share — the toast
        viewport, the two sticky save bars and this. They each carried their own
        literal until 2026-08-29, and all four were wrong the moment the bar
        grew: measured at 390 × 844, this button sat 7px *under* the navigation.
        `globals.css` records the measurement. From `lg` the bar is gone and the
        button sits at the 24px the brief asks for.
      */}
      <Dialog.Trigger
        aria-label={count > 0 ? `Чат, ${count} шинэ мессеж` : "Чат"}
        data-print-hide
        className={cn(
          "fixed right-4 z-30 grid size-14 place-items-center rounded-pill bg-primary text-primary-ink shadow-lg transition-colors hover:bg-primary-hover",
          "bottom-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom)+0.5rem)] lg:bottom-6 lg:right-6",
        )}
      >
        <MessageCircle size={24} strokeWidth={2} aria-hidden="true" />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex min-w-[20px] items-center justify-center rounded-pill bg-danger px-1 text-caption font-bold leading-5 text-white ring-2 ring-canvas"
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 data-[state=open]:animate-in data-[state=open]:fade-in lg:bg-ink/20" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-surface",
            // Phone: the whole screen, as a messaging app is. No radius class —
            // `tokens.test.tsx` bans `rounded-none` along with the rest of
            // Tailwind's scale, and a square corner is the default anyway.
            "inset-0",
            // Desktop: a panel above the button, at the brief's size.
            "lg:inset-auto lg:bottom-24 lg:right-6 lg:h-[600px] lg:w-[400px] lg:rounded-card lg:border lg:border-border lg:shadow-xl",
            "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-2",
          )}
        >
          {active ? (
            <ChatRoom room={active} onBack={() => setRoomKey(null)} />
          ) : (
            <ChatList
              rooms={rooms.data}
              loading={rooms.isLoading}
              onOpen={(key) => setRoomKey(key)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The list of rooms — the panel's first view, and `/chat`'s left column. */
export function ChatList({
  rooms,
  loading,
  onOpen,
  activeKey,
  chrome = dialogChrome,
}: {
  rooms: z.infer<typeof roomsSchema> | undefined;
  loading: boolean;
  onOpen: (key: string) => void;
  /**
   * Which room the frame is showing beside this list, if any.
   *
   * Only the page passes it: on desktop the list and the room are on screen at
   * once, so the open row has to say so. The widget shows one view at a time
   * and has nothing to mark.
   */
  activeKey?: string | null;
  chrome?: ChatChrome;
}) {
  const { Title, Close } = chrome;

  return (
    <>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <Title className="text-lead font-semibold text-ink">Чатууд</Title>
        {Close ? (
          <Close
            aria-label="Хаах"
            className="grid size-9 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </Close>
        ) : null}
      </header>

      {loading ? (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !rooms || rooms.length === 0 ? (
        <p className="px-6 py-10 text-center text-body text-muted">
          Танд нээлттэй чат байхгүй байна.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border-soft overflow-y-auto">
          {rooms.map((room) => (
            <li key={room.key}>
              <button
                type="button"
                onClick={() => onOpen(room.key)}
                aria-current={room.key === activeKey ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas",
                  room.key === activeKey && "bg-primary-soft hover:bg-primary-soft",
                )}
              >
                {/* Initials, not an avatar: a room is a group of people and
                    there is no one face for it. */}
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-pill bg-primary-soft text-body font-semibold text-primary"
                >
                  {room.name.slice(0, 1)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-body font-semibold text-ink">{room.name}</span>
                    {room.lastMessage ? (
                      <span className="shrink-0 text-caption tabular-nums text-muted">
                        {timeOfDay(room.lastMessage.createdAt)}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-caption text-muted">{room.memberCount} гишүүн</span>
                  {room.lastMessage ? (
                    <span className="mt-0.5 block truncate text-caption text-muted">
                      {room.lastMessage.body}
                    </span>
                  ) : null}
                </span>

                {room.unreadCount > 0 ? (
                  <span className="mt-1 flex min-w-[20px] shrink-0 items-center justify-center rounded-pill bg-danger px-1 text-caption font-bold leading-5 text-white">
                    {room.unreadCount > 99 ? "99+" : room.unreadCount}
                    <span className="sr-only"> шинэ мессеж</span>
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One room: a header that goes back, the messages, and the composer. */
export function ChatRoom({
  room,
  onBack,
  hideBackAtLg = false,
  chrome = dialogChrome,
}: {
  room: z.infer<typeof chatRoomSchema>;
  /**
   * Omitted by `/chat` at desktop width, where the list is already beside this
   * pane — a "back" arrow pointing at something visible is a control that
   * appears to do nothing. The page still passes it below `lg`, where the room
   * replaces the list exactly as it does in the widget.
   */
  onBack?: () => void;
  /**
   * Hides the back arrow from `lg` up, where `/chat` shows the room list beside
   * this pane. A CSS class rather than a second `onBack` prop because the pane
   * cannot read the viewport, and the alternative — dropping `onBack` on
   * desktop — would break the same page below `lg`, which needs it.
   */
  hideBackAtLg?: boolean;
  chrome?: ChatChrome;
}) {
  const { Title, Close } = chrome;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement | null>(null);

  const history = useQuery({
    queryKey: qk.chatMessages(room.key),
    queryFn: () => get(`/chat/rooms/${encodeURIComponent(room.key)}/messages`, historySchema),
    // A room that is open is a room somebody is watching. 10s is the shortest
    // interval that is not a websocket pretending to be one.
    refetchInterval: 10_000,
  });

  /*
    Opening a room reads it. Fired once per room rather than on every refetch —
    the cursor only ever moves forward, so re-marking on each poll would be a
    write every ten seconds for a reader who is doing nothing.
  */
  const markRead = useMutation({
    mutationFn: () =>
      mutate(`/chat/rooms/${encodeURIComponent(room.key)}/read`, z.unknown(), { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.chatUnread() });
      void queryClient.invalidateQueries({ queryKey: qk.chatRooms() });
    },
  });

  useEffect(() => {
    markRead.mutate();
    /*
      `room.key` alone is the dependency on purpose. `markRead` is a new object
      on every render, so listing it would re-run this effect continuously and
      write a cursor every frame. The mutation reads `room.key` through the
      closure and nothing else changes what it does.
    */
  }, [room.key]);

  const send = useMutation({
    mutationFn: (body: string) =>
      mutate(`/chat/rooms/${encodeURIComponent(room.key)}/messages`, chatMessageSchema, {
        method: "POST",
        body: { body },
      }),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: qk.chatMessages(room.key) });
      void queryClient.invalidateQueries({ queryKey: qk.chatRooms() });
    },
  });

  // The API returns newest first — the list renders oldest at the top, as a
  // conversation reads, so it is reversed here rather than sorted on the server
  // where "newest first" is the right default for pagination.
  const messages = [...(history.data?.items ?? [])].reverse();

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <>
      <header className="flex items-center gap-2 border-b border-border px-2 py-2.5">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Чатууд руу буцах"
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink",
              hideBackAtLg && "lg:hidden",
            )}
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1 ps-1">
          <Title className="truncate text-body font-semibold text-ink">{room.name}</Title>
          <p className="text-caption text-muted">{room.memberCount} гишүүн</p>
        </div>
        {Close ? (
          <Close
            aria-label="Хаах"
            className="grid size-9 shrink-0 place-items-center rounded-control text-muted hover:bg-canvas hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </Close>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-3 py-3">
        {history.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="ml-auto h-10 w-1/2" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-body text-muted">Эхний мессежээ бичнэ үү.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </ul>
        )}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const body = draft.trim();
          if (body && !send.isPending) send.mutate(body);
        }}
        className="flex items-center gap-2 border-t border-border px-3 py-2.5"
      >
        <label htmlFor="chat-draft" className="sr-only">
          Мессеж бичих
        </label>
        <Input
          id="chat-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Мессеж бичих…"
          autoComplete="off"
          disabled={send.isPending}
        />
        <button
          type="submit"
          aria-label="Илгээх"
          disabled={!draft.trim() || send.isPending}
          className="grid size-12 shrink-0 place-items-center rounded-control bg-primary text-primary-ink transition-colors hover:bg-primary-hover disabled:bg-track disabled:text-faint"
        >
          <Send size={18} aria-hidden="true" />
        </button>
      </form>

      {send.isError ? (
        <p role="alert" className="border-t border-border px-3 py-2 text-caption text-danger">
          {errorMessage(send.error)}
        </p>
      ) : null}
    </>
  );
}

/**
 * One message.
 *
 * ★ The author's name is on other people's messages and not on your own — you
 * know who you are, and repeating it on every bubble is the noise that makes a
 * narrow panel unreadable.
 */
function MessageBubble({ message }: { message: z.infer<typeof chatMessageSchema> }) {
  return (
    <li className={cn("flex flex-col", message.mine ? "items-end" : "items-start")}>
      {!message.mine ? (
        <span className="mb-0.5 px-1 text-caption font-medium text-muted">
          {fullName(message.author)}
        </span>
      ) : null}
      <div
        className={cn(
          "max-w-[80%] rounded-card px-3 py-2",
          message.mine ? "bg-primary text-primary-ink" : "border border-border bg-surface text-ink",
        )}
      >
        <p className="whitespace-pre-wrap break-words text-body">{message.body}</p>
      </div>
      <span className="mt-0.5 px-1 text-caption tabular-nums text-faint">
        {timeOfDay(message.createdAt)}
      </span>
    </li>
  );
}

/** `10:32` — a chat shows the clock, not a date. */
function timeOfDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
