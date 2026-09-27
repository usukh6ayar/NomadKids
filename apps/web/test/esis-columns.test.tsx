import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EsisField } from "@kinder/contracts";
import { EsisNoAnswer } from "@/components/esis/esis-no-answer";
import { EsisRowValues, esisVisibleColumns } from "@/components/esis/esis-rows";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/**
 * Which columns a table draws, and what it says when there are none.
 *
 * ★ A file of its own rather than cases added to `esis-data-panel.test.tsx`:
 * both subjects here are pure — a function over a field list, and a component
 * with no query client, no session and no stubbed API — so they need none of
 * that file's setup, and putting them there would make its fixtures look like
 * they mattered to these.
 */

const field = (name: string, label: string, summary?: number): EsisField => ({
  name,
  label,
  io: "OUTPUT",
  ingested: true,
  ...(summary === undefined ? {} : { summary }),
});

describe("ESIS хүснэгтийн багана", () => {
  /*
   * ★ The case the change was made for.
   *
   * The catalogue is the ESIS developer portal's documentation order, which
   * leads with identifiers — so taking its first five gave the student roster
   * "Байгууллагын код" (one value repeated down every row) and a thirteen-digit
   * `personId` before the child's name. The declared order is what fixes it,
   * and the assertion is deliberately about *order*, not membership: a
   * `boolean` flag would satisfy a membership check and still leave Бүлэг at
   * the far end, because it sits fifteenth in the catalogue.
   */
  it("draws the declared reading order, not the catalog's first five", () => {
    const fields = [
      field("institutionId", "Байгууллагын код"),
      field("personId", "ESIS хүний дугаар"),
      field("familyName", "Ургийн овог"),
      field("lastName", "Овог", 1),
      field("firstName", "Нэр", 2),
      field("genderName", "Хүйс", 4),
      field("dateOfBirth", "Төрсөн огноо"),
      field("studentGroupName", "Бүлгийн нэр", 3),
    ];

    expect(esisVisibleColumns(fields).map((column) => column.label)).toEqual([
      "Овог",
      "Нэр",
      "Бүлгийн нэр",
      "Хүйс",
    ]);
  });

  /*
   * ★ Forgetting a service must leave it as it was, never blank.
   *
   * Three write services carry inputs only and are in no reading order at all;
   * a strict filter would render them with zero columns — an empty table being
   * the one outcome worse than a badly ordered one.
   */
  it("falls back to the first five when no order is declared", () => {
    const fields = [
      field("a", "Нэг"),
      field("b", "Хоёр"),
      field("c", "Гурав"),
      field("d", "Дөрөв"),
      field("e", "Тав"),
      field("f", "Зургаа"),
    ];

    expect(esisVisibleColumns(fields).map((column) => column.label)).toEqual([
      "Нэг",
      "Хоёр",
      "Гурав",
      "Дөрөв",
      "Тав",
    ]);
  });
});

describe("ESIS хариу ирээгүй мессеж", () => {
  const endpoint = { method: "GET", path: "/svc/api/hub/v2/students/list" };

  /*
   * ★ The default reader is the product's — a director, a teacher, a guardian
   * — and they get a sentence about their kindergarten, never about a
   * transport. The path was drawn here until 2026-09-20; the component's
   * docblock records both instructions and why the later one wins.
   */
  it("says nothing about services, paths or codes by default", () => {
    render(<EsisNoAnswer endpoint={endpoint} errorCode="SCOPE_DENIED" variant="FAILED" />);

    expect(screen.getByText(/Мэдээллийг татаж чадсангүй/)).toBeInTheDocument();
    expect(screen.queryByText(/svc\/api\/hub/)).not.toBeInTheDocument();
    expect(screen.queryByText(/эрх олгоогүй/)).not.toBeInTheDocument();
  });

  /*
   * ★ A successful call carrying nothing is a different fact from a failed one
   * and still says so — an empty roster is ordinary, an unreachable ministry is
   * not, and a reader who cannot tell them apart chases the wrong one.
   */
  it("separates an empty answer from a failed one", () => {
    render(<EsisNoAnswer endpoint={endpoint} errorCode={null} variant="EMPTY" />);

    expect(screen.getByText(/Мэдээлэл алга байна/)).toBeInTheDocument();
    expect(screen.queryByText(/татаж чадсангүй/)).not.toBeInTheDocument();
  });

  /*
   * ★ `technical` is the operator's half — the path is what somebody quotes to
   * БМТТ, and an unlabelled code reads badly but reads, which beats
   * swallowing it. Under test so the prop cannot quietly become dead code.
   */
  it("names the endpoint and the raw code when asked technically", () => {
    render(
      <EsisNoAnswer endpoint={endpoint} errorCode="SCOPE_EXPIRED" variant="FAILED" technical />,
    );

    expect(screen.getByText(/GET \/svc\/api\/hub\/v2\/students\/list/)).toBeInTheDocument();
    expect(screen.getByText("SCOPE_EXPIRED")).toBeInTheDocument();
  });
});

