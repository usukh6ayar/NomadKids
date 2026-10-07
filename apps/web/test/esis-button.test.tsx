import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EsisButton } from "@/components/esis/esis-button";

/**
 * One «ESIS татах» everywhere — client, 2026-10-06: the same words, no icon,
 * the same secondary button, «Татаж байна…» while it works.
 */
describe("EsisButton", () => {
  it("reads «ESIS татах», with no icon", () => {
    render(<EsisButton />);
    const button = screen.getByRole("button", { name: "ESIS татах" });
    expect(button.querySelector("svg")).toBeNull();
    expect(button).toHaveAttribute("type", "button");
  });

  it("says «Татаж байна…» and rests while the pull runs", () => {
    render(<EsisButton pending />);
    const button = screen.getByRole("button", { name: "Татаж байна…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
