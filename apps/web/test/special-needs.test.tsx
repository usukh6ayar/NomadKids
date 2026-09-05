import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { ChildHealth } from "@/components/child/child-health";

/**
 * Тусгай хэрэгцээ — Order А/261, kindergarten criterion 11.
 *
 * ★ What these protect is the split between what the state counts and what a
 * teacher acts on.
 *
 * The **category** is a closed reference list, because the ministry aggregates
 * it across kindergartens and free text would give every kindergarten its own
 * spelling of the same one. The **note** beside it is what a teacher actually
 * does on Monday morning. A change that showed one without the other would
 * still render a plausible section.
 *
 * ★★ And the authorship split: staff record, a family reads. The API answers
 * 404 to a guardian who posts one, so a form offered to them would be a
 * control that always fails.
 */

const CHILD = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";

const CATEGORIES = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "Хараа", code: "vision", order: 1 },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", name: "Хэл яриа", code: "speech", order: 3 },
];

function need(over: Record<string, unknown> = {}) {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    category: CATEGORIES[1],
    note: "Долоо хоногт 2 удаа ганцаарчилсан хичээл",
    documentNo: "КОМ-2026/114",
    assessedOn: "2026-03-02",
    endedOn: null,
    recordedBy: null,
    ...over,
  };
}

function health(over: Record<string, unknown> = {}) {
  return {
    allergies: [],
    medications: [],
    vaccinations: [],
    specialNeeds: [],
    healthNotes: null,
    ...over,
  };
}

function stubHealth(body: unknown, roles: Parameters<typeof sessionFor>[0] = ["TEACHER"]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles, ME) },
    { path: `/children/${CHILD}/health/special-needs/categories`, body: CATEGORIES },
    {
      path: `/children/${CHILD}/health/special-needs`,
      method: "POST",
      status: 201,
      body: need(),
    },
    { path: `/children/${CHILD}/health`, body },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

/**
 * Picks a category through the real control.
 *
 * ★ `userEvent.selectOptions` cannot drive this one — `Select` is Radix, whose
 * trigger is a `<button role="combobox">` and whose native `<select>` is
 * `aria-hidden` for assistive tech. `admin-users.test.tsx` records the same
 * constraint. Opening the listbox and clicking the option is what a person
 * does, and it is the only thing that works here.
 */
async function chooseCategory(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("combobox", { name: /Ангилал/ }));
  await user.click(await screen.findByRole("option", { name }));
}

describe("тусгай хэрэгцээ", () => {
  it("shows the category and the support note together", async () => {
    stubHealth(health({ specialNeeds: [need()] }));
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    // The category is what the state counts…
    expect(await screen.findByText("Хэл яриа")).toBeInTheDocument();
    // …and the note is what the teacher acts on. Neither stands alone.
    expect(screen.getByText("Долоо хоногт 2 удаа ганцаарчилсан хичээл")).toBeInTheDocument();
    expect(screen.getByText("КОМ-2026/114")).toBeInTheDocument();
  });

  it("tells an empty section what to do next", async () => {
    stubHealth(health());
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    expect(await screen.findByText("Бүртгэгдсэн тусгай хэрэгцээ алга")).toBeInTheDocument();
  });

  /**
   * ★ A guardian reads it and is offered nothing to press.
   *
   * `POST .../special-needs` is `@Roles("TEACHER", "ADMIN")` and answers 404
   * to anyone else, so a form here would fail every time it was submitted —
   * and the parent would blame themselves rather than the permission.
   */
  it("shows a guardian the record but no form and no controls", async () => {
    stubHealth(health({ specialNeeds: [need()] }), ["PARENT"]);
    renderWithProviders(<ChildHealth childId={CHILD} isStaff={false} />);

    expect(await screen.findByText("Хэл яриа")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Тусгай хэрэгцээ нэмэх" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Дуусгах" })).toBeNull();
    expect(screen.queryByRole("button", { name: /устгах/i })).toBeNull();
  });

  /**
   * ★ Ended, not gone — the ended allergies' rule applied to support.
   *
   * Withdrawn support was still once in place, and a teacher reading back
   * needs to know it was considered rather than never recorded. So an ended
   * record leaves the live list and appears under its own disclosure instead
   * of disappearing.
   */
  it("moves an ended record out of the live list without losing it", async () => {
    stubHealth(health({ specialNeeds: [need({ endedOn: "2026-06-01" })] }));
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    expect(await screen.findByText("Бүртгэгдсэн тусгай хэрэгцээ алга")).toBeInTheDocument();
    expect(screen.getByText("Дууссан бүртгэл (1)")).toBeInTheDocument();
  });

  /**
   * ★ No category is pre-selected, and Save stays disabled until one is.
   *
   * A pre-filled "Хараа" is a classification nobody chose, and this one goes
   * into a return the kindergarten signs its name to.
   */
  it("refuses to submit until a category is chosen", async () => {
    stubHealth(health());
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "Тусгай хэрэгцээ нэмэх" }));

    const save = await screen.findByRole("button", { name: "Хадгалах" });
    expect(save).toBeDisabled();

    await chooseCategory(user, "Хэл яриа");
    expect(save).toBeEnabled();
  });

  it("offers every category the API returns, plus an empty first option", async () => {
    stubHealth(health());
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "Тусгай хэрэгцээ нэмэх" }));

    await user.click(await screen.findByRole("combobox", { name: /Ангилал/ }));

    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["— Сонгоно уу —", "Хараа", "Хэл яриа"]);
  });

  it("posts the chosen category and the note to the child's own path", async () => {
    const { calls } = stubHealth(health());
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "Тусгай хэрэгцээ нэмэх" }));
    await chooseCategory(user, "Хараа");
    await user.type(
      screen.getByRole("textbox", { name: /Шаардлагатай дэмжлэг/ }),
      "Урд эгнээнд суулгах",
    );
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    const post = await vi.waitFor(() => {
      const found = calls.find((c) => c.method === "POST");
      if (!found) throw new Error("POST хийгдээгүй");
      return found;
    });

    expect(post.url).toContain(`/children/${CHILD}/health/special-needs`);
    const body = post.body as Record<string, unknown>;
    expect(body.categoryId).toBe(CATEGORIES[0]!.id);
    expect(body.note).toBe("Урд эгнээнд суулгах");
  });

  /**
   * ★ The categories are not fetched until the form is opened.
   *
   * A guardian never opens it at all, so requesting a picker's worth of rows
   * on every render of the health tab is a request most readers have no use
   * for.
   */
  it("does not fetch the category list until the form is opened", async () => {
    const { calls } = stubHealth(health());
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await screen.findByText("Бүртгэгдсэн тусгай хэрэгцээ алга");
    expect(calls.some((c) => c.url.includes("special-needs/categories"))).toBe(false);

    await user.click(screen.getByRole("button", { name: "Тусгай хэрэгцээ нэмэх" }));

    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.includes("special-needs/categories"))).toBe(true);
    });
  });
});
