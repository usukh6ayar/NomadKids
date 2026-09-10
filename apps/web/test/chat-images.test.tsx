import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { ChatRoom, type ChatChrome } from "@/components/chat/chat-widget";

/**
 * The non-dialog chrome, the same shape `/chat` supplies.
 *
 * ★ `ChatRoom` defaults to Radix's `Dialog.Title`, which throws outside a
 * `Dialog` — the widget always has one, the page never does. Rendering the
 * pane on its own is the page's case, so it gets the page's chrome.
 */
const chrome: ChatChrome = {
  Title: ({ className, children }) => <h2 className={className}>{children}</h2>,
};

/**
 * Chat photographs — 2026-09-09.
 *
 * ★ The client asked for images and video, then withdrew video the same day:
 * "бичлэг ороохыг болиулъя. зураг оруулдаг байхад болно. зураг ни гэхдээ бага
 * хэмжээтэй."
 *
 * These cover the browser's half of that. The API's half — that a photograph
 * is authorised by the **room** and not by the tenant, so a guardian from
 * another group gets 404 — is in `apps/api/test/chat.test.ts`, which is where
 * a §4.1 case has to live: an assertion here would pass even if the endpoint
 * never checked.
 */

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

/** One message, shaped as `chatMessageSchema` parses it. */
const message = (over: Record<string, unknown> = {}) => ({
  id: "33333333-3333-4333-8333-333333333333",
  roomKey: ROOM.key,
  body: "сайн уу",
  createdAt: "2026-09-09T04:32:00.000Z",
  author: { id: "44444444-4444-4444-8444-444444444444", lastName: "Бат", firstName: "Ану" },
  mine: false,
  media: [],
  ...over,
});

/**
 * The hidden `<input type="file">` behind the paperclip.
 *
 * ★ Queried out of the container rather than by label. It is `hidden`, which
 * is deliberate — the paperclip button is the control a person uses — and a
 * hidden input is by definition not in the accessibility tree, so
 * `getByLabelText` cannot and should not find it.
 */
const fileInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[type="file"]')!;

/**
 * The send, out of everything the pane posts.
 *
 * ★ Not "the first POST". Opening a room also posts `…/read` to move the
 * unread cursor, and that call has no body — a `find` on the method alone
 * matches it and reports the send as missing.
 */
const sent = (calls: { url: string; method: string; body?: unknown }[]) =>
  calls.find((call) => call.method === "POST" && call.url.endsWith("/messages"));

/** A file the input will accept — content is the server's business, not this test's. */
const imageFile = (name = "зураг.jpg") =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], name, { type: "image/jpeg" });

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("чат — зураг", () => {
  it("sends a chosen photograph as multipart, with the typed text", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: MESSAGES_PATH, body: { items: [], nextCursor: null } },
    ]);
    const { container } = renderWithProviders(<ChatRoom room={ROOM} chrome={chrome} />);

    await screen.findByLabelText("Мессеж бичих");

    await user.upload(fileInput(container), imageFile());

    await user.type(screen.getByLabelText("Мессеж бичих"), "өнөөдрийн зураг");
    await user.click(screen.getByRole("button", { name: "Илгээх" }));

    await waitFor(() => expect(sent(api.calls)?.body).toBeInstanceOf(FormData));

    const form = sent(api.calls)!.body as FormData;
    expect(form.get("body")).toBe("өнөөдрийн зураг");
    expect(form.getAll("images")).toHaveLength(1);

    /*
     * ★ No `Content-Type` set by us. The browser has to write it, because it
     * carries the multipart boundary — a hand-set header produces a body the
     * server cannot parse, and the failure looks like a validation bug.
     */
    const headers = api.calls.find(
      (call) => call.method === "POST" && call.url.endsWith("/messages"),
    )!.headers;
    expect(headers["content-type"]).toBeUndefined();
  });

  /*
   * ★ A plain message stays JSON. Every existing caller and the whole api
   * suite were written against that body, and making them all multipart for
   * the sake of one code path would change what the server sees for no gain.
   */
  it("keeps sending a text-only message as JSON", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: MESSAGES_PATH, body: { items: [], nextCursor: null } },
    ]);
    renderWithProviders(<ChatRoom room={ROOM} chrome={chrome} />);

    await user.type(await screen.findByLabelText("Мессеж бичих"), "зурaггүй");
    await user.click(screen.getByRole("button", { name: "Илгээх" }));

    await waitFor(() => expect(sent(api.calls)).toBeTruthy());
    expect(sent(api.calls)!.body).toEqual({ body: "зурaггүй" });
  });

  /*
   * ★ The send button was `disabled={!draft.trim()}`. A photograph with
   * nothing typed is a perfectly ordinary message and must be sendable — it is
   * why `sendChatMessageSchema.body` became optional.
   */
  it("lets a photograph be sent with nothing typed", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: MESSAGES_PATH, body: { items: [], nextCursor: null } },
    ]);
    const { container } = renderWithProviders(<ChatRoom room={ROOM} chrome={chrome} />);

    await screen.findByLabelText("Мессеж бичих");
    expect(screen.getByRole("button", { name: "Илгээх" })).toBeDisabled();

    await user.upload(fileInput(container), imageFile());

    await waitFor(() => expect(screen.getByRole("button", { name: "Илгээх" })).toBeEnabled());
  });

  it("removes a chosen photograph before it is ever uploaded", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: MESSAGES_PATH, body: { items: [], nextCursor: null } },
    ]);
    const { container } = renderWithProviders(<ChatRoom room={ROOM} chrome={chrome} />);

    await screen.findByLabelText("Мессеж бичих");
    await user.upload(fileInput(container), imageFile());

    await user.click(await screen.findByRole("button", { name: "зураг.jpg хасах" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Илгээх" })).toBeDisabled());
    // Nothing was ever sent — the files go up on submit, not on pick.
    expect(sent(api.calls)).toBeUndefined();
  });

  it("draws a received photograph, credited to whoever sent it", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: MESSAGES_PATH,
        body: {
          items: [
            message({
              body: "",
              media: [
                { id: "55555555-5555-4555-8555-555555555555", width: 1280, height: 960 },
                { id: "66666666-6666-4666-8666-666666666666", width: 800, height: 600 },
              ],
            }),
          ],
          nextCursor: null,
        },
      },
    ]);
    renderWithProviders(<ChatRoom room={ROOM} chrome={chrome} />);

    const images = await screen.findAllByRole("img", { name: /илгээсэн зураг/ });
    expect(images).toHaveLength(2);
    /*
     * ★ Whose and when, never "зураг". A screen-reader user cannot be told
     * what is in the picture; who sent it is knowable and is what makes a room
     * followable.
     */
    expect(images[0]).toHaveAccessibleName(expect.stringContaining("Бат"));
    // Served through the authorising endpoint, never a bucket URL (§1.4).
    expect(images[0]).toHaveAttribute("src", expect.stringContaining("/media/"));
    // The dimensions travel so the bubble reserves space and the room does not
    // jump as photographs load.
    expect(images[0]).toHaveAttribute("width", "1280");
  });
});
