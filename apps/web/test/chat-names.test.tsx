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
