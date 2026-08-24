import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Menu } from "@/components/ui/menu";

/**
 * The action menu's keyboard and screen-reader contract.
 *
 * ★ These exist because the menu is hand-written.
 *
 * A Radix dropdown brings its own tested behaviour; this one does not, so the
 * parts a library would have guaranteed are asserted here instead — the state
 * announced on the trigger, Escape closing *and* returning focus, and arrow
 * keys moving between entries. All three are invisible to anyone testing with
 * a mouse, which is exactly why they rot silently.
 */

const ITEMS = [
  { href: "/children", label: "Ажиглалт бичих" },
  { href: "/notifications/new", label: "Зарлал нийтлэх" },
  { href: "/children/new", label: "Хүүхэд бүртгэх" },
];

function renderMenu() {
  return render(<Menu ariaLabel="Шинээр үүсгэх" label="Үйлдэл" items={ITEMS} />);
}

describe("the action menu", () => {
  it("announces its state on the trigger and opens on click", async () => {
    const user = userEvent.setup();
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Үйлдэл" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Шинээр үүсгэх" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(ITEMS.length);
  });

  it("every entry is a link to somewhere — there are no dead entries", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Үйлдэл" }));

    for (const item of ITEMS) {
      expect(screen.getByRole("menuitem", { name: item.label })).toHaveAttribute("href", item.href);
    }
  });

  it("Escape closes it and puts focus back on the trigger", async () => {
    const user = userEvent.setup();
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Үйлдэл" });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // Without this, Escape drops focus onto <body> and a keyboard user has to
    // tab from the top of the page to get back to where they were.
    expect(trigger).toHaveFocus();
  });

  it("ArrowDown on the trigger opens it and lands on the first entry", async () => {
    const user = userEvent.setup();
    renderMenu();

    screen.getByRole("button", { name: "Үйлдэл" }).focus();
    await user.keyboard("{ArrowDown}");

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: ITEMS[0]!.label })).toHaveFocus();
  });

  it("the arrow keys walk the entries and wrap at the ends", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Үйлдэл" }));
    const entries = ITEMS.map((item) => screen.getByRole("menuitem", { name: item.label }));

    entries[0]!.focus();
    await user.keyboard("{ArrowDown}");
    expect(entries[1]!).toHaveFocus();

    await user.keyboard("{End}");
    expect(entries[2]!).toHaveFocus();

    // Past the last entry is the first one, not nowhere.
    await user.keyboard("{ArrowDown}");
    expect(entries[0]!).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(entries[2]!).toHaveFocus();
  });

  it("closes when a pointer goes down outside it", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Menu ariaLabel="Шинээр үүсгэх" label="Үйлдэл" items={ITEMS} />
        <p data-testid="outside">Гадна тал</p>
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Үйлдэл" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
