import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoom as ChatRoomData, Role } from "@kinder/contracts";
import {
  ChatList,
  ChatRoom,
  chatRoomDisplayName,
  guardianChildName,
  type ChatChrome,
} from "@/components/chat/chat-widget";
import { DashboardChatPreview } from "@/components/dashboard/dashboard-chat-preview";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";

const GROUP_ROOM: ChatRoomData = {
  key: `group:${GROUP_ID}`,
  kind: "GROUP",
  kindergartenId: KINDERGARTEN_ID,
  groupId: GROUP_ID,
  name: "Бэлтгэл бүлэг",
  memberCount: 24,
  lastMessage: null,
  unreadCount: 0,
};

const STAFF_ROOM: ChatRoomData = {
  key: `staff:${KINDERGARTEN_ID}`,
  kind: "STAFF",
  kindergartenId: KINDERGARTEN_ID,
  groupId: null,
  name: "Бүх багш · Нархан цэцэрлэг",
  memberCount: 12,
  lastMessage: null,
  unreadCount: 0,
};

const chrome: ChatChrome = {
  Title: ({ className, children }) => <h2 className={className}>{children}</h2>,
};

function renderList(role: Role, rooms: ChatRoomData[]) {
  stubApi([{ path: "/auth/me", body: sessionFor([role]) }]);
  renderWithProviders(<ChatList rooms={rooms} loading={false} onOpen={vi.fn()} chrome={chrome} />);
}

describe("role-specific chat names", () => {
  it("calls a teacher's two real rooms Манай анги and Багш нар", async () => {
    renderList("TEACHER", [GROUP_ROOM, STAFF_ROOM]);

    expect(await screen.findByText("Манай анги")).toBeInTheDocument();
    expect(screen.getByText("Багш нар")).toBeInTheDocument();
    expect(screen.queryByText("Бүх багш · Нархан цэцэрлэг")).not.toBeInTheDocument();
  });

  it("describes the shared group room to a parent by its real audience", async () => {
    renderList("PARENT", [GROUP_ROOM]);

    expect(await screen.findByText("Багш, эцэг эхчүүд")).toBeInTheDocument();
    expect(screen.queryByText("Бэлтгэл бүлэг")).not.toBeInTheDocument();
  });

  it("shows management the short staff-room name", async () => {
    renderList("ADMIN", [STAFF_ROOM]);

    expect(await screen.findByText("Багш нар")).toBeInTheDocument();
  });

  it("uses the same short name in the teacher dashboard preview", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/chat/rooms", body: [GROUP_ROOM] },
    ]);
    renderWithProviders(<DashboardChatPreview />);

    expect((await screen.findAllByText(/Манай анги/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Бэлтгэл бүлэг/)).not.toBeInTheDocument();
  });

  it("keeps group and kindergarten qualifiers when otherwise identical labels repeat", () => {
    const secondGroup = {
      ...GROUP_ROOM,
      key: "group:55555555-5555-4555-8555-555555555555",
      groupId: "55555555-5555-4555-8555-555555555555",
      name: "Ахлах бүлэг",
    };
    const roles = new Set<Role>(["TEACHER"]);

    expect(chatRoomDisplayName(GROUP_ROOM, roles, [GROUP_ROOM, secondGroup])).toBe(
      "Манай анги · Бэлтгэл бүлэг",
    );
    expect(chatRoomDisplayName(secondGroup, roles, [GROUP_ROOM, secondGroup])).toBe(
      "Манай анги · Ахлах бүлэг",
    );
  });
});

/**
 * A teacher's list in two tiers — client, 2026-10-04: the general rooms on top,
 * the one-per-family private rooms folded under «Эцэг эхчүүд», and a private
 * room with something unread drawn above the fold.
 */
