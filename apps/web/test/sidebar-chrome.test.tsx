import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const OWN_CHILD = {
  id: "66666666-6666-4666-8666-666666666666",
  lastName: "Батмөнх",
  firstName: "Тэмүүлэн",
  dateOfBirth: "2021-04-02",
  sex: "MALE",
  photoMediaFileId: null,
  group: null,
};

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

describe("hiding and showing the rail", () => {
  it("removes the menu from the page, and brings it back", async () => {
    renderShell();
    await sidebar();

    await userEvent.click(screen.getByRole("button", { name: "Хажуугийн цэсийг хаах" }));

    /*
     * ★ Gone from the tree, not merely narrow. A `width: 0` rail keeps every
     * link in the tab order and keeps announcing a navigation landmark the
     * reader has just put away — so the assertion is absence, which is also
     * the thing a `hidden` class would let pass.
     */
    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: "Үндсэн цэс" })).not.toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Хажуугийн цэсийг нээх" }));
    expect(await sidebar()).toBeInTheDocument();
  });

  /*
   * ★ ☰ in the top bar — 2026-09-26, the client's choice of four: the
   * ministry SIS's layout. One control, always in the same place, that hides
   * the menu entirely and brings it back; nothing floats on the seam and
   * nothing lives inside the menu it is hiding.
   */
  it("toggles from one ☰ in the top bar, never from a button on the seam", async () => {
    renderShell();
    const menu = await sidebar();

    const hide = screen.getAllByRole("button", { name: "Хажуугийн цэсийг хаах" });
    expect(hide).toHaveLength(1);
    expect(menu).not.toContainElement(hide[0]!);
    expect(hide[0]!.closest("header")).not.toBeNull();
    expect(hide[0]).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(hide[0]!);
    const show = await screen.findByRole("button", { name: "Хажуугийн цэсийг нээх" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    // The same control in the same bar, not a second one somewhere else.
    expect(show.closest("header")).toBe(hide[0]!.closest("header"));
  });

  it("remembers the choice for the next visit", async () => {
    renderShell();
    await sidebar();

    await userEvent.click(screen.getByRole("button", { name: "Хажуугийн цэсийг хаах" }));

    // A menu width is a property of the screen someone is sitting at, not of
    // their account — hence storage rather than a column on `User`.
    await waitFor(() => expect(window.localStorage.getItem("nk.sidebar.collapsed")).toBe("true"));
  });
});

describe("resizing the rail", () => {
  it("is a separator the arrow keys move, not a pointer-only handle", async () => {
    renderShell();
    await sidebar();

    const handle = screen.getByRole("separator", { name: "Хажуугийн цэсний өргөн" });
    const before = Number(handle.getAttribute("aria-valuenow"));

    handle.focus();
    await userEvent.keyboard("{ArrowRight}");

    const after = Number(
      screen
        .getByRole("separator", { name: "Хажуугийн цэсний өргөн" })
        .getAttribute("aria-valuenow"),
    );
    expect(after).toBeGreaterThan(before);
    await waitFor(() =>
      expect(window.localStorage.getItem("nk.sidebar.width")).toBe(String(after)),
    );
  });

  it("refuses to go narrower than the menu's own labels", async () => {
    renderShell();
    await sidebar();

    const handle = screen.getByRole("separator", { name: "Хажуугийн цэсний өргөн" });
    const min = Number(handle.getAttribute("aria-valuemin"));

    handle.focus();
    // Far more presses than the range allows, to land on the clamp.
    await userEvent.keyboard("{ArrowLeft>40/}");

    expect(
      Number(
        screen
          .getByRole("separator", { name: "Хажуугийн цэсний өргөн" })
          .getAttribute("aria-valuenow"),
      ),
    ).toBe(min);
  });

  it("goes away with the rail — there is nothing to size when it is hidden", async () => {
    renderShell();
    await sidebar();

    await userEvent.click(screen.getByRole("button", { name: "Хажуугийн цэсийг хаах" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("separator", { name: "Хажуугийн цэсний өргөн" }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("the derived back control", () => {
  it("is absent on a screen the menu links to directly", async () => {
    renderShell("/dashboard", <PageHeader title="Хяналтын самбар" />);
    await sidebar();

    // "Back" from the screen signing in lands you on is not a thing a person
    // means.
    expect(screen.queryByRole("link", { name: "Буцах" })).not.toBeInTheDocument();
  });

  it("appears on an inner screen that never asked for one", async () => {
    renderShell(
      "/children/66666666-6666-4666-8666-666666666666/general",
      <PageHeader title="Батмөнх Тэмүүлэн" />,
    );
    await sidebar();

    const back = await screen.findByRole("link", { name: "Буцах" });
    /*
     * ★ `/children`, not `/children/:id`. The href is only followed on a page
     * opened cold — a pasted link, a refresh — so it has to be a route that
     * exists, and the child's own path has no page of its own. Walking up to
     * the nearest destination the menu names is what guarantees that.
     */
    expect(back).toHaveAttribute("href", "/children");
  });

  it("draws exactly one, inside the header, on the title's own row", async () => {
    /*
     * ★ Both halves matter, and the second is what went wrong.
     *
     * `platform/[id]/esis` drew its own `<BackButton>` on a row **above** its
     * `PageHeader` — the only screen in the product where Буцах was not on the
     * title's line — and once the header began deriving one it was two arrows
     * stacked on each other. Every other screen that renders its own puts it
     * in a `flex items-center` row beside the heading, which is exactly what
     * `PageHeader` does; this pins that shape rather than trusting it.
     */
    renderShell(
      "/children/66666666-6666-4666-8666-666666666666/general",
      <PageHeader title="Батмөнх Тэмүүлэн" />,
    );
    await sidebar();

    const backs = await screen.findAllByRole("link", { name: "Буцах" });
    expect(backs).toHaveLength(1);

    // `closest<HTMLElement>`, because the bare call is typed `Element | null`
    // and `within()` wants an `HTMLElement`.
    const header = backs[0]!.closest<HTMLElement>('[data-ui="page-header"]');
    expect(header).not.toBeNull();
    expect(within(header!).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Батмөнх Тэмүүлэн",
    );
  });

  it("gives a guardian a route from their own menu, four levels deep", async () => {
    /*
     * ★ A parent's menu is built around the child they have selected, so the
     * walk has more to find than a staff menu does — here `/children`, which
     * for a guardian redirects to their own child rather than 404ing. The
     * assertion worth making is not the exact string but that a guardian on a
     * deep portfolio route gets a destination **their** menu names: the
     * failure this guards against is a Буцах pointing at a path with no page,
     * which is what stripping one URL segment would produce.
     */
    renderShell(
      "/children/66666666-6666-4666-8666-666666666666/portfolio/growth/compare",
      <PageHeader title="Харьцуулалт" />,
      ["PARENT"],
      [OWN_CHILD],
    );

    const back = await screen.findByRole("link", { name: "Буцах" });
    const href = back.getAttribute("href") ?? "";
    expect(href.startsWith("/children")).toBe(true);
    // Never the public root, which is the landing page until /auth/me answers.
    expect(href).not.toBe("/");
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
