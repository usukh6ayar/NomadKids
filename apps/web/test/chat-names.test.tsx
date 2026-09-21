import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoom as ChatRoomData, Role } from "@kinder/contracts";
import { ChatList, chatRoomDisplayName, type ChatChrome } from "@/components/chat/chat-widget";
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

const PARENTS_ROOM: ChatRoomData = {
  key: `parents:${GROUP_ID}`,
  kind: "PARENTS",
  kindergartenId: KINDERGARTEN_ID,
  groupId: GROUP_ID,
  name: "Бэлтгэл бүлэг · эцэг эхчүүд",
  memberCount: 23,
  lastMessage: null,
  unreadCount: 0,
};

const DIRECT_ROOM: ChatRoomData = {
  key: "direct:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
  kind: "DIRECT",
  kindergartenId: KINDERGARTEN_ID,
  groupId: null,
  name: "Дорж Сарнай",
  memberCount: 2,
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
 * The two rooms added on 2026-09-20 — «багшгүй дан эцэг эхийн чат» and «эцэг
 * эх багш руу хувиараа бичих».
 */
describe("the parents' room and private rooms", () => {
  /*
   * ★ A private room keeps the API's name, which is the **other person**.
   * Rewriting it the way the group room is rewritten would label a
   * conversation with one named teacher "Манай анги", which misstates who can
   * read it — the one thing a chat label must never do.
   */
  it("names a private room after the other person, for either side", async () => {
    expect(chatRoomDisplayName(DIRECT_ROOM, new Set<Role>(["PARENT"]))).toBe("Дорж Сарнай");
    expect(chatRoomDisplayName(DIRECT_ROOM, new Set<Role>(["TEACHER"]))).toBe("Дорж Сарнай");
  });

  /* One parents' room needs no group qualifier; two do. */
  it("shortens a lone parents' room and qualifies two", async () => {
    expect(chatRoomDisplayName(PARENTS_ROOM, new Set<Role>(["PARENT"]), [PARENTS_ROOM])).toBe(
      "Эцэг эхчүүд",
    );

    const second: ChatRoomData = {
      ...PARENTS_ROOM,
      key: "parents:55555555-5555-4555-8555-555555555555",
      name: "Дунд бүлэг · эцэг эхчүүд",
    };
    expect(
      chatRoomDisplayName(PARENTS_ROOM, new Set<Role>(["PARENT"]), [PARENTS_ROOM, second]),
    ).toBe("Бэлтгэл бүлэг · эцэг эхчүүд");
  });

  /*
   * ★★ A parent's list shows both group rooms, distinguishably. They are the
   * same group and differ only in who is in them, so two rows reading the same
   * thing would be the worst possible outcome — a parent posting to the room
   * they thought excluded the teachers.
   */
  it("keeps the shared room and the parents-only room apart in a parent's list", async () => {
    renderList("PARENT", [GROUP_ROOM, PARENTS_ROOM, DIRECT_ROOM]);

    expect(await screen.findByText("Багш, эцэг эхчүүд")).toBeInTheDocument();
    expect(screen.getByText("Эцэг эхчүүд")).toBeInTheDocument();
    expect(screen.getByText("Дорж Сарнай")).toBeInTheDocument();
  });
});
