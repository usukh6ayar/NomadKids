import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, selectOption, stubApi } from "./support/render";
import { OfficialDocuments } from "@/components/documents/official-documents";
import { OfficialDocumentsAdmin } from "@/components/platform/official-documents-admin";
import { OFFICIAL_DOCUMENTS } from "@/lib/official-documents";

/**
 * «Яамны хөтөлбөр, журам» — links out, nothing stored (2026-10-20).
 *
 * ★ What carries a rule: a card opens the official source in a new tab with
 * no opener; a notice or an index is never labelled as the original; a
 * teacher does not get a director's guide; until the API exists the shelf
 * reads the shipped list and the operator cannot save into nothing.
 */
describe("official documents shelf", () => {
  // Unmatched routes answer 404 — the API not built yet.
  beforeEach(() => stubApi([]));

  it("opens each source in a new tab, without an opener", async () => {
    renderWithProviders(<OfficialDocuments />);
    fireEvent.click(await screen.findByRole("button", { name: /Бүгдийг харах/ }));
    const links = within(screen.getByRole("list")).getAllByRole("link");
    expect(links).toHaveLength(OFFICIAL_DOCUMENTS.length);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
    }
  });

  it("calls only a full text «Албан эхийг нээх», and only a PDF «PDF нээх»", () => {
    const expected = {
      official_pdf: "PDF нээх",
      official_full_text: "Албан эхийг нээх",
      official_repository_page: "Эх сурвалж үзэх",
      official_notice_only: "Эх сурвалж үзэх",
      official_index_only: "Эх сурвалж үзэх",
    } as const;
    for (const doc of OFFICIAL_DOCUMENTS) {
      expect(doc.actionLabel).toBe(expected[doc.sourceLevel]);
      if (doc.sourceLevel === "official_pdf") expect(doc.url).toMatch(/\.pdf$/);
    }
  });

  it("files the curriculum and the four group manuals under «Сургалтын хөтөлбөр»", () => {
    const curriculum = OFFICIAL_DOCUMENTS.filter((doc) => doc.category === "Сургалтын хөтөлбөр");
    for (const id of ["SOB-007", "SOB-037", "SOB-009", "SOB-010", "SOB-011", "SOB-012"]) {
      expect(curriculum.map((doc) => doc.id)).toContain(id);
    }
  });

  it("draws a cover picture only where one ships", () => {
    const withCover = OFFICIAL_DOCUMENTS.filter((doc) => doc.cover);
    expect(withCover.map((doc) => doc.id).sort()).toEqual(
      [
        "SOB-007",
        "SOB-009",
        "SOB-010",
        "SOB-011",
        "SOB-012",
        "SOB-013",
        "SOB-026",
        "SOB-027",
        "SOB-033",
        "SOB-034",
        "SOB-035",
        "SOB-036",
        "SOB-037",
      ].sort(),
    );
    for (const doc of withCover) {
      expect(doc.sourceLevel).toBe("official_pdf");
      expect(existsSync(join(__dirname, "..", "public", doc.cover!))).toBe(true);
    }
  });

  it("narrows to a category from behind the filter button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OfficialDocuments />);
    expect(screen.getByLabelText("Ангиллаар шүүх")).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: /Шүүлтүүр/ }));
    await selectOption(user, /Ангиллаар шүүх/, "Хууль");
    const links = within(screen.getByRole("list")).getAllByRole("link");
    expect(links).toHaveLength(OFFICIAL_DOCUMENTS.filter((d) => d.category === "Хууль").length);
    expect(screen.queryByText(/Хүчинтэй эсэхийг эх сурвалжаас/)).toBeNull();
  });

  it("puts «Онцлох» first", async () => {
    renderWithProviders(<OfficialDocuments />);
    const first = within(screen.getByRole("list")).getAllByRole("listitem")[0]!;
    expect(within(first).getByText("Онцлох")).toBeInTheDocument();
  });

  it("leaves a director's guide off a teacher's shelf", async () => {
    renderWithProviders(<OfficialDocuments audience={["Багш"]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Бүгдийг харах/ }));
    expect(screen.queryByText("Цэцэрлэгийн менежмент, манлайлал", { selector: "span" })).toBeNull();
  });

  it("finds a regulation by its number", () => {
    renderWithProviders(<OfficialDocuments />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Нэр эсвэл дугаараар хайх" }), {
      target: { value: "А/79" },
    });
    const links = within(screen.getByRole("list")).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", expect.stringContaining("legalinfo.mn"));
  });
});

const apiRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "SOB-005",
  category: "Дүрэм, журам",
  title: "Үнэлэх журам (API)",
  year: 2026,
  number: "А/79",
  url: "https://legalinfo.mn/mn/detail?lawId=17436334882422",
  sourceLevel: "official_full_text",
  reviewRequired: false,
  audience: ["Эрхлэгч", "Арга зүйч", "Багш"],
  notes: null,
};
const page = (items: unknown[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
  totalPages: 1,
});

describe("the operator's register", () => {
  it("says «удахгүй» and will not save while the API is missing", async () => {
    stubApi([]);
    renderWithProviders(<OfficialDocumentsAdmin />, { selectedChild: false });
    expect(await screen.findAllByText(/Сервер бэлэн болоогүй/)).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Нэмэх/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Хадгалах" })).toBeDisabled();
  });

  it("reads the API's list once it answers, and saves a new document", async () => {
    const { calls } = stubApi([
      { path: "/official-documents", method: "GET", body: page([apiRow]) },
      { path: "/official-documents", method: "POST", status: 201, body: { id: "new" } },
    ]);
    renderWithProviders(<OfficialDocumentsAdmin />, { selectedChild: false });
    expect(await screen.findAllByText("Үнэлэх журам (API)")).not.toHaveLength(0);
    expect(screen.queryByText(/Сервер бэлэн болоогүй/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Нэмэх/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Гарчиг/ }), {
      target: { value: "Шинэ журам" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Холбоос/ }), {
      target: { value: "https://mnier.mn/api/media/file/new.pdf" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/official-documents")).toBe(true),
    );
    const sent = calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      title: "Шинэ журам",
      sourceLevel: "official_pdf",
      url: "https://mnier.mn/api/media/file/new.pdf",
      audience: ["Эрхлэгч", "Арга зүйч", "Багш"],
      featured: false,
    });
  });

  it("refuses a «PDF файл» whose link is not a PDF", async () => {
    const { calls } = stubApi([
      { path: "/official-documents", method: "GET", body: page([apiRow]) },
    ]);
    renderWithProviders(<OfficialDocumentsAdmin />, { selectedChild: false });
    await screen.findAllByText("Үнэлэх журам (API)");
    fireEvent.click(screen.getByRole("button", { name: /Нэмэх/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Гарчиг/ }), {
      target: { value: "Х" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Холбоос/ }), {
      target: { value: "https://moe.gov.mn/post/1" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Хадгалах" }));
    expect(await within(dialog).findByText(/\.pdf файл руу заана/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});
