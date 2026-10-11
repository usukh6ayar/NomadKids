import { cleanup, screen, within } from "@testing-library/react";
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
import { resetSongPoemResources } from "@/lib/songs-poems";

const CHILD_ID = "99999999-9999-4999-8999-999999999999";

function session(role: "TEACHER" | "PARENT") {
  stubApi([{ path: "/auth/me", body: sessionFor([role]) }]);
}

describe("the monthly songs and poems library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    resetSongPoemResources();
  });

  it("shows nine book-like month folders and teacher actions inside a folder", async () => {
    session("TEACHER");
    const user = userEvent.setup();
    renderWithProviders(<SongsPoemsPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Дуу, шүлэг" })).toBeVisible();
    expect(
      screen.queryByText("Хүүхдүүдийн сурсан дуу, шүлгийг сараар нь зураг болон файлтай хадгална."),
    ).toBeNull();
    expect(screen.queryByText("Хичээлийн жилийн сарын хавтас")).toBeNull();
    expect(
      screen.queryByText("9-р сараас 5-р сар хүртэлх хавтсаас сонгож дуу, шүлгээ нээнэ үү."),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: /сар хавтас, / })).toHaveLength(9);
    const septemberBook = screen.getByRole("button", { name: "9-р сар хавтас, 2 материал" });
    expect(septemberBook.querySelector("svg")).toBeNull();
    expect(within(septemberBook).getByText("2 материал")).not.toHaveClass("bg-white/70");
    expect(
      screen.getByRole("button", { name: "9-р сар хавтас — үйлдэл" }).parentElement,
    ).not.toHaveClass("bg-white/75");

    await user.click(screen.getByRole("button", { name: "9-р сар хавтас — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: "Засах" }));
    const folderDialog = within(screen.getByRole("dialog", { name: "Номын хавтас засах" }));
    const monthName = folderDialog.getByLabelText(/Сар/);
    const monthTitle = folderDialog.getByLabelText(/Гарчиг/);
    expect(monthName).toHaveValue("9-р сар");
    expect(monthTitle).toHaveValue("Намрын эхлэл");
    await user.clear(monthName);
    await user.type(monthName, "Есдүгээр сар");
    await user.clear(monthTitle);
    await user.type(monthTitle, "Намрын дурсамж");
    await user.click(screen.getByRole("button", { name: "Шинэчлэх" }));
    expect(screen.getByRole("button", { name: "Есдүгээр сар хавтас, 2 материал" })).toBeVisible();
    expect(screen.getByText("Намрын дурсамж")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Есдүгээр сар хавтас, 2 материал" }));
    expect(screen.getByRole("heading", { name: "Есдүгээр сар — Дуу, шүлэг" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Өглөөний мэнд" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Дуу, шүлэг нэмэх" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Өглөөний мэнд — үйлдэл" }));
    expect(screen.getByRole("menuitem", { name: "Засах" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Устгах" })).toBeVisible();

    await user.click(screen.getByRole("menuitem", { name: "Засах" }));
    const name = screen.getByLabelText(/Нэр/);
    expect(name).toHaveValue("Өглөөний мэнд");
    await user.clear(name);
    await user.type(name, "Өглөөний мэндчилгээ");
    await user.click(screen.getByRole("button", { name: "Шинэчлэх" }));
    expect(await screen.findByRole("heading", { name: "Өглөөний мэндчилгээ" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Өглөөний мэндчилгээ — үйлдэл" }));
    await user.click(screen.getByRole("menuitem", { name: "Устгах" }));
    await user.click(screen.getByRole("button", { name: "Устгах" }));
    expect(screen.queryByRole("heading", { name: "Өглөөний мэндчилгээ" })).not.toBeInTheDocument();
  });

  it("lets a teacher add a file and exposes the same item read-only to a parent", async () => {
    session("TEACHER");
    const user = userEvent.setup();
    renderWithProviders(<SongsPoemsPage />);

    await user.click(await screen.findByRole("button", { name: "11-р сар хавтас, 0 материал" }));
    expect(screen.getByText("Хоосон")).toHaveClass("text-muted/70");
    expect(screen.queryByText("Энэ сарын хавтас хоосон байна")).toBeNull();
    expect(screen.queryByText(/товчоор хүүхдүүдийн сурсан материалыг/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Дуу, шүлэг нэмэх" }));
    expect(screen.queryByText(/хавтаст зураг эсвэл файлтай материал байршуулна/)).toBeNull();
    await user.click(screen.getByRole("combobox", { name: /Төрөл/ }));
    expect(screen.getByRole("option", { name: "Ардын аман зохиол" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Үлгэр" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Үлгэр" }));
    await user.type(screen.getByLabelText(/Нэр/), "Цасан хүн");
    await user.upload(
      screen.getByLabelText("Дуу, шүлгийн файл"),
      new File(["demo-audio"], "tsasan-hun.mp3", { type: "audio/mpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    expect(await screen.findByRole("heading", { name: "Цасан хүн" })).toBeVisible();
    expect(screen.getByText("Үлгэр")).toBeVisible();
    expect(screen.getByText("tsasan-hun.mp3")).toBeVisible();

    cleanup();
    session("PARENT");
    renderWithProviders(<ChildSongsPoemsPage />);
    await user.click(await screen.findByRole("button", { name: "11-р сар хавтас, 1 материал" }));

    expect(screen.getByRole("heading", { name: "Цасан хүн" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Дуу, шүлэг нэмэх" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Цасан хүн — үйлдэл/ })).not.toBeInTheDocument();
  });

  it("keeps the parent experience read-only", async () => {
    session("PARENT");
    const user = userEvent.setup();
    renderWithProviders(<ChildSongsPoemsPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Дуу, шүлэг" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /сар хавтас, / })).toHaveLength(9);
    expect(screen.queryByRole("button", { name: /хавтас — үйлдэл/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "9-р сар хавтас, 2 материал" }));

    expect(screen.getByRole("heading", { name: "Өглөөний мэнд" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Дуу, шүлэг нэмэх" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /үйлдэл/ })).not.toBeInTheDocument();
  });
});