describe("a teacher's private rooms", () => {
  const direct = (n: number, unreadCount = 0): ChatRoomData => ({
    key: `direct:${n}`,
    kind: "DIRECT",
    kindergartenId: KINDERGARTEN_ID,
    groupId: null,
    name: `Хүүхэд${n}-ийн ээж`,
    memberCount: 2,
    lastMessage: null,
    unreadCount,
  });

  it("folds them under one row, keeping the general rooms on top", async () => {
    renderList("TEACHER", [direct(1), STAFF_ROOM, direct(2), GROUP_ROOM]);

    const toggle = await screen.findByRole("button", { name: /Эцэг эхчүүд \(2\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Хүүхэд1")).not.toBeInTheDocument();

    const names = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(names[0]).toContain("Манай анги");
    expect(names[1]).toContain("Багш нар");

    await userEvent.click(toggle);
    expect(screen.getByText("Хүүхэд1")).toBeInTheDocument();
    expect(screen.getByText("Хүүхэд2")).toBeInTheDocument();
  });

  it("draws one with an unread message above the fold", async () => {
    renderList("TEACHER", [GROUP_ROOM, STAFF_ROOM, direct(1), direct(2, 3)]);

    // The session resolves first; until then the list is flat.
    await screen.findByRole("button", { name: /Эцэг эхчүүд \(2\)/ });
    expect(screen.getByText("Хүүхэд2")).toBeInTheDocument();
    expect(screen.queryByText("Хүүхэд1")).not.toBeInTheDocument();
  });

  it("shows every match while searching", async () => {
    renderList("TEACHER", [GROUP_ROOM, direct(1), direct(2)]);

    await userEvent.type(await screen.findByRole("searchbox"), "Хүүхэд1");
    expect(screen.getByText("Хүүхэд1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Эцэг эхчүүд/ })).not.toBeInTheDocument();
  });

  it("gives a parent no fold", async () => {
    renderList("PARENT", [GROUP_ROOM]);

    await screen.findByText("Багш, эцэг эхчүүд");
    expect(screen.queryByRole("button", { name: /Эцэг эхчүүд \(/ })).not.toBeInTheDocument();
  });
});

/**
 * A parent's chat is three rooms, in this order — client, 2026-10-04:
 * «Багш, эцэг эхчүүд», «Эцэг эхчүүд» (no teacher), «Бүлгийн багш» (private).
 */
describe("a parent's three rooms", () => {
  const PARENTS_ROOM: ChatRoomData = {
    ...GROUP_ROOM,
    key: `parents:${GROUP_ID}`,
    kind: "PARENTS",
    name: "Бэлтгэл бүлэг · эцэг эхчүүд",
  };
  const TEACHER_DIRECT: ChatRoomData = {
    ...GROUP_ROOM,
    key: "direct:teacher",
    kind: "DIRECT",
    groupId: null,
    name: "Дорж Сувдаа",
    memberCount: 2,
  };
  const PARENT_DIRECT: ChatRoomData = {
    ...TEACHER_DIRECT,
    key: "direct:parent",
    name: "Г.Батбаярын ээж",
  };

  it("draws them in order, the private one as Бүлгийн багш, and no parent-to-parent room", async () => {
    renderList("PARENT", [PARENT_DIRECT, TEACHER_DIRECT, PARENTS_ROOM, GROUP_ROOM]);

    await screen.findByText("Бүлгийн багш");
    const rows = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Багш, эцэг эхчүүд");
    expect(rows[1]).toContain("Эцэг эхчүүд");
    expect(rows[2]).toContain("Бүлгийн багш");
    expect(screen.queryByText(/Батбаяр/)).not.toBeInTheDocument();
    expect(screen.queryByText("Дорж Сувдаа")).not.toBeInTheDocument();
  });

  it("names each teacher when a family has two", () => {
    const second = { ...TEACHER_DIRECT, key: "direct:teacher2", name: "Бат Ану" };
    const roles = new Set<Role>(["PARENT"]);
    expect(chatRoomDisplayName(TEACHER_DIRECT, roles, [TEACHER_DIRECT, second])).toBe(
      "Бүлгийн багш · Дорж Сувдаа",
    );
  });
});

/**
 * A family by the child's name alone, a teacher as «Бүлгийн багш» — client,
 * 2026-10-04: "Г.Батбаяр зүгээр дан нэрээрээ бай … багш чат бичихээр бүлгийн
 * багш гэж бичиг гарна".
 */
describe("who is speaking", () => {
  it("drops the relation from a private room's name", () => {
    const room = {
      ...GROUP_ROOM,
      key: "direct:1",
      kind: "DIRECT" as const,
      groupId: null,
      name: "Г.Батбаярын ээж, Г.Сараагийн ээж",
    };
    expect(chatRoomDisplayName(room, new Set<Role>(["TEACHER"]))).toBe("Г.Батбаяр, Г.Сараа");
    // A teacher, as another teacher's private room would name them, is left alone.
    expect(chatRoomDisplayName({ ...room, name: "Дорж Сувдаа" }, new Set<Role>(["TEACHER"]))).toBe(
      "Дорж Сувдаа",
    );
  });

  const messagesPath = (key: string) => `/chat/rooms/${encodeURIComponent(key)}/messages`;
  const message = (id: string, author: Record<string, unknown>, body: string) => ({
    id,
    roomKey: GROUP_ROOM.key,
    body,
    createdAt: "2026-10-04T04:32:00.000Z",
    author,
    mine: false,
    media: [],
  });

  it("names a family by the child and a teacher as Бүлгийн багш", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: messagesPath(GROUP_ROOM.key),
        body: {
          items: [
            message(
              "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
              {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
                lastName: "Ганболд",
                firstName: "Сарнай",
                children: [
                  {
                    id: "cccccccc-cccc-4ccc-8ccc-000000000001",
                    lastName: "Гантөмөр",
                    firstName: "Батбаяр",
                    photoMediaFileId: null,
                  },
                ],
              },
              "Маргааш ирнэ",
            ),
            message(
              "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
              { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002", lastName: "Дорж", firstName: "Сувдаа" },
              "Сайн байна уу",
            ),
          ],
          nextCursor: null,
        },
      },
    ]);
    renderWithProviders(<ChatRoom room={GROUP_ROOM} chrome={chrome} />);

    await screen.findByText("Маргааш ирнэ");
    expect(screen.getByText("Г.Батбаяр")).toBeInTheDocument();
    expect(screen.getByText("Бүлгийн багш")).toBeInTheDocument();
    expect(screen.queryByText(/эцэг эх$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Сарнай/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Сувдаа/)).not.toBeInTheDocument();
  });

  it("keeps people's names in the staff room", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: messagesPath(STAFF_ROOM.key),
        body: {
          items: [
            {
              ...message(
                "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
                {
                  id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000003",
                  lastName: "Дорж",
                  firstName: "Сувдаа",
                },
                "Хурал 3 цагт",
              ),
              roomKey: STAFF_ROOM.key,
            },
          ],
          nextCursor: null,
        },
      },
    ]);
    renderWithProviders(<ChatRoom room={STAFF_ROOM} chrome={chrome} />);

    await screen.findByText("Хурал 3 цагт");
    expect(screen.getByText("Д.Сувдаа")).toBeInTheDocument();
    expect(screen.queryByText("Бүлгийн багш")).not.toBeInTheDocument();
  });
});

/**
 * Undoing the API's «Г.Батбаярын ээж» — every ending `genitive()` writes, and
 * a teacher's plain name left alone (client, 2026-10-05: the child's name only).
 */
describe("a guardian's chat name, back to the child", () => {
  it.each([
    ["Г.Батбаярын ээж", "Г.Батбаяр"],
    ["Б.Сарнайн аав", "Б.Сарнай"],
    ["Д.Хулангийн ээж", "Д.Хулан"],
    ["О.Сараагийн өвөө/эмээ", "О.Сараа"],
    ["Б.Эрдэнийн ах/эгч", "Б.Эрдэнэ"],
    ["Т.Доржийн асран хамгаалагч", "Т.Дорж"],
    ["Э.Энхийн аав", "Э.Энх"],
  ])("%s → %s", (name, child) => {
    expect(guardianChildName(name)).toBe(child);
  });

  it("leaves a teacher's name alone", () => {
    expect(guardianChildName("Дорж Сувдаа")).toBeNull();
  });
});
