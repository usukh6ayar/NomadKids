import { screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import ChildGeneralPage from "@/app/(app)/children/[childId]/general/page";
import LoginPage from "@/app/login/page";
import { GALLERY } from "@/lib/vocabulary";

/**
 * One noun per thing, and one primary action per screen.
 *
 * ★ These are the audit's judgement calls, which is why they are pinned
 * differently from the defects.
 *
 * A defect has a right answer — a dangling `aria-labelledby` names nothing, and
 * that is true regardless of taste. These are decisions: that "Хавтас" should
 * mean exactly one thing, that a hero row should carry one call to action, that
 * a control which ignores its own input should not exist. Someone could
 * reasonably decide otherwise later. What these tests prevent is deciding
 * otherwise *by accident*, one call site at a time, which is how five meanings
 * of one word accumulated in the first place.
 */

const CHILD_ID = "44444444-4444-4444-8444-444444444444";
const WEB_ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Occurrences outside comments — the docblocks quote the retired spellings. */
function inMarkup(needle: string): string[] {
  const found: string[] = [];
  let inBlock = false;

  for (const file of [
    ...sourceFiles(join(WEB_ROOT, "app")),
    ...sourceFiles(join(WEB_ROOT, "components")),
  ]) {
    const relative = file.slice(WEB_ROOT.length + 1);
    inBlock = false;

    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const wasInBlock = inBlock;
        const opens = (line.match(/\/\*/g) ?? []).length;
        const closes = (line.match(/\*\//g) ?? []).length;
        if (opens > closes) inBlock = true;
        else if (closes > opens) inBlock = false;

        const trimmed = line.trimStart();
        const isProse =
          wasInBlock || trimmed.startsWith("*") || trimmed.startsWith("//") || opens > 0;

        if (!isProse && line.includes(needle)) found.push(`${relative}:${index + 1}`);
      });
  }

  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID });
  setSearchParams("");
});

describe("one noun per thing", () => {
  /**
   * The five that were all "Хавтас", plus the album's two names. Each entry is
   * a spelling that used to name something this product still has — so a match
   * is a regression rather than an unrelated string that happens to collide.
   */
  it.each([
    ["Хөгжлийн хавтас", "the parent's children list"],
    ["Хүүхдийн хавтас", "the phone header's brand"],
    ["Зураг, бүтээл", "the album, inside the portfolio"],
    ["Хүүхдийн хөгжлийн", "the sidebar's brand"],
  ])("%s is retired (%s)", (retired) => {
    expect(inMarkup(retired)).toEqual([]);
  });

  it("the album is named the same on the tab and in the portfolio", async () => {
    // Both call sites read the same constant, so the check that matters is that
    // neither has drifted back to a literal.
    expect(inMarkup('label="Цомог"')).toEqual([]);
    expect(GALLERY).toBe("Зургийн цомог");
  });
});

