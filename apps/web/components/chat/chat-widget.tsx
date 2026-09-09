"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CloudOff,
  Ellipsis,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  SmilePlus,
  RotateCcw,
  Users,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { chatMessageSchema, chatRoomSchema, unreadCountSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { mediaUrl } from "@/lib/api/client";
import { MAX_CHAT_IMAGES } from "@/lib/chat-media";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/states";
import { fullName } from "@/lib/format";
import { PersonAvatar } from "@/components/media/media-image";
import { Art } from "@/components/ui/art";
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
          "fixed right-4 z-30 grid size-14 place-items-center rounded-pill bg-transparent shadow-lg transition-transform hover:scale-105",
          "bottom-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom)+0.5rem)] lg:bottom-6 lg:right-6",
        )}
      >
        <Art name="chat" size={56} className="size-14 object-contain" />
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
              error={rooms.isError}
              onRetry={() => void rooms.refetch()}
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
  error = false,
  onRetry,
  onOpen,
  activeKey,
  action,
  searchPlaceholder = "Нэр эсвэл мессежээр хайх",
  chrome = dialogChrome,
}: {
  rooms: z.infer<typeof roomsSchema> | undefined;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  onOpen: (key: string) => void;
  /** Optional full-page action rendered above the room search. */
  action?: ReactNode;
  searchPlaceholder?: string;
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
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("mn");
  const visibleRooms = useMemo(
    () =>
      rooms?.filter((room) => {
        if (!normalizedQuery) return true;
        return [
          room.name,
          room.lastMessage?.body,
          room.lastMessage?.author ? fullName(room.lastMessage.author) : undefined,
        ]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase("mn").includes(normalizedQuery));
      }),
    [normalizedQuery, rooms],
  );

  return (
    <>
      <header className="border-b border-border bg-surface px-4 pb-3 pt-4">
        <div className="flex min-h-11 items-center justify-between gap-2">
          {action ?? <Title className="text-title font-bold text-ink">Чатууд</Title>}
          {Close ? (
            <Close
              aria-label="Хаах"
              className="grid size-11 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              <X size={19} aria-hidden="true" />
            </Close>
          ) : null}
        </div>
        <label className="relative mt-2 block">
          <span className="sr-only">Чатын нэр эсвэл мессежээр хайх</span>
          <Search
            size={18}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-[44px] bg-canvas pl-11"
          />
        </label>
      </header>

      {loading ? (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error ? (
        <div className="grid flex-1 place-items-center px-6 py-10 text-center">
          <div>
            <CloudOff size={30} aria-hidden="true" className="mx-auto mb-3 text-faint" />
            <p className="text-body font-semibold text-ink">Чатуудыг ачаалж чадсангүй</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-body font-medium text-primary hover:bg-primary-soft"
            >
              <RotateCcw size={17} aria-hidden="true" />
              Дахин оролдох
            </button>
          </div>
        </div>
      ) : !rooms || rooms.length === 0 ? (
        <p className="px-6 py-10 text-center text-body text-muted">
          Танд нээлттэй чат байхгүй байна.
        </p>
      ) : visibleRooms?.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6 py-10 text-center">
          <div>
            <Search size={28} aria-hidden="true" className="mx-auto mb-3 text-faint" />
            <p className="text-body font-medium text-ink">Илэрц олдсонгүй</p>
            <p className="mt-1 text-caption text-muted">Өөр нэр эсвэл мессежээр хайна уу.</p>
          </div>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto bg-surface py-1">
          {visibleRooms?.map((room) => (
            <li key={room.key}>
              <button
                type="button"
                onClick={() => onOpen(room.key)}
                aria-current={room.key === activeKey ? "true" : undefined}
                className={cn(
                  "relative flex min-h-[84px] w-full items-center gap-3 border-b border-border-soft px-4 py-3 text-left transition-colors hover:bg-canvas",
                  room.key === activeKey &&
                    "bg-primary-soft before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-pill before:bg-primary hover:bg-primary-soft",
                )}
              >
                {/* Initials, not an avatar: a room is a group of people and
                    there is no one face for it. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-12 shrink-0 place-items-center rounded-pill text-lead font-bold",
                    room.kind === "GROUP"
                      ? "bg-mint text-mint-ink"
                      : "bg-primary-soft text-primary",
                  )}
                >
                  {room.name.slice(0, 1)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-body font-bold text-ink">{room.name}</span>
                    {room.lastMessage ? (
                      <span className="shrink-0 text-caption tabular-nums text-muted">
                        {roomListTime(room.lastMessage.createdAt)}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-caption text-muted">
                      {room.lastMessage?.body ?? `${room.memberCount} гишүүн`}
                    </span>
                    {room.unreadCount > 0 ? (
                      <span className="flex min-w-[22px] shrink-0 items-center justify-center rounded-pill bg-primary px-1.5 text-caption font-bold leading-[22px] text-primary-ink">
                        {room.unreadCount > 99 ? "99+" : room.unreadCount}
                        <span className="sr-only"> шинэ мессеж</span>
                      </span>
                    ) : null}
                  </span>
                </span>
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
  const [messageQuery, setMessageQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const draftId = useId();

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

  /**
   * Text, photographs, or both — one request either way.
   *
   * ★ JSON when there is nothing attached, `FormData` when there is. Not
   * always multipart: every existing test and the whole room history were
   * written against the JSON body, and a form-encoded post of a plain message
   * would change what the server sees for no gain. `apiFetch` passes a
   * `FormData` through untouched so the browser can set its own boundary.
   *
   * ★★ The files go up on **send**, not on pick. A photograph chosen and then
   * removed is never uploaded, and there is no half-attached state to clean up
   * if the person closes the panel.
   */
  /**
   * Photographs chosen but not yet sent.
   *
   * ★ `File` objects, not uploaded ids. Nothing leaves the browser until the
   * send button is pressed, so a picture picked and then removed costs the
   * server nothing and leaves no orphan behind — see the mutation below.
   */
  const [pending, setPending] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const send = useMutation({
    mutationFn: ({ body, files }: { body: string; files: File[] }) => {
      const path = `/chat/rooms/${encodeURIComponent(room.key)}/messages`;

      if (files.length === 0) {
        return mutate(path, chatMessageSchema, { method: "POST", body: { body } });
      }

      const form = new FormData();
      if (body) form.append("body", body);
      for (const file of files) form.append("images", file);
      return mutate(path, chatMessageSchema, { method: "POST", body: form });
    },
    onSuccess: () => {
      setDraft("");
      setPending([]);
      void queryClient.invalidateQueries({ queryKey: qk.chatMessages(room.key) });
      void queryClient.invalidateQueries({ queryKey: qk.chatRooms() });
    },
  });

  // The API returns newest first — the list renders oldest at the top, as a
  // conversation reads, so it is reversed here rather than sorted on the server
  // where "newest first" is the right default for pagination.
  const messages = [...(history.data?.items ?? [])].reverse();
  const normalizedMessageQuery = messageQuery.trim().toLocaleLowerCase("mn");
  const visibleMessages = normalizedMessageQuery
    ? messages.filter((message) =>
        [message.body, message.author ? fullName(message.author) : ""]
          .join(" ")
          .toLocaleLowerCase("mn")
          .includes(normalizedMessageQuery),
      )
    : messages;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <>
      <div className="border-b border-border bg-surface">
        <header className="flex min-h-[76px] items-center gap-2 px-3 py-2.5 sm:px-4">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Чатууд руу буцах"
              className={cn(
                "grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink",
                hideBackAtLg && "lg:hidden",
              )}
            >
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
          ) : null}

          <span
            aria-hidden="true"
            className={cn(
              "hidden size-11 shrink-0 place-items-center rounded-pill text-body font-bold sm:grid",
              room.kind === "GROUP" ? "bg-mint text-mint-ink" : "bg-primary-soft text-primary",
            )}
          >
            {room.name.slice(0, 1)}
          </span>

          <div className="min-w-0 flex-1">
            <Title className="truncate text-lead font-bold text-ink">{room.name}</Title>
            <p className="mt-0.5 truncate text-caption text-muted">{room.memberCount} гишүүн</p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setSearchOpen((open) => !open);
                setDetailsOpen(false);
              }}
              aria-label="Мессежээс хайх"
              aria-expanded={searchOpen}
              className={cn(
                "grid size-11 place-items-center rounded-control border border-border text-muted transition-colors hover:bg-canvas hover:text-ink",
                searchOpen && "border-primary bg-primary-soft text-primary",
              )}
            >
              <Search size={19} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                setDetailsOpen((open) => !open);
                setSearchOpen(false);
              }}
              aria-label="Чатын мэдээлэл"
              aria-expanded={detailsOpen}
              className={cn(
                "hidden size-11 place-items-center rounded-control border border-border text-muted transition-colors hover:bg-canvas hover:text-ink sm:grid",
                detailsOpen && "border-primary bg-primary-soft text-primary",
              )}
            >
              <Users size={19} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                setDetailsOpen((open) => !open);
                setSearchOpen(false);
              }}
              aria-label="Нэмэлт мэдээлэл"
              aria-expanded={detailsOpen}
              className="hidden size-11 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink md:grid"
            >
              <Ellipsis size={20} aria-hidden="true" />
            </button>
            {Close ? (
              <Close
                aria-label="Хаах"
                className="grid size-11 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-canvas hover:text-ink"
              >
                <X size={19} aria-hidden="true" />
              </Close>
            ) : null}
          </div>
        </header>

        {searchOpen ? (
          <div className="border-t border-border-soft px-3 py-2.5 sm:px-4">
            <label className="relative block">
              <span className="sr-only">Энэ чатын мессежээс хайх</span>
              <Search
                size={17}
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <Input
                type="search"
                autoFocus
                value={messageQuery}
                onChange={(event) => setMessageQuery(event.target.value)}
                placeholder="Энэ чатын мессежээс хайх"
                className="h-[44px] bg-canvas pl-11"
              />
            </label>
          </div>
        ) : null}

        {detailsOpen ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border-soft bg-canvas px-4 py-2.5 text-caption text-muted">
            <span className="font-medium text-ink">
              {room.kind === "GROUP" ? "Бүлгийн чат" : "Ажилтны чат"}
            </span>
            <span>{room.memberCount} гишүүн</span>
            <span>{room.unreadCount > 0 ? `${room.unreadCount} уншаагүй` : "Шинэ мессежгүй"}</span>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface px-3 py-4 sm:px-5">
        {history.isLoading ? (
          <div className="mx-auto flex w-full max-w-[860px] flex-col gap-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-1/2" />
          </div>
        ) : history.isError ? (
          <div className="grid min-h-full place-items-center px-6 py-10 text-center">
            <div>
              <CloudOff size={32} aria-hidden="true" className="mx-auto mb-3 text-faint" />
              <p className="text-body font-semibold text-ink">Мессежүүдийг ачаалж чадсангүй</p>
              <button
                type="button"
                onClick={() => void history.refetch()}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-body font-medium text-primary hover:bg-primary-soft"
              >
                <RotateCcw size={17} aria-hidden="true" />
                Дахин оролдох
              </button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <ChatEmptyState />
        ) : visibleMessages.length === 0 ? (
          <div className="grid min-h-full place-items-center py-10 text-center">
            <div>
              <Search size={30} aria-hidden="true" className="mx-auto mb-3 text-faint" />
              <p className="text-body font-semibold text-ink">Тохирох мессеж олдсонгүй</p>
              <p className="mt-1 text-caption text-muted">Хайлтын үгээ өөрчилж үзнэ үү.</p>
            </div>
          </div>
        ) : (
          <ul className="mx-auto flex w-full max-w-[860px] flex-col gap-3">
            {visibleMessages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </ul>
        )}
        <div ref={bottom} />
      </div>

      <div className="relative border-t border-border bg-surface p-3 sm:p-4">
        {emojiOpen ? (
          <div className="absolute bottom-[76px] right-14 z-10 flex gap-1 rounded-card border border-border bg-surface p-2 shadow-lg sm:right-20">
            {["😊", "👍", "❤️", "🎉", "🙏"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setDraft((value) => `${value}${emoji}`);
                  setEmojiOpen(false);
                }}
                aria-label={`${emoji} нэмэх`}
                className="grid size-11 place-items-center rounded-control text-title transition-colors hover:bg-canvas"
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        {/*
          The chosen photographs, before they are sent.

          ★ Object URLs, revoked when the strip unmounts — a room left open all
          day would otherwise hold every picture anybody previewed in memory.
        */}
        {pending.length > 0 ? (
          <ul className="mx-auto mb-2 flex w-full max-w-[940px] flex-wrap gap-2">
            {pending.map((file, index) => (
              <PendingImage
                key={`${file.name}-${index}`}
                file={file}
                onRemove={() => setPending((current) => current.filter((_, i) => i !== index))}
              />
            ))}
          </ul>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const body = draft.trim();
            // Either one is enough now — a photograph may travel with nothing
            // typed, which is what `sendChatMessageSchema`'s optional `body`
            // and `ChatService.send`'s own check are there for.
            if ((body || pending.length > 0) && !send.isPending)
              send.mutate({ body, files: pending });
          }}
          className="mx-auto flex w-full max-w-[940px] items-center gap-2"
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []);
              // Silently keeping only the first four would be worse than
              // saying so — the person watched themselves pick six.
              setPending((current) => [...current, ...chosen].slice(0, MAX_CHAT_IMAGES));
              // Reset, so picking the same file twice in a row still fires.
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={pending.length >= MAX_CHAT_IMAGES || send.isPending}
            aria-label="Зураг хавсаргах"
            title={
              pending.length >= MAX_CHAT_IMAGES
                ? `Нэг мессежид ${MAX_CHAT_IMAGES} зураг хүртэл`
                : "Зураг хавсаргах"
            }
            className="grid size-12 shrink-0 place-items-center rounded-control border border-border text-muted transition-colors hover:bg-canvas hover:text-ink disabled:text-faint"
          >
            <Paperclip size={20} aria-hidden="true" />
          </button>

          <div className="relative min-w-0 flex-1">
            <label htmlFor={draftId} className="sr-only">
              Мессеж бичих
            </label>
            <Input
              id={draftId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Бичих..."
              autoComplete="off"
              maxLength={2000}
              disabled={send.isPending}
              className="bg-canvas pr-12"
            />
            <button
              type="button"
              onClick={() => setEmojiOpen((open) => !open)}
              aria-label="Эможи сонгох"
              aria-expanded={emojiOpen}
              className="absolute right-0.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-control text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <SmilePlus size={20} aria-hidden="true" />
            </button>
          </div>

          <button
            type="submit"
            aria-label="Илгээх"
            disabled={(!draft.trim() && pending.length === 0) || send.isPending}
            className="grid size-12 shrink-0 place-items-center rounded-control bg-primary text-primary-ink shadow-sm transition-all hover:bg-primary-hover hover:shadow-md disabled:bg-track disabled:text-faint disabled:shadow-none"
          >
            <Send size={20} aria-hidden="true" />
          </button>
        </form>

        {send.isError ? (
          <p role="alert" className="mx-auto mt-2 max-w-[940px] text-caption text-danger">
            {errorMessage(send.error)}
          </p>
        ) : null}
      </div>
    </>
  );
}

function ChatEmptyState() {
  return (
    <div className="grid min-h-full place-items-center px-4 py-12 text-center">
      <div>
        <div className="relative mx-auto mb-6 h-20 w-28" aria-hidden="true">
          <span className="absolute bottom-0 right-1 grid size-14 place-items-center rounded-card bg-primary-soft text-primary/40">
            <MessageSquare size={31} strokeWidth={1.8} />
          </span>
          <span className="absolute left-1 top-0 grid size-16 place-items-center rounded-card bg-primary text-primary-ink shadow-sm">
            <MessageCircle size={34} strokeWidth={1.9} />
          </span>
        </div>
        <p className="text-title font-bold text-ink">Эхний бичлэгээ илгээнэ үү.</p>
        <p className="mt-2 text-body text-muted">Энэ чатад одоогоор мессеж алга байна.</p>
      </div>
    </div>
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
  /*
    ★ 2026-09-09 — other people's messages carry their portrait.

    A room is the one screen in the product that is about who is speaking, and
    a column of identical grey bubbles above a name in 12px type makes two
    teachers in the same room hard to tell apart at a glance. `PersonAvatar`
    already answers this: a photograph if the person has one, their initials on
    a tint derived from their name if not — so a room reads the same whether
    anybody has uploaded a picture.

    Not on your own messages, for the reason the name is not on them either:
    you know who you are, and a 32px face repeated down the right-hand side of
    a 400px panel is the noise that makes it unreadable. That asymmetry is why
    the avatar sits inside the row rather than being a column of its own.
  */
  return (
    <li className={cn("flex flex-col", message.mine ? "items-end" : "items-start")}>
      {!message.mine ? (
        <span className="mb-0.5 px-1 text-caption font-medium text-muted">
          {fullName(message.author)}
        </span>
      ) : null}
      <div className={cn("flex max-w-[82%] items-end gap-2 sm:max-w-[72%]")}>
        {!message.mine ? (
          <PersonAvatar child={message.author ?? {}} size={32} className="mb-4 shrink-0 self-end" />
        ) : null}
        <div
          className={cn(
            "min-w-0 rounded-card px-3.5 py-2.5",
            message.mine
              ? "bg-primary text-primary-ink"
              : "border border-border bg-surface text-ink",
          )}
        >
          {message.media.length > 0 ? (
            /*
              One photograph fills the bubble; two to four go in a grid.

              ★ `aspect-square` with `object-cover` on the grid, and the
              natural ratio on a lone image. A single photograph is the message
              and should be seen whole; four are a contact sheet, and four
              different shapes in a 300px bubble is a ragged edge nobody reads.
            */
            <ul
              className={cn(
                "grid gap-1",
                message.media.length === 1 ? "grid-cols-1" : "grid-cols-2",
                message.body ? "mb-2" : "",
              )}
            >
              {message.media.map((image) => (
                <li key={image.id} className="min-w-0">
                  <a href={mediaUrl(image.id)} target="_blank" rel="noopener noreferrer">
                    {/*
                      A plain `<img>`, deliberately — the same reasoning
                      `media-image.tsx` sets out at the top of the file:
                      `next/image` would cache the object behind a public
                      `/_next/image` path, which is the exact rule §1.4 exists
                      to enforce. The `src` is the authorising endpoint, and
                      the `SameSite=Lax` cookie rides along with the image
                      request itself.
                    */}
                    <img
                      src={mediaUrl(image.id)}
                      width={image.width ?? undefined}
                      height={image.height ?? undefined}
                      /*
                        ★ Whose photograph and when, not "зураг". A screen
                        reader user cannot be told what is in the picture, but
                        who sent it and at what time is knowable and is the
                        part that makes a room followable.
                      */
                      alt={`${message.mine ? "Таны" : fullName(message.author)} илгээсэн зураг · ${timeOfDay(message.createdAt)}`}
                      loading="lazy"
                      className={cn(
                        "w-full rounded-control bg-canvas object-cover",
                        message.media.length === 1
                          ? "max-h-[320px] object-contain"
                          : "aspect-square",
                      )}
                    />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {message.body ? (
            <p className="whitespace-pre-wrap break-words text-body">{message.body}</p>
          ) : null}
        </div>
      </div>
      <span
        className={cn(
          "mt-0.5 text-caption tabular-nums text-faint",
          // Line the clock up under the bubble, not under the avatar.
          message.mine ? "px-1" : "px-1 ms-10",
        )}
      >
        {timeOfDay(message.createdAt)}
      </span>
    </li>
  );
}

/**
 * One chosen photograph, before it is sent.
 *
 * ★ Its own component so the object URL has a lifetime. Built in an effect and
 * revoked on unmount, rather than made inline during render — an inline
 * `createObjectURL` runs on every re-render of the composer (every keystroke)
 * and leaks one blob handle each time.
 */
function PendingImage({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <li className="relative">
      {url ? (
        <img
          src={url}
          alt={file.name}
          className="size-16 rounded-control border border-border object-cover"
        />
      ) : (
        <div className="size-16 rounded-control border border-border bg-canvas" />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${file.name} хасах`}
        className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-pill bg-ink text-surface shadow-sm"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

/** `10:32` — a chat shows the clock, not a date. */
function timeOfDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function roomListTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  if (sameDay) return timeOfDay(iso);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    yesterday.getFullYear() === date.getFullYear() &&
    yesterday.getMonth() === date.getMonth() &&
    yesterday.getDate() === date.getDate()
  ) {
    return "Өчигдөр";
  }

  return `${date.getMonth() + 1} сар ${date.getDate()}`;
}
