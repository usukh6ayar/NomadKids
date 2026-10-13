import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuideDialog } from "@/components/help/guide-dialog";
import { PARENT_GUIDES } from "@/lib/guides";

/*
 * ★ «Гарын авлага» — 2026-10-13, the user: a guide for every section of the
 * guardian's menu, made to look professional: grouped, searchable, numbered.
 */
describe("the guardian's guide", () => {
  it("groups every section and finds one by what its steps say", async () => {
    const user = userEvent.setup();
    render(<GuideDialog groups={PARENT_GUIDES} onClose={() => {}} />);

    for (const group of ["Хүүхдийн хөгжил", "Өдөр тутмын мэдээлэл", "Харилцаа", "Төлбөр"]) {
      expect(screen.getByRole("heading", { name: group })).toBeInTheDocument();
    }

    await user.type(screen.getByRole("searchbox", { name: "Гарын авлагаас хайх" }), "QPay");
    expect(screen.getByText("Үйлчилгээний эрх")).toBeVisible();
    expect(screen.queryByText("Дуу, шүлэг")).toBeNull();
    // A match opens on its own, steps numbered.
    expect(screen.getByText("Улирлаар эсвэл жилээр сонгож QPay-ээр төлнө.")).toBeVisible();

    await user.clear(screen.getByRole("searchbox", { name: "Гарын авлагаас хайх" }));
    await user.type(screen.getByRole("searchbox", { name: "Гарын авлагаас хайх" }), "ззз");
    expect(screen.getByText("Илэрц олдсонгүй. Өөр үгээр хайж үзнэ үү.")).toBeInTheDocument();
  });

  it("offers «Холбоо барих» when no guide answers", async () => {
    const user = userEvent.setup();
    const onContact = vi.fn();
    render(<GuideDialog groups={PARENT_GUIDES} onClose={() => {}} onContact={onContact} />);

    await user.click(screen.getByRole("button", { name: "Холбоо барих" }));
    expect(onContact).toHaveBeenCalled();
  });
});
