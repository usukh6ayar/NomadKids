import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, selectOption, sessionFor, stubApi } from "./support/render";
import { SelectedChildProvider } from "@/lib/selected-child";
import FeedbackPage from "@/app/(app)/feedback/page";
import FeedbackInboxPage from "@/app/(app)/surveys/feedback/page";

/*
 * ★ Санал хүсэлт — 2026-10-08 (`lib/feedback.ts`, `apps/api/src/feedback/`).
 * A guardian writes, the administration reads; a named note gets an official
 * answer and an anonymous one never names anyone.
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
    ★ 2026-10-12: the API answers, so a 404 is shown as the error it is —
    never a sample inbox in its place.
  */
  it("shows a 404 as an error, with no sample notes", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: INBOX, status: 404, body: { title: "Not found", status: 404 } },
    ]);
    renderWithProviders(<FeedbackInboxPage />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText(/Жишээ санал хүсэлт/)).toBeNull();
  });

  /*
    Who sent a named note is spelled out; an anonymous one names nobody, not
    even a group.
  */
  it("spells out the group, teacher and parent of a named note", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: INBOX,
        body: page([
          note("a", {
            author: { firstName: "Сараа", lastName: "Батболд", phone: "99112233" },
            relation: "ээж",
            groupName: "Солонго бүлэг",
            teacherName: "Д.Сувдаа",
          }),
          note("b", { body: "Ногоо бага байна.", anonymous: true, author: null, childName: null }),
        ]),
      },
    ]);
    renderWithProviders(<FeedbackInboxPage />);

    const named = (await screen.findByText("Хоолны чанар муу байна.")).closest("li")!;
    expect(within(named).getByText("Солонго бүлэг · Батболд Сараа (ээж)")).toBeInTheDocument();
    await openNote(user, named);
    expect(within(named).getByText("Батболд Сараа (ээж)")).toBeInTheDocument();
    expect(within(named).getByText("Тэмүүлэн")).toBeInTheDocument();
    expect(within(named).getByText("Солонго бүлэг")).toBeInTheDocument();
    expect(within(named).getByText("Д.Сувдаа")).toBeInTheDocument();

    const anonymous = screen.getByText("Ногоо бага байна.").closest("li")!;
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

  it("asks the server to filter by status and by category", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: INBOX, body: page([note("a")]) },
    ]);
    renderWithProviders(<FeedbackInboxPage />);
    await screen.findByText("Хоолны чанар муу байна.");
    expect(api.calls.some((call) => call.url.includes("status=NEW"))).toBe(true);

    await user.click(screen.getByRole("button", { name: "Хариулсан" }));
    await selectOption(user, "Чиглэлээр шүүх", "Хоол, гал тогоо");
    await waitFor(() =>
      expect(
        api.calls.some(
          (call) => call.url.includes("status=ANSWERED") && call.url.includes("category=FOOD"),
        ),
      ).toBe(true),
    );
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

  it("shows a 404 as an error, with no sample notes", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: MINE, status: 404, body: { title: "Not found", status: 404 } },
    ]);
    renderParent();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "Миний илгээсэн" });
    expect(within(list).queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText(/Жишээ санал хүсэлт/)).toBeNull();
  });

  it("removes one of their own notes from the list through ⋯", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `${MINE}/a`, method: "DELETE", status: 204, body: null },
      { path: MINE, body: page([note("a")]) },
    ]);
    renderParent();

    const list = await screen.findByRole("region", { name: "Миний илгээсэн" });
    const card = (await within(list).findByText("Хоолны чанар муу байна.")).closest("li")!;
    await user.click(within(card).getByRole("button", { name: /үйлдэл/ }));
    await user.click(screen.getByRole("menuitem", { name: "Устгах" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Устгах" }));

    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "DELETE" && call.url === `${MINE}/a`)).toBe(
        true,
      ),
    );
  });
});
