import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import { SelectedChildProvider } from "@/lib/selected-child";
import FeedbackPage from "@/app/(app)/feedback/page";
import FeedbackInboxPage from "@/app/(app)/surveys/feedback/page";

/*
 * ★ Санал хүсэлт — 2026-10-08, ready for the API the backend is being asked
 * for (`lib/feedback.ts`). A guardian writes, the administration reads; a
 * named note gets an official answer and an anonymous one never names anyone.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const CHILD = "44444444-4444-4444-8444-444444444444";
const INBOX = `/kindergartens/${KG}/feedback`;
const MINE = "/me/feedback";

const note = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  category: "FOOD",
  body: "Хоолны чанар муу байна.",
  anonymous: false,
  author: { firstName: "Сараа", lastName: "Бат", phone: "99112233" },
  childName: "Тэмүүлэн",
  status: "NEW",
  createdAt: "2026-10-08T01:00:00.000Z",
  acknowledgedAt: null,
  reply: null,
  ...overrides,
});

const page = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  totalPages: 1,
});

beforeEach(() => vi.clearAllMocks());

/** A note is a two-line mail row until it is opened — details and buttons are behind the press. */
async function openNote(user: ReturnType<typeof userEvent.setup>, card: HTMLElement) {
  await user.click(card.querySelector<HTMLButtonElement>("button[aria-controls]")!);
}

