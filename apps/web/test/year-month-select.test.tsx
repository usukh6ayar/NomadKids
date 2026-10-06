import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { selectOption } from "./support/render";
import { YearMonthSelect } from "@/components/ui/year-month-select";

/** Client, 2026-10-06: the month as «Он» and «Сар», two small pickers. */
function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <YearMonthSelect value={value} onValueChange={setValue} />
      <output>{value}</output>
    </>
  );
}

describe("YearMonthSelect", () => {
  it("splits the month into a year and a month, and keeps the other when one changes", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-10" />);

    // Radix triggers show the chosen option's text.
    expect(screen.getByLabelText("Он")).toHaveTextContent("2026");
    expect(screen.getByLabelText("Сар")).toHaveTextContent("10-р сар");

    await selectOption(user, "Он", "2025");
    expect(screen.getByRole("status")).toHaveTextContent("2025-10");

    await selectOption(user, "Сар", "3-р сар");
    expect(screen.getByRole("status")).toHaveTextContent("2025-03");
  });

  it("offers the year it is given even when it is far back", () => {
    render(<Harness initial="2001-01" />);
    expect(screen.getByLabelText("Он")).toHaveTextContent("2001");
  });
});
