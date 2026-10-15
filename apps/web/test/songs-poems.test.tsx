import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import SongsPoemsPage from "@/app/(app)/songs-poems/page";
import ChildSongsPoemsPage from "@/app/(app)/children/[childId]/songs-poems/page";
import { downloadUrl } from "@/lib/api/client";

/*
 * ★ Since 2026-10-11 the library is the server's: a group's, kept by its
 * teacher and read by its families. Nothing is held in the browser.
 */

const CHILD_ID = "99999999-9999-4999-8999-999999999999";
const GROUP = { id: "44444444-4444-4444-8444-444444444444", name: "Нарлаг", ageBand: "MIDDLE" };
const OTHER_GROUP = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Дэлбээ",
  ageBand: "MIDDLE",
};
const SONG_ID = "66666666-6666-4666-8666-666666666666";

const SONG = {
  id: SONG_ID,
  month: "09",
  type: "song",
  title: "Өглөөний мэнд",
  description: "Өглөөний тойргоор хамтран дуулна.",
  coverUrl: `/songs-poems/${SONG_ID}/cover`,
  coverFileName: "mend.png",
  fileUrl: `/songs-poems/${SONG_ID}/file`,
  fileName: "mend.mp3",
  fileType: "audio/mpeg",
  updatedAt: "2026-09-12T08:00:00.000Z",
};

const library = (group = GROUP, months: unknown[] = []) => ({
  group: { id: group.id, name: group.name },
  months,
  items: [SONG],
});
const groups = (items: unknown[]) => ({
  items,
  page: 1,
  pageSize: 50,
  total: items.length,
  totalPages: 1,
});

describe("the monthly songs and poems library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setParams({ childId: CHILD_ID });
    setSearchParams("");
  });

  it("shows the group's nine books, with the teacher's own month names", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/groups/${GROUP.id}/songs-poems`,
        body: library(GROUP, [{ month: "10", label: "Намар", subtitle: "Шар навч" }]),
      },
      { path: "/groups", body: groups([GROUP]) },
    ]);
    renderWithProviders(<SongsPoemsPage />);

    expect(await screen.findByRole("button", { name: "9-р сар хавтас, 1 материал" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /хавтас, / })).toHaveLength(9);
    expect(screen.getByRole("button", { name: "Намар хавтас, 0 материал" })).toBeVisible();
    expect(screen.getByText("Шар навч")).toBeVisible();
    // The front-end trial notice is gone, and a single group needs no picker.
    expect(screen.queryByText(/фронт-эндийн туршилтын/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Бүлэг" })).toBeNull();
  });

  it("saves a month's name and a new song to the server, with the real file", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP.id}/songs-poems/months/09`, method: "PUT", body: {} },
      { path: `/groups/${GROUP.id}/songs-poems`, method: "POST", status: 201, body: SONG },
      { path: `/groups/${GROUP.id}/songs-poems`, body: library() },
      { path: "/groups", body: groups([GROUP]) },
    ]);
    renderWithProviders(<SongsPoemsPage />);

    await user.click(await screen.findByRole("button", { name: "9-р сар хавтас — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: "Засах" }));
    const folder = within(screen.getByRole("dialog", { name: "Номын хавтас засах" }));
    await user.clear(folder.getByLabelText(/Гарчиг/));
    await user.type(folder.getByLabelText(/Гарчиг/), "Намрын дурсамж");
    await user.click(screen.getByRole("button", { name: "Шинэчлэх" }));
    await waitFor(() =>
      expect(api.calls.find((c) => c.url.endsWith("/months/09"))?.body).toEqual({
        label: "9-р сар",
        subtitle: "Намрын дурсамж",
      }),
    );

    await user.click(screen.getByRole("button", { name: "9-р сар хавтас, 1 материал" }));
    await user.click(screen.getByRole("button", { name: "Дуу, шүлэг нэмэх" }));
    await user.click(screen.getByRole("combobox", { name: /Төрөл/ }));
    await user.click(screen.getByRole("option", { name: "Үлгэр" }));
    await user.type(screen.getByLabelText(/Нэр/), "Цасан хүн");
    await user.type(screen.getByLabelText(/Линк/), "https://youtu.be/abc123");
    await user.upload(
      screen.getByLabelText("Файл"),
      new File(["audio"], "tsasan-hun.mp3", { type: "audio/mpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const form = api.calls.find((c) => c.method === "POST")?.body as FormData;
      expect(form.get("month")).toBe("09");
      expect(form.get("type")).toBe("fairy_tale");
      expect(form.get("title")).toBe("Цасан хүн");
      expect((form.get("file") as File).name).toBe("tsasan-hun.mp3");
      expect(form.get("cover")).toBeNull();
      expect(form.get("linkUrl")).toBe("https://youtu.be/abc123");
    });
  });

  it("lets a teacher of two groups choose which group's library", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${OTHER_GROUP.id}/songs-poems`, body: library(OTHER_GROUP) },
      { path: `/groups/${GROUP.id}/songs-poems`, body: library() },
      { path: "/groups", body: groups([GROUP, OTHER_GROUP]) },
    ]);
    renderWithProviders(<SongsPoemsPage />);

    await screen.findByRole("button", { name: "9-р сар хавтас, 1 материал" });
    await user.click(screen.getByRole("combobox", { name: "Бүлэг" }));
    await user.click(screen.getByRole("option", { name: "Дэлбээ" }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.url === `/groups/${OTHER_GROUP.id}/songs-poems`)).toBe(true),
    );
  });

  it("shows a family their child's group library, read-only, files through the API", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/children/${CHILD_ID}/songs-poems`, body: library() },
    ]);
    renderWithProviders(<ChildSongsPoemsPage />);

    expect(screen.queryByRole("button", { name: /хавтас — үйлдэл/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "9-р сар хавтас, 1 материал" }));
    expect(screen.getByRole("heading", { name: "Өглөөний мэнд" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Дуу, шүлэг нэмэх" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /үйлдэл/ })).not.toBeInTheDocument();

    // ★ The media box opens large (2026-10-12, the user); the sound plays there.
    await user.click(screen.getByRole("button", { name: "Өглөөний мэнд — томоор харах" }));
    const viewer = screen.getByRole("dialog", { name: "Өглөөний мэнд" });
    expect(viewer.querySelector("audio")?.getAttribute("src")).toBe(
      downloadUrl(`/songs-poems/${SONG_ID}/file`),
    );
  });

  /*
   * ★ A YouTube link plays inside the page (the CSP allows youtube-nocookie and
   * Drive only); any other link is offered to open.
   */
  it("plays a YouTube link inside the page", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/songs-poems`,
        body: {
          ...library(),
          items: [{ ...SONG, linkUrl: "https://www.youtube.com/watch?v=abc123" }],
        },
      },
    ]);
    renderWithProviders(<ChildSongsPoemsPage />);

    await user.click(await screen.findByRole("button", { name: "9-р сар хавтас, 1 материал" }));
    await user.click(screen.getByRole("button", { name: "Шууд сонсох" }));
    const viewer = screen.getByRole("dialog", { name: "Өглөөний мэнд" });
    expect(viewer.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
  });
});
