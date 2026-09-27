import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { ChatList, ChatRoom, type ChatChrome } from "@/components/chat/chat-widget";

/**
 * The chat is round — the client, 2026-09-22: "Багш, удирдлага, эцэг эх 3-д
 * дугуй хэлбэртэй чатуудыг оруулах."
 *
 * ★ **Shape is the whole request here**, which is the one case where asserting
 * on a class name earns its keep: there is no behaviour to test, and a silent
 * revert to `rounded-control` is exactly what the person who asked would notice
 * first. Both assertions name a **token**, never a pixel value — the rule
 * `tokens.test.tsx` exists for.
 *
 * ★★ The floating launcher is **not** tested here, because it was already a
 * circle: `size-14 rounded-pill`. Of the client's three readings, that one was
 * satisfied before this change, and a test implying otherwise would misreport
 * what the commit did.
 */

const chrome: ChatChrome = {
  Title: ({ className, children }) => <h2 className={className}>{children}</h2>,
};

const ROOM = {
  key: "group:11111111-1111-4111-8111-111111111111",
  kind: "GROUP" as const,
  kindergartenId: "22222222-2222-4222-8222-222222222222",
  groupId: "11111111-1111-4111-8111-111111111111",
  name: "Дэлбээ бүлэг",
  memberCount: 12,
  lastMessage: null,
  unreadCount: 0,
};

const MESSAGES_PATH = `/chat/rooms/${encodeURIComponent(ROOM.key)}/messages`;

const message = {
  id: "33333333-3333-4333-8333-333333333333",
  roomKey: ROOM.key,
  body: "сайн уу",
  createdAt: "2026-09-09T04:32:00.000Z",
  author: { id: "44444444-4444-4444-8444-444444444444", lastName: "Бат", firstName: "Ану" },
  mine: false,
  media: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("чат — дугуй хэлбэр", () => {
  it("draws a message bubble with the bubble radius token", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: MESSAGES_PATH, body: { items: [message], nextCursor: null } },
    ]);
    renderWithProviders(<ChatRoom room={ROOM} onBack={() => {}} chrome={chrome} />);

    const text = await screen.findByText("сайн уу");
    /*
     * ★ `closest` on the styled wrapper rather than the text node's own parent:
     * the body sits inside a `<p>` within the bubble, and the radius is on the
     * bubble.
     */
    const bubble = text.closest("[class*='rounded-bubble']");
    expect(bubble).not.toBeNull();
  });

  /*
   * ★ The room badge in the widget's list. It was `rounded-control` — a
   * rounded square — while `/chat`'s own list and `PersonAvatar` had always
   * drawn circles, so the two halves of the same feature disagreed about what a
   * participant looks like. That disagreement is the bug this pins.
   */
  it("draws the room badge as a circle in the list", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["TEACHER"]) }]);
    /*
     * ★ `rooms` is a prop, not a query — `ChatList` is the presentational half
     * and `ChatWidget` owns the fetch. Passing the room directly keeps this
     * about the shape rather than about a stub resolving.
     */
    const { container } = renderWithProviders(
      <ChatList rooms={[ROOM]} loading={false} onOpen={() => {}} chrome={chrome} />,
    );

    await screen.findByText("Дэлбээ бүлэг");

    const badge = container.querySelector("span[aria-hidden='true'].rounded-pill");
    expect(badge).not.toBeNull();
    expect(container.querySelector("span[aria-hidden='true'].rounded-control")).toBeNull();
  });

  /*
   * ★★ The token is defined where tokens live. Without this the two cases above
   * would pass against a `rounded-bubble` class that Tailwind never compiled —
   * a class name is just a string to `querySelector`, so the test would be
   * green and the corner square.
   */
  it("defines the bubble radius in globals.css", () => {
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
    expect(css).toMatch(/--radius-bubble:\s*\d+px;/);
  });
});
