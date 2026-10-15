import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi, type RouteStub } from "./support/render";
import { StudentRosterTable } from "@/components/child/admin-roster";

/*
 * ★ «⋯ → Эцэг эхийн нууц үг сэргээх» on the roster — 2026-10-14, the user: a
 * teacher or a director resets a parent who lost the phone without opening the
 * child. One parent opens straight away; two are named first.
 */
afterEach(() => vi.unstubAllGlobals());

const CHILD = "55555555-5555-4555-8555-555555555555";
const MOTHER = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const FATHER = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const ROW = {
  id: CHILD,
  lastName: "Ганболд",
  firstName: "Батбаяр",
  sex: "MALE",
  dateOfBirth: "2021-04-12",
  enrollments: [],
};

const guardianship = (id: string, guardianId: string, relation: string, firstName: string) => ({
  id,
  relation,
  canView: true,
  guardian: { id: guardianId, lastName: "Бат", firstName, phone: null, email: null },
});

function detail(guardianships: unknown[]) {
  return {
    id: CHILD,
    lastName: "Ганболд",
    firstName: "Батбаяр",
    sex: "MALE",
    dateOfBirth: "2021-04-12",
    enrollments: [],
    guardianships,
  };
}

function renderRoster(guardianships: unknown[], extra: RouteStub[] = []) {
  const api = stubApi([
    ...extra,
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/children/${CHILD}`, body: detail(guardianships) },
  ]);
  renderWithProviders(<StudentRosterTable items={[ROW] as never} forTeacher />);
  return api;
}

async function openFromMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Ганболд Батбаяр — үйлдэл" }));
  await user.click(screen.getByRole("menuitem", { name: "Эцэг эхийн нууц үг сэргээх" }));
}

describe("a parent's password reset from the roster", () => {
  it("opens the check-first link straight away for the only parent", async () => {
    const user = userEvent.setup();
    const api = renderRoster(
      [guardianship("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", MOTHER, "MOTHER", "Мөнхзул")],
      [{ path: `/users/${MOTHER}/password-reset`, method: "POST", body: { resetToken: "tok-1" } }],
    );

    await openFromMenu(user);
    const dialog = await screen.findByRole("dialog", { name: "Нууц үг сэргээх" });
    expect(dialog).toHaveTextContent("Бат Мөнхзул");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Холбоос үүсгэх" }));

    await waitFor(() =>
      expect(api.calls.some((c) => c.url === `/users/${MOTHER}/password-reset`)).toBe(true),
    );
  });

  it("asks which parent when there are two", async () => {
    const user = userEvent.setup();
    renderRoster([
      guardianship("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", MOTHER, "MOTHER", "Мөнхзул"),
      guardianship("aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa", FATHER, "FATHER", "Ганболд"),
    ]);

    await openFromMenu(user);
    const which = await screen.findByRole("dialog", { name: "Аль эцэг эх?" });
    await user.click(within(which).getByRole("button", { name: /Бат Ганболд/ }));

    expect(await screen.findByRole("dialog", { name: "Нууц үг сэргээх" })).toHaveTextContent(
      "Бат Ганболд",
    );
  });

  it("says where to start when no parent is linked", async () => {
    const user = userEvent.setup();
    renderRoster([]);

    await openFromMenu(user);
    expect(await screen.findByText(/Энэ хүүхдэд холбогдсон эцэг эх алга/)).toBeInTheDocument();
  });

  it("says plainly that the API does not reset a parent yet", async () => {
    const user = userEvent.setup();
    renderRoster(
      [guardianship("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", MOTHER, "MOTHER", "Мөнхзул")],
      [{ path: `/users/${MOTHER}/password-reset`, method: "POST", status: 409, body: {} }],
    );

    await openFromMenu(user);
    const dialog = await screen.findByRole("dialog", { name: "Нууц үг сэргээх" });
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Холбоос үүсгэх" }));

    expect(
      await within(dialog).findByText(/Эцэг эхийн нууц үг сэргээх хэсэг хараахан бэлэн болоогүй/),
    ).toBeInTheDocument();
  });
});
