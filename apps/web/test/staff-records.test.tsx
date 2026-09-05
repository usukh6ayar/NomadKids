import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { StaffRecordsButton } from "@/components/admin/staff-records-dialog";

/**
 * Ажилтны хувийн хэрэг — Order А/261, шалгуур 51.
 *
 * ★ What these protect is the reading of a **missing end date**.
 *
 * `endedOn: null` means "still current" — an open-ended post, a certificate
 * with no expiry. Rendered as the em dash this product uses for an unknown
 * value it would say the opposite: that nobody knows when the person stopped.
 * That is the difference between a file an inspector can read and one they
 * cannot.
 */

const KG = "99999999-9999-4999-8999-999999999999";
const USER = { id: "11111111-1111-4111-8111-111111111111", lastName: "Дорж", firstName: "Оюун" };
const ME = "22222222-2222-4222-8222-222222222222";

const EXPERIENCE = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "EXPERIENCE",
  title: "Ахлах багш",
  issuer: "12-р цэцэрлэг",
  documentNo: null,
  note: null,
  startedOn: "2019-09-01",
  endedOn: null,
  createdBy: null,
};

const CERTIFICATE = {
  ...EXPERIENCE,
  id: "44444444-4444-4444-8444-444444444444",
  kind: "CERTIFICATE",
  title: "Хөгжлийн үнэлгээ",
  issuer: "Багшийн хөгжлийн төв",
  documentNo: "ГЭР-2024/882",
  startedOn: "2024-03-01",
  endedOn: "2029-03-01",
};

function stub(records: unknown[]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"], ME) },
    {
      path: `/kindergartens/${KG}/staff/${USER.id}/records`,
      method: "POST",
      status: 201,
      body: EXPERIENCE,
    },
    { path: `/kindergartens/${KG}/staff/${USER.id}/records`, body: records },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("ажилтны хувийн хэрэг", () => {
  it("lists a record with its kind, issuer and document number", async () => {
    stub([CERTIFICATE]);
    const user = userEvent.setup();
    renderWithProviders(<StaffRecordsButton user={USER} kindergartenId={KG} />);

    await user.click(screen.getByRole("button", { name: /Хувийн хэрэг/ }));

    expect(await screen.findByText("Хөгжлийн үнэлгээ")).toBeInTheDocument();
    expect(screen.getByText("Гэрчилгээ")).toBeInTheDocument();
    expect(screen.getByText("Багшийн хөгжлийн төв")).toBeInTheDocument();
    expect(screen.getByText("№ ГЭР-2024/882")).toBeInTheDocument();
  });

  /**
   * ★ The one that matters.
   *
   * "одоог хүртэл", never a dash. A current post is a fact about the person;
   * the dash would report it as missing data.
   */
  it("reads a missing end date as 'still current', not as unknown", async () => {
    stub([EXPERIENCE]);
    const user = userEvent.setup();
    renderWithProviders(<StaffRecordsButton user={USER} kindergartenId={KG} />);

    await user.click(screen.getByRole("button", { name: /Хувийн хэрэг/ }));

    expect(await screen.findByText(/одоог хүртэл/)).toBeInTheDocument();
  });

  it("tells an empty file what it is for", async () => {
    stub([]);
    const user = userEvent.setup();
    renderWithProviders(<StaffRecordsButton user={USER} kindergartenId={KG} />);

    await user.click(screen.getByRole("button", { name: /Хувийн хэрэг/ }));

    expect(await screen.findByText("Бүртгэл алга")).toBeInTheDocument();
  });

  /**
   * ★ A super-admin listing users across the platform has no single
   * kindergarten to file against, so the control is absent rather than present
   * and failing. A button that 404s teaches people the app is broken.
   */
  it("offers nothing when there is no kindergarten in scope", () => {
    stub([]);
    renderWithProviders(<StaffRecordsButton user={USER} kindergartenId={null} />);

    expect(screen.queryByRole("button", { name: /Хувийн хэрэг/ })).toBeNull();
  });

  /**
   * ★ The delete confirmation steers a finished post to the end-date field.
   *
   * Deleting is for a row that was never true; a post that ended is history the
   * file is supposed to keep. The copy has to say which is which, because the
   * two look identical from the row.
   */
  it("confirms a delete and points at the end date instead", async () => {
    stub([EXPERIENCE]);
    const user = userEvent.setup();
    renderWithProviders(<StaffRecordsButton user={USER} kindergartenId={KG} />);

    await user.click(screen.getByRole("button", { name: /Хувийн хэрэг/ }));
    await user.click(await screen.findByRole("button", { name: "Ахлах багш — устгах" }));

    const dialogs = await screen.findAllByRole("dialog");
    const confirm = dialogs[dialogs.length - 1]!;
    expect(within(confirm).getByText(/дуусах огноог бөглөнө/)).toBeInTheDocument();
  });

  it("posts a new record to the kindergarten's own path", async () => {
    const { calls } = stub([]);
    const user = userEvent.setup();
    renderWithProviders(<StaffRecordsButton user={USER} kindergartenId={KG} />);

    await user.click(screen.getByRole("button", { name: /Хувийн хэрэг/ }));
    await user.click(await screen.findByRole("button", { name: "Бүртгэл нэмэх" }));

    await user.type(screen.getByRole("textbox", { name: /Албан тушаал/ }), "Ахлах багш");
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    const post = await vi.waitFor(() => {
      const found = calls.find((c) => c.method === "POST");
      if (!found) throw new Error("POST хийгдээгүй");
      return found;
    });

    expect(post.url).toContain(`/kindergartens/${KG}/staff/${USER.id}/records`);
    const body = post.body as Record<string, unknown>;
    expect(body.title).toBe("Ахлах багш");
    expect(body.kind).toBe("EXPERIENCE");
    // ★ `null`, not `""` — an empty string is not a date, and a blank field is
    // what "still current" looks like.
    expect(body.endedOn).toBeNull();
  });

  it("will not submit without a title", async () => {
    stub([]);
    const user = userEvent.setup();
    renderWithProviders(<StaffRecordsButton user={USER} kindergartenId={KG} />);

    await user.click(screen.getByRole("button", { name: /Хувийн хэрэг/ }));
    await user.click(await screen.findByRole("button", { name: "Бүртгэл нэмэх" }));

    expect(screen.getByRole("button", { name: "Хадгалах" })).toBeDisabled();
  });
});
