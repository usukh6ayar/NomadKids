import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildDetail } from "@kinder/contracts";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { ParentGrowthLauncher } from "@/components/child/parent-growth-launcher";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";

const child = {
  id: CHILD_ID,
  lastName: "Ганболд",
  firstName: "Батбаяр",
  sex: "MALE",
  dateOfBirth: "2021-04-12",
  status: "ACTIVE",
  photoMediaFileId: null,
  enrollments: [],
  guardianships: [],
  kindergarten: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Цэцэрлэг",
  },
  healthNotes: null,
} satisfies ChildDetail;

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date("2026-09-09T04:00:00Z"));
});

describe("parent growth launcher copy", () => {
  it("shows the revised heading, notes copy, and empty state", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/observations`,
        body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/terms",
        body: [],
      },
    ]);

    renderWithProviders(<ParentGrowthLauncher child={child} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Хүүхдийн явцын үнэлгээ" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Б")).not.toBeInTheDocument();
    expect(screen.queryByText("БИ ЦЭЦЭРЛЭГТЭЭ")).not.toBeInTheDocument();
    expect(screen.queryByText("Батбаяр-ийн өхөөрдөм ахиц")).not.toBeInTheDocument();

    // The lede sits once, under the page's own h1 — the notes section below
    // no longer repeats the active bucket's name as a second, button-less
    // heading.
    expect(
      screen.getByText("Хүүхдийн хөгжилд гарч буй ахиц дэвшлийг багш, эцэг эх хамтран тэмдэглэнэ"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Ажиглалт" })).not.toBeInTheDocument();

    expect(await screen.findByText("Тэмдэглэл ороогүй")).toBeInTheDocument();
    expect(screen.getByLabelText("Улирал")).toHaveTextContent("1-р улирал");
    expect(screen.queryByRole("group", { name: "Тэмдэглэлийн ангилал" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ажиглалт нэмэх" })).toHaveClass("rounded-pill");
    expect(screen.queryByText("Одоогоор зурагтай мөч алга")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Багшийн хуваалцсан ажиглалт, бүтээл энд харагдана."),
    ).not.toBeInTheDocument();
  });

  it("shows a text-only note and hides the empty state", async () => {
    vi.setSystemTime(new Date("2026-09-09T04:00:00Z"));
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/observations`,
        body: {
          items: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              childId: CHILD_ID,
              observedOn: "2026-09-09",
              source: "PARENT",
              reviewStatus: "PENDING",
              visibleToParents: true,
              includeInReport: false,
              activityName: null,
              situation: "Ө" + "сэн бичвэртэй тэмдэглэл",
              childDid: null,
              childSaid: null,
              teacherComment: null,
              nextSteps: null,
              reviewNote: null,
              type: {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                name: "Ажиглалт",
                code: "daily",
              },
              author: {
                id: "11111111-1111-4111-8111-111111111111",
                lastName: "Тест",
                firstName: "Хэрэглэгч",
              },
              media: [],
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/terms",
        body: [],
      },
    ]);

    renderWithProviders(<ParentGrowthLauncher child={child} />);

    expect(await screen.findByRole("button", { name: "Тэмдэглэлийн үйлдэл" })).toBeInTheDocument();
    expect(screen.queryByText("Тэмдэглэл ороогүй")).not.toBeInTheDocument();
  });

  it("shows each tab's own past notes — Ажиглалт, Ярилцлага, Бүтээл don't mix", async () => {
    const user = userEvent.setup();
    const author = {
      id: "11111111-1111-4111-8111-111111111111",
      lastName: "Тест",
      firstName: "Хэрэглэгч",
    };
    const base = {
      childId: CHILD_ID,
      observedOn: "2026-09-09",
      source: "PARENT" as const,
      reviewStatus: "PENDING" as const,
      visibleToParents: true,
      includeInReport: false,
      activityName: null,
      childDid: null,
      childSaid: null,
      teacherComment: null,
      nextSteps: null,
      reviewNote: null,
      author,
      media: [],
    };
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/observations`,
        body: {
          items: [
            {
              ...base,
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
              situation: "Өнгөрсөн ажиглалт",
              type: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", name: "Ажиглалт", code: "daily" },
            },
            {
              ...base,
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
              situation: "Өмнө бичсэн ярилцлага",
              type: {
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
                name: "Ярилцлага",
                code: "conversation",
              },
            },
            {
              ...base,
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
              situation: "Өмнө хийсэн бүтээл",
              type: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", name: "Бүтээл", code: "artwork" },
            },
          ],
          page: 1,
          pageSize: 100,
          total: 3,
          totalPages: 1,
        },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/terms",
        body: [],
      },
    ]);

    renderWithProviders(<ParentGrowthLauncher child={child} />);

    expect(await screen.findByText("Өнгөрсөн ажиглалт")).toBeInTheDocument();
    expect(screen.queryByText("Өмнө бичсэн ярилцлага")).not.toBeInTheDocument();
    expect(screen.queryByText("Өмнө хийсэн бүтээл")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ярилцлага" }));
    expect(await screen.findByText("Өмнө бичсэн ярилцлага")).toBeInTheDocument();
    expect(screen.queryByText("Өнгөрсөн ажиглалт")).not.toBeInTheDocument();
    expect(screen.queryByText("Өмнө хийсэн бүтээл")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Бүтээл" }));
    expect(await screen.findByText("Өмнө хийсэн бүтээл")).toBeInTheDocument();
    expect(screen.queryByText("Өнгөрсөн ажиглалт")).not.toBeInTheDocument();
    expect(screen.queryByText("Өмнө бичсэн ярилцлага")).not.toBeInTheDocument();
  });

  it("saves the selected category and photo from one submit", async () => {
    vi.setSystemTime(new Date("2026-09-09T04:00:00Z"));
    const saved = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      childId: CHILD_ID,
      observedOn: "2026-09-09",
      source: "PARENT",
      reviewStatus: "PENDING",
      visibleToParents: true,
      includeInReport: false,
      activityName: null,
      situation: "Шинэ ахиц",
      childDid: null,
      childSaid: null,
      teacherComment: null,
      nextSteps: null,
      reviewNote: null,
      type: null,
      author: null,
      media: [],
    };
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/observations`,
        body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/terms",
        body: [],
      },
      {
        path: `/children/${CHILD_ID}/parent-observations`,
        method: "POST",
        status: 201,
        body: saved,
      },
      {
        path: `/children/${CHILD_ID}/media`,
        method: "POST",
        status: 201,
        body: {
          items: [
            {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              caption: null,
              originalName: "ahits.png",
              mimeType: "image/png",
              width: 10,
              height: 10,
              purpose: "OBSERVATION",
              observationId: saved.id,
              takenAt: null,
              age: null,
              category: null,
              albumCoverAge: null,
              attribution: null,
              uploadedBy: null,
            },
          ],
          failed: [],
        },
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ParentGrowthLauncher child={child} />);

    await user.click(screen.getByRole("button", { name: "Ажиглалт нэмэх" }));
    await user.type(screen.getByLabelText("Агуулга"), "Шинэ ахиц");
    await user.upload(
      screen.getByLabelText("Зураг сонгох"),
      new File(["png"], "ahits.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(
        api.calls.some(
          (call) =>
            call.method === "POST" &&
            call.url === `/children/${CHILD_ID}/parent-observations` &&
            (call.body as { categoryCode?: string })?.categoryCode === "daily",
        ),
      ).toBe(true),
    );
    const upload = api.calls.find(
      (call) => call.method === "POST" && call.url === `/children/${CHILD_ID}/media`,
    );
    expect(upload?.body).toBeInstanceOf(FormData);
    expect((upload?.body as FormData).get("observationId")).toBe(saved.id);
  });
});