/**
 * Хайлт ба хуудаслалт — the 83-row roster.
 *
 * ★ The server used to truncate at 25 and the screen said so in a footnote.
 * These cases are the replacement contract: every row arrives, the table pages
 * through them, and a search reaches the ones a page is not showing.
 */
describe("ESIS хүснэгтийн хайлт", () => {
  const columns = [field("lastName", "Овог", 1), field("firstName", "Нэр", 2)];

  /** 83 rows, the size of the roster this was built for. */
  const roster = Array.from({ length: 83 }, (_, i) => ({
    lastName: `Овог${i}`,
    firstName: i === 60 ? "Нарангуа" : `Нэр${i}`,
  }));

  it("pages a long list instead of drawing all of it", () => {
    render(<EsisRowValues columns={columns} rows={roster} />);

    expect(screen.getByText("Нийт 83 бичлэг")).toBeInTheDocument();
    expect(screen.getByText("1 / 4")).toBeInTheDocument();
    expect(screen.getByText("Нэр0")).toBeInTheDocument();
    expect(screen.queryByText("Нэр30")).not.toBeInTheDocument();
  });

  /*
   * ★ The case the whole change exists for. Row 61 was past the old cut, so
   * before this the reader was told the child was not there.
   */
  it("finds a row that no page is currently showing", async () => {
    render(<EsisRowValues columns={columns} rows={roster} />);

    expect(screen.queryByText("Нарангуа")).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("searchbox"), "нарангуа");

    expect(await screen.findByText("Нарангуа")).toBeInTheDocument();
    expect(screen.getByText("Нийт 1 бичлэг")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    render(<EsisRowValues columns={columns} rows={roster} />);

    await userEvent.type(screen.getByRole("searchbox"), "байхгүй хүн");

    expect(await screen.findByText(/тохирох бичлэг алга/)).toBeInTheDocument();
    expect(screen.getByText("Нийт 0 бичлэг")).toBeInTheDocument();
  });

  /*
   * ★★ The alignment bug this was written to prevent.
   *
   * `hrefs` is index-aligned with `rows`. Paging draws a slice, so a component
   * that kept indexing into `hrefs` would point every name on page 2 at the
   * wrong child — silently, and with a plausible-looking link.
   */
  it("keeps each row's link with its own row across pages", async () => {
    const hrefs = roster.map((_, i) => `/children/child-${i}`);
    render(<EsisRowValues columns={columns} rows={roster} hrefs={hrefs} />);

    await userEvent.click(screen.getByRole("button", { name: "Дараах" }));

    // `tr` since 2026-09-22 — the records are table rows rather than cards.
    const row = screen.getByText("Овог25").closest("tr")!;
    expect(within(row).getByRole("link")).toHaveAttribute("href", "/children/child-25");
  });

  it("offers no search or paging for a list that fits", () => {
    render(<EsisRowValues columns={columns} rows={roster.slice(0, 4)} />);

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Хуудаслалт" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Дэлгэрэнгүй харах" })).not.toBeInTheDocument();
  });
});
