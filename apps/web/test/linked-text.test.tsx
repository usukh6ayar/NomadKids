import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LinkedText, urlsIn } from "@/components/ui/linked-text";

/**
 * A link in a post's text — 2026-10-17, the client: it was printed as plain
 * text and could not be opened.
 */
describe("LinkedText", () => {
  it("turns an address into a link that opens in a new tab, and leaves the rest as text", () => {
    render(
      <p>
        <LinkedText text="Номын холбоос: https://nomadkids.mn/m/abc-123. Үзээрэй!" />
      </p>,
    );

    const link = screen.getByRole("link", { name: "https://nomadkids.mn/m/abc-123" });
    // The sentence's full stop is not part of the address.
    expect(link).toHaveAttribute("href", "https://nomadkids.mn/m/abc-123");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.closest("p")).toHaveTextContent(
      "Номын холбоос: https://nomadkids.mn/m/abc-123. Үзээрэй!",
    );
  });

  it("links www. with https, and never a javascript: address", () => {
    render(<LinkedText text="www.facebook.com/nomadkids эсвэл javascript:alert(1)" />);

    expect(screen.getByRole("link", { name: "www.facebook.com/nomadkids" })).toHaveAttribute(
      "href",
      "https://www.facebook.com/nomadkids",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("leaves an address an excerpt cut off as text", () => {
    const full = "Дэлгүүр: https://nomadkids.mn/m/abc-123456789";
    render(<LinkedText text="Дэлгүүр: https://nomadkids.mn/m/abc…" complete={urlsIn(full)} />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});
