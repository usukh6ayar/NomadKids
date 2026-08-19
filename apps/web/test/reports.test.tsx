import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { ReportDialog } from "@/components/reports/report-dialog";
import { Button } from "@/components/ui/button";
import { ChildAvatar, MediaThumb } from "@/components/media/media-image";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requesting a report", () => {
  it("creates a job and shows a running state", async () => {
    const user = userEvent.setup();

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/reports",
        method: "POST",
        body: { id: JOB_ID, type: "CHILD_PORTFOLIO", status: "QUEUED" },
      },
      {
        path: `/reports/${JOB_ID}`,
        body: { id: JOB_ID, type: "CHILD_PORTFOLIO", status: "RUNNING", progressPercent: 10 },
      },
    ]);

    renderWithProviders(<ReportDialog childId={CHILD_ID} trigger={<Button>PDF</Button>} />);

    await user.click(screen.getByRole("button", { name: "PDF" }));
    await user.click(await screen.findByRole("button", { name: /PDF бэлтгэх/ }));

    // A progress state, not a frozen button — generation takes seconds and
    // silence is indistinguishable from a failure.
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    const post = calls.find((c) => c.method === "POST" && c.url.startsWith("/reports"));
    expect(post?.body).toMatchObject({ childId: CHILD_ID, type: "CHILD_PORTFOLIO" });
  });

  /**
   * ★ The client never asks for an audience.
   *
   * It is derived server-side from the requester's relationship to the child
   * and frozen onto the job. A client-supplied `audience` would let a guardian
   * request the staff copy — and the API's schema is `.strict()`, so sending
   * one is a 400 anyway.
   */
  it("never sends an audience field", async () => {
    const user = userEvent.setup();

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: "/reports",
        method: "POST",
        body: { id: JOB_ID, type: "CHILD_PORTFOLIO", status: "QUEUED" },
      },
      {
        path: `/reports/${JOB_ID}`,
        body: { id: JOB_ID, type: "CHILD_PORTFOLIO", status: "QUEUED" },
      },
    ]);

    renderWithProviders(<ReportDialog childId={CHILD_ID} trigger={<Button>PDF</Button>} />);

    await user.click(screen.getByRole("button", { name: "PDF" }));
    await user.click(await screen.findByRole("button", { name: /PDF бэлтгэх/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.startsWith("/reports"));
      expect(post?.body).not.toHaveProperty("audience");
    });
  });

  it("offers a download once the job is done", async () => {
    const user = userEvent.setup();
    // ★ The tab is opened synchronously with a blank URL, *before* the
    // request, so Safari does not treat it as a popup. The presigned URL is
    // then assigned to its location.
    const tab = { location: { href: "" }, close: vi.fn() };
    const openSpy = vi.fn(() => tab);
    vi.stubGlobal("open", openSpy);

    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/reports",
        method: "POST",
        body: { id: JOB_ID, type: "CHILD_PORTFOLIO", status: "QUEUED" },
      },
      {
        path: `/reports/${JOB_ID}/download`,
        body: { url: "https://storage.example/presigned?sig=abc", expiresIn: 300 },
      },
      {
        path: `/reports/${JOB_ID}`,
        body: {
          id: JOB_ID,
          type: "CHILD_PORTFOLIO",
          status: "DONE",
          pageCount: 12,
          fileSize: 4_700_000,
          downloadable: true,
        },
      },
    ]);

    renderWithProviders(<ReportDialog childId={CHILD_ID} trigger={<Button>PDF</Button>} />);

    await user.click(screen.getByRole("button", { name: "PDF" }));
    await user.click(await screen.findByRole("button", { name: /PDF бэлтгэх/ }));

    // The size and page count give the user something to expect before they
    // commit to a download on a phone connection.
    await waitFor(() => expect(screen.getByText(/12 хуудас/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Татаж авах/ }));

    // ★ The presigned URL is opened, never rendered into the page and never
    // stored: it is a bearer credential with a short life.
    await waitFor(() =>
      expect(tab.location.href).toBe("https://storage.example/presigned?sig=abc"),
    );

    // Opened blank and synchronously — the gesture-preserving shape.
    expect(openSpy).toHaveBeenCalledWith("", "_blank", "noopener,noreferrer");
  });

  /**
   * A failed job that simply stops updating is indistinguishable from one still
   * running, and the user waits indefinitely for something already dead.
   */
  it("shows the failure and offers a retry", async () => {
    const user = userEvent.setup();

    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/reports",
        method: "POST",
        body: { id: JOB_ID, type: "CHILD_PORTFOLIO", status: "QUEUED" },
      },
      {
        path: `/reports/${JOB_ID}`,
        body: {
          id: JOB_ID,
          type: "CHILD_PORTFOLIO",
          status: "FAILED",
          errorMessage: "Тайлан үүсгэхэд алдаа гарлаа. Дахин оролдоно уу.",
        },
      },
    ]);

    renderWithProviders(<ReportDialog childId={CHILD_ID} trigger={<Button>PDF</Button>} />);

    await user.click(screen.getByRole("button", { name: "PDF" }));
    await user.click(await screen.findByRole("button", { name: /PDF бэлтгэх/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/алдаа гарлаа/));
    expect(screen.getByRole("button", { name: "Дахин оролдох" })).toBeInTheDocument();
  });
});

/**
 * ★★ Media never reaches the browser by a bucket URL.
 *
 * Every image `src` points at the API's own `/v1/media/:id`, which runs the
 * authorization check — including an observation photo inheriting its
 * observation's visibility — and only then 302s to a presigned URL that
 * expires. A storage key or a bucket hostname in the DOM would mean the
 * private-bucket rule had been bypassed.
 */
describe("images are served through the authorized endpoint", () => {
  it("a child photo points at the API, not at storage", () => {
    const { container } = renderWithProviders(
      <ChildAvatar
        child={{
          lastName: "Ганболд",
          firstName: "Батбаяр",
          photoMediaFileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        }}
      />,
    );

    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toContain("/v1/media/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect(img.getAttribute("src")).not.toMatch(/r2\.|s3\.|amazonaws|storage\./);
    // Every image has an alt, and it names the child rather than saying "зураг".
    expect(img.getAttribute("alt")).toContain("Ганболд");
  });

  it("an observation photo does the same and carries its caption as alt text", () => {
    const { container } = renderWithProviders(
      <MediaThumb mediaId="ffffffff-ffff-4fff-8fff-ffffffffffff" caption="Тоглож байгаа нь" />,
    );

    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toContain("/v1/media/ffffffff-ffff-4fff-8fff-ffffffffffff");
    expect(img.getAttribute("alt")).toBe("Тоглож байгаа нь");
  });
});
