import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicInfoShell } from "@/components/public/public-info-shell";

/*
 * ★ The info pages' header — 2026-10-08, the client: the row of Нууцлал ·
 * Үйлчилгээний нөхцөл · Түгээмэл асуулт · Нэвтрэх went, and a ‹ back to the
 * home page took its place. The footer keeps the links.
 */
describe("the info pages' header", () => {
  function renderShell() {
    return render(
      <PublicInfoShell eyebrow="Нууцлал" title="Нууцлалын бодлого" description="…" updatedAt="2026">
        <p>Агуулга</p>
      </PublicInfoShell>,
    );
  }

  it("leads with ‹ back to the home page, and carries no link row", () => {
    const { container } = renderShell();
    const header = within(container.querySelector("header")!);

    expect(header.getByRole("link", { name: "Нүүр хуудас руу буцах" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(header.queryByRole("link", { name: "Нэвтрэх" })).toBeNull();
    expect(header.queryByRole("link", { name: "Үйлчилгээний нөхцөл" })).toBeNull();
    expect(screen.queryByText("Нэвтрэх хуудас")).toBeNull();
  });

  it("keeps the links in the footer", () => {
    const { container } = renderShell();
    const footer = within(container.querySelector("footer")!);

    expect(footer.getByRole("link", { name: "Үйлчилгээний нөхцөл" })).toHaveAttribute(
      "href",
      "/terms",
    );
    // Холбоо барих — 2026-10-08.
    expect(footer.getByRole("link", { name: "7213 4888" })).toHaveAttribute(
      "href",
      "tel:+97672134888",
    );
    expect(footer.getByRole("link", { name: "Facebook" })).toHaveAttribute(
      "href",
      "https://www.facebook.com/",
    );
  });
});