describe("the child hero", () => {
  function stubChild() {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}`,
        body: {
          id: CHILD_ID,
          lastName: "Ганболд",
          firstName: "Батбаяр",
          sex: "MALE",
          dateOfBirth: "2021-04-12",
          status: "ACTIVE",
          photoMediaFileId: null,
          enrollments: [],
          guardianships: [],
          kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Цэцэрлэг" },
          healthNotes: null,
        },
      },
    ]);
  }

  /**
   * ★ The count is the assertion.
   *
   * Five buttons was the finding; naming the three that remain would pass just
   * as well with a sixth added beside them, which is exactly how the row grew to
   * five. So this counts what is directly in the hero and checks that only one
   * of them is the filled primary.
   *
   * ★★ 2026-09-09 — the primary is the portfolio, not "Ажиглалт".
   *
   * This pinned the filled button's label to "Ажиглалт", which had been the
   * call to action since the child hub was split up. The hero now leads to
   * `portfolio` instead: it is the screen the client calls the emotional
   * centre of the product, and it is what a teacher opening a child's record
   * is usually going to. **Writing an observation did not become
   * unreachable** — `child-observations.tsx`, the portfolio's own "Хөгжил"
   * page and the group assessment sheet all still link `observations/new`,
   * which is what makes this a change of emphasis rather than a lost feature.
   *
   * The count is unchanged and remains the real guard here; only the name of
   * the one filled control moved.
   */
  /*
    ★ 2026-10-01, at the client's instruction: Улирлын тайлан and the ⋯ menu
    (Мэдээлэл засах) are gone from the hero. The portfolio is its one action.
  */
  it("offers the portfolio as the hero's only action", async () => {
    stubChild();
    renderWithProviders(<ChildGeneralPage />);

    const heading = await screen.findByRole("heading", { name: /Ганболд/ });
    const hero = heading.closest("div.rounded-card")!;
    const controls = within(hero as HTMLElement).queryAllByRole("button", { hidden: true });
    const links = within(hero as HTMLElement).getAllByRole("link");

    expect(links.length + controls.length, "the hero carries one control").toBe(1);
    expect(links[0]).toHaveTextContent("Цахим хувийн хавтас");
    expect(links[0]).toHaveAttribute("href", `/children/${CHILD_ID}/portfolio`);
  });

  it("no longer offers the term report or the ⋯ menu", async () => {
    stubChild();
    renderWithProviders(<ChildGeneralPage />);

    await screen.findByRole("heading", { name: /Ганболд/ });
    expect(screen.queryByRole("link", { name: /Улирлын тайлан/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Бусад үйлдэл" })).toBeNull();
  });
});

describe("signing in", () => {
  it("uses the supplied responsive login artwork and transparent brand logo", () => {
    stubApi([{ path: "/auth/me", body: sessionFor([]) }]);

    renderWithProviders(<LoginPage />);

    const hero = screen.getByTestId("login-hero");
    expect(hero).toHaveClass("bg-[url('/background/login-mobile.png')]");
    expect(hero).toHaveClass("lg:bg-[url('/background/login-desktop.png')]");
    expect(screen.getByAltText("Бяцхан нүүдэлчид").getAttribute("src")).toContain("brand-logo.png");
    expect(screen.getByAltText("Од руу зааж буй хоёр хүүхэд").getAttribute("src")).toContain(
      "nomadkids-cta-children.png",
    );
  });

  /** The client's drawing, 2026-10-02: their wording in, the old taglines out. */
  it("names the product as drawn and drops the old taglines", () => {
    stubApi([{ path: "/auth/me", body: sessionFor([]) }]);

    renderWithProviders(<LoginPage />);

    const hero = screen.getByTestId("login-hero");
    expect(within(hero).getByText("Цэцэрлэгийн ухаалаг цахим систем")).toBeInTheDocument();
    expect(within(hero).getByRole("heading", { level: 1, name: "NomadKids" })).toBeInTheDocument();
    expect(within(hero).getByText("Цахимжуулах цогц шийдэл")).toBeInTheDocument();
    expect(
      within(hero).getByText("Өөрийн эрхээр нэвтэрч, ажлаа үргэлжлүүлнэ үү."),
    ).toBeInTheDocument();
    expect(within(hero).getByRole("link", { name: "Байгууллагын бүртгэл" })).toHaveAttribute(
      "href",
      "/register",
    );
    for (const gone of [
      /жаргалтай мөч бүр/,
      /нэг орчинд холбосон/,
      /Тавтай морил/,
      /нэг дороос үргэлжлүүлээрэй/,
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it("shows the five supplied audience characters in the requested order", () => {
    stubApi([{ path: "/auth/me", body: sessionFor([]) }]);

    renderWithProviders(<LoginPage />);

    const section = screen
      .getByRole("heading", { name: "Бүх оролцогчдод зориулсан шийдэл" })
      .closest("section");
    expect(section).not.toBeNull();

    const audience = within(section!);
    expect(
      audience.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
    ).toEqual([
      "Багшийн веб",
      "Эцэг эхийн веб",
      "Удирдлагын самбар",
      "Гал тогооны веб",
      "Нягтлангийн веб",
    ]);
    expect(audience.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual([
      "Багш",
      "Эцэг эх хүүхдийн хамт",
      "Удирдлагын ажилтан",
      "Тогооч",
      "Нягтлан бодогч",
    ]);
  });

  /**
   * ★ The tabs asked a question the API never received.
   *
   * Багш and Админ set the identifier label to byte-identical strings, and the
   * choice was never sent — login takes `identifier` and `password`, and the
   * role comes from `Membership` afterwards. Someone who picked the wrong tab
   * signed in exactly as well.
   */
  it("asks for one identifier and names everything it accepts", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor([]) }]);

    renderWithProviders(<LoginPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/Утасны дугаар эсвэл нэвтрэх нэр/)).toBeInTheDocument(),
    );

    expect(screen.queryByRole("group", { name: "Хэрэглэгчийн төрөл" })).toBeNull();
    for (const role of ["Багш", "Эцэг эх", "Админ"]) {
      expect(screen.queryByRole("button", { name: role })).toBeNull();
    }
  });
});
