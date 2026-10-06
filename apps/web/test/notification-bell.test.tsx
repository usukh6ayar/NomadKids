import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setPathname, stubApi } from "./support/render";
import AppLayout from "@/app/(app)/layout";

/**
 * The bell names a notice by what it says, not when — client, 2026-10-06: no
 * "Өнөөдөр / … өмнө", the title instead, and the start of the text for a notice
 * with no title (new notices have none since 2026-09-25).
 */

const notice = (overrides: Record<string, unknown>) => ({
  id: "88888888-8888-4888-8888-888888888888",
  title: null,
  body: "Маргааш өглөө 10 цагт намрын өдөрлөг болно. Хувцсаа бэлдээрэй.",
  category: "EVENT",
  status: "PUBLISHED",
  isImportant: false,
  publishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  author: null,
  reads: [],
  likeCount: 0,
  likedByMe: false,
  media: [],
  targets: [],
  ...overrides,
});

function renderBell(items: unknown[]) {
  setPathname("/dashboard");
  stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: "/groups", body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 } },
    // Before the list: the stubs match by prefix.
    { path: "/notifications/unread-count", body: { count: items.length } },
    {
      path: "/notifications",
      body: { items, page: 1, pageSize: 5, total: items.length, totalPages: 1 },
    },
  ]);
  return renderWithProviders(
    <AppLayout>
      <p>агуулга</p>
    </AppLayout>,
  );
}

async function openBell() {
  const user = userEvent.setup();
  const bells = await screen.findAllByRole("button", { name: /^Мэдэгдэл, \d+ уншаагүй$/ });
  await user.click(bells[0]!);
  return screen.findByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("мэдэгдлийн хонх", () => {
  it("names an untitled notice by the start of its text, and prints no 'Өнөөдөр'", async () => {
    renderBell([notice({})]);
    const panel = await openBell();

    expect(await within(panel).findByText(/^Маргааш өглөө 10 цагт/)).toBeInTheDocument();
    expect(within(panel).queryByText("Өнөөдөр")).toBeNull();
  });

  it("names a titled notice by its title", async () => {
    renderBell([notice({ title: "Намрын өдөрлөг" })]);
    const panel = await openBell();

    expect(await within(panel).findByText("Намрын өдөрлөг")).toBeInTheDocument();
    expect(within(panel).queryByText(/^Маргааш өглөө/)).toBeNull();
  });
});
