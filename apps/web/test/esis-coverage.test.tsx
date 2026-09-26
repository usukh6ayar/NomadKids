import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EsisCoverageMatrix } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { EsisCoverageSection } from "@/components/esis/esis-coverage";

/**
 * «Яаманд өгөх 84/84 матриц» — ESIS_TRIAL_STATE §6, 2026-09-26.
 *
 * The matrix was built on the API and had no screen: a director could not see
 * it or download it, so the one document the trial ends with could only be
 * produced by somebody with a terminal. What this pins is that the screen says
 * the two things the ministry will ask — was everything used, and was anything
 * left without a reason — and offers the file.
 */

const KINDERGARTEN = "33333333-3333-4333-8333-333333333333";

const row = (over: Partial<EsisCoverageMatrix["rows"][number]>) => ({
  apiId: 59,
  name: "Байгууллагын ерөнхий мэдээлэл",
  serviceKey: "organization",
  method: "GET",
  path: "/svc/api/hub/v2/organization",
  purpose: "Байгууллагын мэдээлэл",
  trigger: "Синк",
  lastCalledAt: "2026-09-20T02:00:00.000Z",
  calls: 3,
  state: "IN_USE" as const,
  reason: null,
  ...over,
});

const MATRIX: EsisCoverageMatrix = {
  from: "2026-08-26T00:00:00.000Z",
  to: "2026-09-26T00:00:00.000Z",
  totals: {
    granted: 84,
    wired: 75,
    inUse: 25,
    wiredUnused: 50,
    dispositioned: 7,
    superseded: 2,
    undecided: 0,
  },
  rows: [
    row({}),
    row({
      apiId: 129,
      name: "Хүүхдийн хоолны төвлөрүүлэх орлого - Маягт 1 хадгалах",
      serviceKey: null,
      method: null,
      path: null,
      lastCalledAt: null,
      calls: 0,
      state: "DISPOSITIONED",
      reason: "Энэ бүтээгдэхүүн орлогын тайлан бүрдүүлдэггүй.",
    }),
  ],
};

function render(matrix = MATRIX) {
  stubApi([
    { path: "/auth/me", body: sessionFor(["ADMIN"]) },
    { path: `/kindergartens/${KINDERGARTEN}/esis/coverage`, body: matrix },
  ]);
  renderWithProviders(<EsisCoverageSection kindergartenId={KINDERGARTEN} />);
}

describe("the ESIS coverage matrix", () => {
  it("says how many of the grants were used and that none is left unexplained", async () => {
    render();
    const summary = await screen.findByRole("list", { name: "Матрицын дүн" });
    expect(within(summary).getByText("84")).toBeInTheDocument();
    expect(within(summary).getByText("25")).toBeInTheDocument();
    expect(screen.getByText(/Шалтгаангүй үлдсэн сервис алга/)).toBeInTheDocument();
  });

  it("gives an unused service its reason, in the row", async () => {
    render();
    const table = await screen.findByRole("table", { name: "ЭСИС сервисийн матриц" });
    const unused = within(table)
      .getByText(/Маягт 1 хадгалах/)
      .closest("tr")!;
    expect(unused).toHaveTextContent("Зориуд холбоогүй");
    expect(unused).toHaveTextContent("орлогын тайлан бүрдүүлдэггүй");
  });

  it("warns when a grant has no decision", async () => {
    render({ ...MATRIX, totals: { ...MATRIX.totals, undecided: 2 } });
    expect(await screen.findByText(/2 сервис шалтгаангүй/)).toBeInTheDocument();
  });

  it("offers the matrix as a spreadsheet", async () => {
    render();
    const link = await screen.findByRole("link", { name: /Excel татах/ });
    expect(link.getAttribute("href")).toContain(
      `/kindergartens/${KINDERGARTEN}/esis/coverage/export`,
    );
  });
});
