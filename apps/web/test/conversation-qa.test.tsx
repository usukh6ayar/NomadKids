import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTER,
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import NewObservationPage from "@/app/(app)/children/[childId]/observations/new/page";
import {
  conversationToText,
  qaQuestions,
  qaToText,
  textToConversation,
  textToQa,
} from "@/lib/conversation-qa";

/*
 * ★ «Ярилцлага» as Асуулт / Хариулт pairs — 2026-10-08, the client. Stored as
 * the note's own text, and the А/79 suggestions read the questions.
 */

const KG = "33333333-3333-4333-8333-333333333333";
const CHILD = "66666666-6666-4666-8666-666666666666";
const TALK = "77777777-7777-4777-8777-000000000002";
const CREATED = "dddddddd-dddd-4ddd-8ddd-000000000010";

describe("pairs as note text", () => {
  it("writes one paragraph a pair, leaving empty pairs out", () => {
    expect(
      qaToText([
        { q: "Энэ юу вэ?", a: "Алим." },
        { q: "", a: "" },
        { q: "Хэдэн алим байна?", a: "Гурав." },
      ]),
    ).toBe("Асуулт: Энэ юу вэ?\nХариулт: Алим.\n\nАсуулт: Хэдэн алим байна?\nХариулт: Гурав.");
  });

  it("reads them back, and keeps older free text as one answer", () => {
    const pairs = [
      { q: "Энэ юу вэ?", a: "Алим." },
      { q: "Хэдэн алим байна?", a: "Гурав." },
    ];
    expect(textToQa(qaToText(pairs))).toEqual(pairs);
    expect(textToQa("Хүүхэд алимаа тоолов.")).toEqual([{ q: "", a: "Хүүхэд алимаа тоолов." }]);
    expect(textToQa("")).toEqual([{ q: "", a: "" }]);
  });

  it("puts the title first, and reads it back", () => {
    const talk = { title: "Алим тоолох", pairs: [{ q: "Энэ юу вэ?", a: "Алим." }] };
    expect(conversationToText(talk)).toBe(
      "Гарчиг: Алим тоолох\n\nАсуулт: Энэ юу вэ?\nХариулт: Алим.",
    );
    expect(textToConversation(conversationToText(talk))).toEqual(talk);
    expect(textToConversation("Асуулт: Энэ юу вэ?").title).toBe("");
  });

  it("gives the suggestions the title and the questions, not the answers", () => {
    expect(qaQuestions([{ q: "Хэдэн алим байна?", a: "Гурав, том нь улаан." }])).toBe(
      "Хэдэн алим байна?",
    );
    expect(qaQuestions([{ q: "Хэдэн алим байна?", a: "Гурав." }], "Тоолох")).toBe(
      "Тоолох Хэдэн алим байна?",
    );
  });
});

describe("the conversation form", () => {
  beforeEach(() => {
    window.localStorage.clear();
    ROUTER.replace.mockClear();
    setParams({ childId: CHILD });
    setSearchParams("type=conversation");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    setSearchParams("");
  });

  function stub() {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD}/observations/types`,
        body: [
          { id: "77777777-7777-4777-8777-000000000001", name: "Ажиглалт", code: "daily" },
          { id: TALK, name: "Ярилцлага", code: "conversation" },
        ],
      },
      {
        path: `/children/${CHILD}/observations`,
        method: "POST",
        status: 201,
        body: {
          id: CREATED,
          childId: CHILD,
          observedOn: "2026-10-08",
          source: "TEACHER",
          reviewStatus: "APPROVED",
          visibleToParents: false,
          media: [],
        },
      },
      {
        path: `/children/${CHILD}`,
        body: {
          id: CHILD,
          firstName: "Батбаяр",
          lastName: "Ганболд",
          sex: "MALE",
          dateOfBirth: "2024-01-15",
          status: "ACTIVE",
          photoMediaFileId: null,
          enrollments: [],
          guardianships: [],
        },
      },
      { path: `/kindergartens/${KG}/assessment-config`, body: { domains: [], levels: [] } },
    ]);
  }

  it(
    "asks in pairs, adds one with ＋, saves them as the note, and suggests from the questions",
    { timeout: 20_000 },
    async () => {
      const user = userEvent.setup();
      const api = stub();
      renderWithProviders(<NewObservationPage />);

      // A title above the questions — 2026-10-08, the client.
      await user.type(await screen.findByLabelText("Гарчиг"), "Алим");
      await user.type(screen.getByLabelText("Асуулт 1"), "Энэ хэдэн алим бэ, тоолоод хэл?");
      await user.type(screen.getByLabelText("Хариулт 1"), "Гурав.");
      expect(screen.queryByLabelText("Тэмдэглэл")).toBeNull();

      // The question names the skill; the answer is not read.
      const suggested = screen.getByRole("group", { name: "Тэмдэглэлд тохирох шалгуур" });
      expect(within(suggested).getByRole("button", { name: /^Ш23 нэмэх/ })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Асуулт нэмэх" }));
      await user.type(screen.getByLabelText("Асуулт 2"), "Аль нь том бэ?");
      await user.type(screen.getByLabelText("Хариулт 2"), "Улаан нь.");

      await user.click(screen.getByRole("button", { name: "Хадгалах" }));
      await waitFor(() =>
        expect(
          api.calls.find(
            (call) => call.method === "POST" && call.url === `/children/${CHILD}/observations`,
          )?.body,
        ).toMatchObject({
          typeId: TALK,
          situation:
            "Гарчиг: Алим\n\nАсуулт: Энэ хэдэн алим бэ, тоолоод хэл?\nХариулт: Гурав.\n\nАсуулт: Аль нь том бэ?\nХариулт: Улаан нь.",
        }),
      );
    },
  );

  it("suggests criteria from the title alone", { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<NewObservationPage />);

    await user.type(await screen.findByLabelText("Гарчиг"), "Том, жижгийг ялгах");
    const suggested = screen.getByRole("group", { name: "Тэмдэглэлд тохирох шалгуур" });
    expect(within(suggested).getByRole("button", { name: /^Ш24 нэмэх/ })).toBeInTheDocument();
  });

  it("removes a pair after the first, and never the first", { timeout: 20_000 }, async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<NewObservationPage />);

    await screen.findByLabelText("Асуулт 1");
    expect(screen.queryByRole("button", { name: "Асуулт 1-ийг хасах" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Асуулт нэмэх" }));
    await user.click(screen.getByRole("button", { name: "Асуулт 2-ийг хасах" }));
    expect(screen.queryByLabelText("Асуулт 2")).toBeNull();
  });
});