describe("the administration's inbox", () => {
  it("never names an anonymous sender and offers it no reply", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: INBOX,
        body: page([note("a", { anonymous: true, author: null, childName: null })]),
      },
    ]);
    renderWithProviders(<FeedbackInboxPage />);

    const card = (await screen.findByText("Хоолны чанар муу байна.")).closest("li")!;
    expect(within(card).getByText("Нэргүй")).toBeInTheDocument();
    expect(within(card).queryByText(/Сараа/)).toBeNull();
    await openNote(user, card);
    expect(within(card).queryByText(/Сараа/)).toBeNull();
    expect(within(card).getByRole("button", { name: "Хүлээн авлаа" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Албан хариу өгөх" })).toBeNull();
  });

  it("acknowledges a new note and answers a named one", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `${INBOX}/a/acknowledge`,
        method: "POST",
        body: note("a", { status: "ACKNOWLEDGED" }),
      },
      { path: `${INBOX}/a/reply`, method: "POST", body: note("a", { status: "ANSWERED" }) },
      { path: INBOX, body: page([note("a")]) },
    ]);
    renderWithProviders(<FeedbackInboxPage />);

    const card = (await screen.findByText("Хоолны чанар муу байна.")).closest("li")!;
    expect(within(card).getByText(/Бат.*Сараа|Сараа/)).toBeInTheDocument();

    await openNote(user, card);
    await user.click(within(card).getByRole("button", { name: "Хүлээн авлаа" }));
    await waitFor(() =>
      expect(
        api.calls.some((call) => call.method === "POST" && call.url === `${INBOX}/a/acknowledge`),
      ).toBe(true),
    );

    await user.click(within(card).getByRole("button", { name: "Албан хариу өгөх" }));
    expect(
      within(card).getByText(/«Цэцэрлэгийн захиргаа · \d{4}\.\d{2}\.\d{2}» гэж автоматаар/),
    ).toBeInTheDocument();
    await user.type(within(card).getByLabelText(/Албан хариу/), "Тогоочтой ярилцлаа.");
    await user.click(within(card).getByRole("button", { name: "Илгээх" }));

    await waitFor(() =>
      expect(
        api.calls.find((call) => call.method === "POST" && call.url === `${INBOX}/a/reply`)?.body,
      ).toEqual({ body: "Тогоочтой ярилцлаа." }),
    );
  });

  it("draws the answer as a letter from the administration", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: INBOX,
        body: page([
          note("a", {
            status: "ANSWERED",
            reply: { body: "Цэсийг шинэчиллээ.", repliedAt: "2026-10-09T01:00:00.000Z" },
          }),
        ]),
      },
    ]);
    renderWithProviders(<FeedbackInboxPage />);

    const card = (await screen.findByText("Хоолны чанар муу байна.")).closest("li")!;
    expect(within(card).queryByRole("article")).toBeNull();
    await openNote(user, card);
    const letter = within(card).getByRole("article", { name: "Албан хариу" });
    expect(within(letter).getByText("Цэсийг шинэчиллээ.")).toBeInTheDocument();
    expect(within(letter).getByText("Цэцэрлэгийн захиргаа")).toBeInTheDocument();
  });

  /*
    ★ Sample notes until the endpoint exists — the client asked to see the
    inbox filled. Who sent each named one is spelled out; an anonymous one
    names nobody, not even a group.
  */
  it("shows sample notes with group, teacher and parent while the endpoint answers 404", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: INBOX, status: 404, body: { title: "Not found", status: 404 } },
    ]);
    renderWithProviders(<FeedbackInboxPage />);

    expect(await screen.findByText(/Жишээ санал хүсэлт харагдаж байна/)).toBeInTheDocument();
    const named = screen.getByText(/өдрийн хоол хүйтэн ирж байна/).closest("li")!;
    expect(within(named).getByText("Солонго бүлэг · Батболд Сараа (ээж)")).toBeInTheDocument();
    await openNote(user, named);
    expect(within(named).getByText("Батболд Сараа (ээж)")).toBeInTheDocument();
    expect(within(named).getByText("Тэмүүлэн")).toBeInTheDocument();
    expect(within(named).getByText("Солонго бүлэг")).toBeInTheDocument();
    expect(within(named).getByText("Д.Сувдаа")).toBeInTheDocument();

    const anonymous = screen.getByText(/Ногоо бага/).closest("li")!;
    await openNote(user, anonymous);
    expect(within(anonymous).getByText("Нэргүй")).toBeInTheDocument();
    expect(within(anonymous).queryByText(/бүлэг/)).toBeNull();
  });

  it("puts the group and the parent small above the category", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: INBOX,
        body: page([note("a", { groupName: "Нарлаг бүлэг", relation: "аав" })]),
      },
    ]);
    renderWithProviders(<FeedbackInboxPage />);

    const card = (await screen.findByText("Хоолны чанар муу байна.")).closest("li")!;
    const sender = within(card).getByText("Нарлаг бүлэг · Бат Сараа (аав)");
    const headline = within(card).getByText("Хоол, гал тогоо");
    expect(sender.className).toMatch(/text-caption/);
    expect(headline.className).toMatch(/text-body/);
    expect(within(card).queryByText("Шинэ")).toBeNull();
  });

  it("filters by group, sending the group's id", async () => {
    const GROUP = "55555555-5555-4555-8555-555555555555";
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: "/groups",
        body: page([{ id: GROUP, name: "Нарлаг", kindergartenId: KG }]),
      },
      { path: INBOX, body: page([note("a")]) },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackInboxPage />);
    await screen.findByText("Хоолны чанар муу байна.");

    await selectOption(user, "Бүлгээр шүүх", "Нарлаг бүлэг");
    await waitFor(() =>
      expect(api.calls.some((call) => call.url.includes(`groupId=${GROUP}`))).toBe(true),
    );
  });

  it("filters by status and by category", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: INBOX, status: 404, body: { title: "Not found", status: 404 } },
    ]);
    renderWithProviders(<FeedbackInboxPage />);
    await screen.findByText(/Жишээ санал хүсэлт харагдаж байна/);

    await user.click(screen.getByRole("button", { name: "Хариулсан" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/дүүжин эвдэрсэн/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Шинэ" }));
    await selectOption(user, "Чиглэлээр шүүх", "Хоол, гал тогоо");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    await selectOption(user, "Чиглэлээр шүүх", "Бүх чиглэл");
    await selectOption(user, "Бүлгээр шүүх", "Солонго бүлэг");
    for (const item of screen.getAllByRole("listitem")) {
      expect(within(item).getByText(/^Солонго бүлэг · /)).toBeInTheDocument();
    }
  });

  it("acknowledges and answers a sample note without sending anything", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: INBOX, status: 404, body: { title: "Not found", status: 404 } },
    ]);
    renderWithProviders(<FeedbackInboxPage />);

    const card = (await screen.findByText(/өдрийн хоол хүйтэн ирж байна/)).closest("li")!;
    await openNote(user, card);
    await user.click(within(card).getByRole("button", { name: "Хүлээн авлаа" }));
    // It moves out of «Шинэ» and under «Хүлээн авсан».
    await waitFor(() => expect(screen.queryByText(/өдрийн хоол хүйтэн ирж байна/)).toBeNull());
    await user.click(screen.getByRole("button", { name: "Хүлээн авсан" }));
    const moved = screen.getByText(/өдрийн хоол хүйтэн ирж байна/).closest("li")!;
    await openNote(user, moved);

    await user.click(within(moved).getByRole("button", { name: "Албан хариу өгөх" }));
    await user.type(within(moved).getByLabelText(/Албан хариу/), "Шалгалаа.");
    await user.click(within(moved).getByRole("button", { name: "Илгээх" }));
    await waitFor(() => expect(screen.queryByText(/өдрийн хоол хүйтэн ирж байна/)).toBeNull());
    await user.click(screen.getByRole("button", { name: "Хариулсан" }));
    const answered = screen.getByText(/өдрийн хоол хүйтэн ирж байна/).closest("li")!;
    await openNote(user, answered);
    expect(within(answered).getByRole("article", { name: "Албан хариу" })).toBeInTheDocument();
    expect(api.calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("removes a note from the inbox through ⋯, after asking", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: `${INBOX}/a`, method: "DELETE", status: 204, body: null },
      { path: INBOX, body: page([note("a")]) },
    ]);
    renderWithProviders(<FeedbackInboxPage />);

    const card = (await screen.findByText("Хоолны чанар муу байна.")).closest("li")!;
    await user.click(within(card).getByRole("button", { name: /үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: "Устгах" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/Эцэг эх өөрийн илгээсэн санал, хариугаа харсаар/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Устгах" }));

    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "DELETE" && call.url === `${INBOX}/a`)).toBe(
        true,
      ),
    );
  });
});

