import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders, sessionFor, setPathname, stubApi } from "./support/render";
import AppLayout from "@/app/(app)/layout";
import { PageHeader } from "@/components/shell/app-shell";

/**
 * The rail's own controls, and the back control the page header now derives.
 *
 * ★ Rendered through `AppLayout` for the same reason `sidebar.test.tsx` is:
 * the menu — and therefore the set of hrefs `useAutoBackHref` walks — is built
 * by the layout from the session. A hand-made `nav` array would test the
 * chrome and skip the part that can be wrong.
 *
 * ★★ These cover three things the client asked for on 2026-09-19: hide/show
 * the rail, drag it wider, and a Буцах on every inner screen rather than on
 * the four that happened to pass `backHref`.
 */

const GROUPS = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };

function renderShell(
  pathname = "/dashboard",
  children: React.ReactNode = <p>содержимое</p>,
  roles: Parameters<typeof sessionFor>[0] = ["TEACHER"],
  ownChildren: unknown[] = [],
) {
  setPathname(pathname);
  stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: "/groups", body: GROUPS },
    { path: "/children/mine", body: ownChildren },
    { path: "/notifications/unread-count", body: { count: 0 } },
  ]);

  return renderWithProviders(<AppLayout>{children}</AppLayout>);
}

const sidebar = () => screen.findByRole("navigation", { name: "Үндсэн цэс" });

beforeEach(() => {
  window.localStorage.clear();
});

describe("the derived back control", () => {
  it("is absent on a screen the menu links to directly", async () => {
    renderShell("/dashboard", <PageHeader title="Хяналтын самбар" />);
    await sidebar();

    // "Back" from the screen signing in lands you on is not a thing a person
    // means.
    expect(screen.queryByRole("link", { name: "Буцах" })).not.toBeInTheDocument();
  });

  it("still lets a screen say it wants none", async () => {
    renderShell(
      "/children/66666666-6666-4666-8666-666666666666/general",
      <PageHeader title="Батмөнх Тэмүүлэн" backHref={null} />,
    );
    await sidebar();

    expect(screen.queryByRole("link", { name: "Буцах" })).not.toBeInTheDocument();
  });
});

describe("the masthead", () => {
  it("never points a signed-in person at the public root", async () => {
    renderShell();
    const nav = await sidebar();

    // `/` renders the landing page until `/auth/me` answers, which is the
    // flash reported as "glitch хийгээд байна".
    for (const link of within(nav).getAllByRole("link")) {
      expect(link).not.toHaveAttribute("href", "/");
    }
  });
});