describe("a guardian's page", () => {
  function renderParent() {
    return renderWithProviders(
      <SelectedChildProvider myChildIds={[CHILD]}>
        <FeedbackPage />
      </SelectedChildProvider>,
    );
  }

  it("sends a note anonymously, through the selected child", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: MINE, method: "POST", status: 201, body: note("n", { anonymous: true }) },
      { path: MINE, body: page([]) },
    ]);
    renderParent();

    expect(screen.queryByLabelText(/Санал, хүсэлт/)).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Санал хүсэлт" }));
    await selectOption(user, /^Чиглэл( \*)?$/, "Хоол, гал тогоо");
    await user.type(screen.getByLabelText(/Санал, хүсэлт/), "Хоол хүйтэн ирдэг.");
    await user.click(screen.getByLabelText(/Нэрээ нууж илгээх/));
    expect(screen.getByText(/албан хариу ирэхгүй/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Илгээх" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST" && call.url === MINE)?.body).toEqual({
        childId: CHILD,
        category: "FOOD",
        body: "Хоол хүйтэн ирдэг.",
        anonymous: true,
        relation: null,
      }),
    );
    expect(await screen.findByText("Санал хүсэлт илгээгдлээ.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Санал, хүсэлт/)).toBeNull();
  });

  it("asks a named sender whether they are the mother or the father", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: MINE, method: "POST", status: 201, body: note("n", { relation: "аав" }) },
      { path: MINE, body: page([]) },
    ]);
    renderParent();

    await user.click(await screen.findByRole("button", { name: "Санал хүсэлт" }));
    await selectOption(user, /^Чиглэл( \*)?$/, "Ариун цэвэр");
    await user.type(screen.getByLabelText(/Санал, хүсэлт/), "Саван алга.");
    expect(screen.getByRole("button", { name: "Илгээх" })).toBeDisabled();
    await selectOption(user, /Та хүүхдийн хэн бэ/, "Аав");
    await user.click(screen.getByRole("button", { name: "Илгээх" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST" && call.url === MINE)?.body).toEqual({
        childId: CHILD,
        category: "HYGIENE",
        body: "Саван алга.",
        anonymous: false,
        relation: "FATHER",
      }),
    );
  });

  it("sorts their own notes under their status, with no badge on the row", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: MINE,
        body: page([
          note("a", { status: "ACKNOWLEDGED" }),
          note("b", {
            body: "Тоглоомын талбай эвдэрсэн.",
            category: "FACILITY",
            status: "ANSWERED",
            reply: { body: "Засварлалаа.", repliedAt: "2026-10-09T01:00:00.000Z" },
          }),
        ]),
      },
    ]);
    renderParent();

    expect(await screen.findByText("Тохирох санал алга")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Хүлээн авсан" }));
    const first = screen.getByText("Хоолны чанар муу байна.").closest("li")!;
    expect(within(first).queryByText("Хүлээн авсан")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Хариулсан" }));
    const second = screen.getByText("Тоглоомын талбай эвдэрсэн.").closest("li")!;
    expect(within(second).queryByText("Хариулсан")).toBeNull();
    expect(within(second).getByText("Албан хариу ирсэн")).toBeInTheDocument();
    await openNote(user, second);
    const letter = within(second).getByRole("article", { name: "Албан хариу" });
    expect(within(letter).getByText("Засварлалаа.")).toBeInTheDocument();
  });

  it("shows sample notes and filters them while the endpoint answers 404", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: MINE, status: 404, body: { title: "Not found", status: 404 } },
    ]);
    renderParent();

    expect(await screen.findByText(/Жишээ санал хүсэлт харагдаж байна/)).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Миний илгээсэн" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    await user.click(within(list).getByRole("button", { name: "Хариулсан" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await openNote(user, within(list).getByRole("listitem"));
    expect(within(list).getByRole("article", { name: "Албан хариу" })).toBeInTheDocument();
  });

  it("removes one of their own notes from the list through ⋯", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: MINE, status: 404, body: { title: "Not found", status: 404 } },
    ]);
    renderParent();

    await screen.findByText(/Жишээ санал хүсэлт харагдаж байна/);
    const list = screen.getByRole("region", { name: "Миний илгээсэн" });
    await user.click(within(list).getByRole("button", { name: "Хариулсан" }));
    const card = within(list)
      .getByText(/дүүжин эвдэрсэн/)
      .closest("li")!;
    await user.click(within(card).getByRole("button", { name: /үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: "Устгах" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Устгах" }));

    await waitFor(() => expect(within(list).queryByText(/дүүжин эвдэрсэн/)).toBeNull());
  });
});
