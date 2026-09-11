import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import { CreateSurveyWizard } from "@/components/survey/create-survey-wizard";

/**
 * Шинэ судалгаа / Шинэ асуулга — the client's 2026-09-10 wizard.
 *
 * ★ What is asserted is the *sequence*, because that is the feature.
 *
 * The old dialog was six fields and made a survey with no questions in it — a
 * teacher then landed on a separate editor to write them, which is two screens
 * for one act. The wizard collects the whole thing, so the tests follow a
 * teacher through it and check what reaches the API at the end.
 *
 * ★★ Three calls in a fixed order, and the order is not a style choice:
 * `PUT /questions` is refused on a published survey (it deletes and recreates
 * every row, orphaning answers) and `publish` is refused on one with no
 * questions. A refactor that "simplified" this into one call would fail only
 * against a real server.
 */

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const NEW_ID = "66666666-6666-4666-8666-666666666666";

const GROUPS = {
  items: [{ id: GROUP_ID, name: "Дэлбээ бүлэг", ageBand: "MIDDLE", childCount: 18 }],
  page: 1,
  pageSize: 100,
  total: 1,
  totalPages: 1,
};

function stubWizard(roles: Parameters<typeof sessionFor>[0] = ["ADMIN"]) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    { path: "/groups", body: GROUPS },
    { path: `/kindergartens/${KINDERGARTEN_ID}/terms`, body: [] },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/surveys`,
      method: "POST",
      body: {
        id: NEW_ID,
        title: "Шинэ",
        category: "SATISFACTION",
        scope: "CHILD",
        kind: "POLL",
        status: "DRAFT",
        questions: [],
        createdAt: "2026-09-10T00:00:00.000Z",
      },
      status: 201,
    },
    { path: `/surveys/${NEW_ID}/questions`, method: "PUT", body: {} },
    { path: `/surveys/${NEW_ID}/publish`, method: "POST", body: {}, status: 201 },
  ]);
}

const sent = (api: ReturnType<typeof stubApi>, method: string, url: string) =>
  api.calls.find((call) => call.method === method && call.url === url);

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

function open(kind: "POLL" | "FORM", roles: Parameters<typeof sessionFor>[0] = ["ADMIN"]) {
  const api = stubWizard(roles);
  renderWithProviders(
    <CreateSurveyWizard kindergartenId={KINDERGARTEN_ID} kind={kind} onClose={() => {}} />,
  );
  return api;
}

describe("the poll wizard", () => {
  it("walks three steps, not four", async () => {
    open("POLL");

    const steps = await screen.findAllByRole("button", { name: /-р алхам/ });
    expect(steps).toHaveLength(3);
    expect(screen.getByText("Үндсэн мэдээлэл")).toBeInTheDocument();
  });

  /**
   * ★ Дараах stays disabled until the step is answerable.
   *
   * Validation on the step rather than on the final submit: a wizard whose
   * last button reports a fault three screens back is the failure steps exist
   * to avoid.
   */
  it("will not advance without a title", async () => {
    const user = userEvent.setup();
    open("POLL");

    expect(await screen.findByRole("button", { name: /Дараах/ })).toBeDisabled();

    await user.type(screen.getByLabelText(/Гарчиг/), "Аялалд оролцох уу?");
    expect(screen.getByRole("button", { name: /Дараах/ })).toBeEnabled();
  });

  /** A poll's question is always a choice, so no type picker is drawn. */
  it("does not ask a poll what shape its question is", async () => {
    const user = userEvent.setup();
    open("POLL");

    await user.type(await screen.findByLabelText(/Гарчиг/), "Аялалд оролцох уу?");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));

    expect(await screen.findByText("Сонголтууд")).toBeInTheDocument();
    expect(screen.queryByLabelText("Хариултын хэлбэр")).not.toBeInTheDocument();
  });

  it("needs two real options before it will go on", async () => {
    const user = userEvent.setup();
    open("POLL");

    await user.type(await screen.findByLabelText(/Гарчиг/), "Аялалд оролцох уу?");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));
    await user.type(await screen.findByLabelText(/асуултын текст/), "Ирэх үү?");

    expect(screen.getByRole("button", { name: /Дараах/ })).toBeDisabled();

    await user.type(screen.getByLabelText("1-р сонголт"), "Ирнэ");
    await user.type(screen.getByLabelText("2-р сонголт"), "Ирэхгүй");

    expect(screen.getByRole("button", { name: /Дараах/ })).toBeEnabled();
  });

  it("creates, saves the questions, then publishes — in that order", async () => {
    const user = userEvent.setup();
    const api = open("POLL");

    await user.type(await screen.findByLabelText(/Гарчиг/), "Аялалд оролцох уу?");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));
    await user.type(await screen.findByLabelText(/асуултын текст/), "Ирэх үү?");
    await user.type(screen.getByLabelText("1-р сонголт"), "Ирнэ");
    await user.type(screen.getByLabelText("2-р сонголт"), "Ирэхгүй");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));
    await user.click(await screen.findByRole("button", { name: "Үүсгэх" }));

    await waitFor(() => expect(sent(api, "POST", `/surveys/${NEW_ID}/publish`)).toBeDefined());

    const create = sent(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)!;
    expect(create.body).toMatchObject({ title: "Аялалд оролцох уу?", kind: "POLL" });

    const questions = sent(api, "PUT", `/surveys/${NEW_ID}/questions`)!;
    expect(questions.body).toEqual({
      questions: [
        { order: 0, type: "SINGLE_CHOICE", prompt: "Ирэх үү?", options: ["Ирнэ", "Ирэхгүй"] },
      ],
    });

    // The order the API requires.
    const order = api.calls.filter((c) => c.method !== "GET").map((c) => c.url);
    expect(order).toEqual([
      `/kindergartens/${KINDERGARTEN_ID}/surveys`,
      `/surveys/${NEW_ID}/questions`,
      `/surveys/${NEW_ID}/publish`,
    ]);
  });

  /**
   * ★ The draft door stays open on the last step.
   *
   * Publishing is what the design does at the end, and it is right. But the
   * Ноорог tab has to stay reachable from the only place a survey is made, or
   * it becomes a tab for surveys nobody can create.
   */
  it("can stop at a draft instead of publishing", async () => {
    const user = userEvent.setup();
    const api = open("POLL");

    await user.type(await screen.findByLabelText(/Гарчиг/), "Аялалд оролцох уу?");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));
    await user.type(await screen.findByLabelText(/асуултын текст/), "Ирэх үү?");
    await user.type(screen.getByLabelText("1-р сонголт"), "Ирнэ");
    await user.type(screen.getByLabelText("2-р сонголт"), "Ирэхгүй");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));
    await user.click(await screen.findByRole("button", { name: "Ноорог болгох" }));

    await waitFor(() => expect(sent(api, "PUT", `/surveys/${NEW_ID}/questions`)).toBeDefined());
    expect(sent(api, "POST", `/surveys/${NEW_ID}/publish`)).toBeUndefined();
  });

  it("says what it made when it is done", async () => {
    const user = userEvent.setup();
    open("POLL");

    await user.type(await screen.findByLabelText(/Гарчиг/), "Аялалд оролцох уу?");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));
    await user.type(await screen.findByLabelText(/асуултын текст/), "Ирэх үү?");
    await user.type(screen.getByLabelText("1-р сонголт"), "Ирнэ");
    await user.type(screen.getByLabelText("2-р сонголт"), "Ирэхгүй");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));
    await user.click(await screen.findByRole("button", { name: "Үүсгэх" }));

    expect(await screen.findByText("Асуулга амжилттай үүслээ!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Жагсаалтад буцах/ })).toBeInTheDocument();
  });
});

describe("the questionnaire wizard", () => {
  it("walks four steps", async () => {
    open("FORM");

    expect(await screen.findAllByRole("button", { name: /-р алхам/ })).toHaveLength(4);
  });

  it("offers only the question types the product can actually answer", async () => {
    const user = userEvent.setup();
    open("FORM");

    await user.type(await screen.findByLabelText(/Гарчиг/), "Сэтгэл ханамж");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));
    await user.click(await screen.findByRole("button", { name: /Дараах/ }));
    await user.click(await screen.findByRole("button", { name: "Асуулт нэмэх" }));
    // The card has to be on screen before its trigger is pressed: Radix closes
    // a popup opened in the same tick as the click that mounted it.
    await screen.findByLabelText(/асуултын текст/);

    // `Select` is a Radix listbox, so its options exist only while it is open.
    await user.click(screen.getByLabelText("Хариултын хэлбэр"));
    const offered = (await screen.findAllByRole("option")).map((o) => o.textContent);

    expect(offered).toEqual(["Нэг сонголт", "Олон сонголт", "Чөлөөт бичвэр", "Үнэлгээ (1–5)"]);
    // Жагсаах, Огноо сонгох and Файл оруулах are in the client's drawing and
    // in no part of the product: a button storing a type nothing can answer
    // would make a survey a family opens and cannot finish.
    expect(offered).not.toContain("Жагсаах");
  });

  /**
   * ★ A shuffle switch is drawn only where there is an order to shuffle.
   *
   * A one-question survey has nothing to reorder, and a switch that provably
   * does nothing teaches people the settings are decorative.
   */
  it("hides the shuffle switch on a one-question survey", async () => {
    const user = userEvent.setup();
    open("FORM");

    await user.type(await screen.findByLabelText(/Гарчиг/), "Сэтгэл ханамж");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));
    await user.click(await screen.findByRole("button", { name: /Дараах/ }));
    await user.click(await screen.findByRole("button", { name: "Асуулт нэмэх" }));
    await user.type(await screen.findByLabelText(/асуултын текст/), "Хэр вэ?");
    await user.type(screen.getByLabelText("1-р сонголт"), "Сайн");
    await user.type(screen.getByLabelText("2-р сонголт"), "Дунд");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));

    expect(await screen.findByLabelText(/Хариулт нуух/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/дарааллыг санамсаргүй/)).not.toBeInTheDocument();
  });
});

describe("who the wizard lets you address", () => {
  it("offers an administrator the whole kindergarten", async () => {
    const user = userEvent.setup();
    open("FORM", ["ADMIN"]);

    await user.type(await screen.findByLabelText(/Гарчиг/), "Сэтгэл ханамж");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));

    await user.click(await screen.findByLabelText("Хэнд"));
    expect(await screen.findByRole("option", { name: "Бүх бүлэг" })).toBeInTheDocument();
  });

  /**
   * ★ A courtesy, not the rule.
   *
   * `TenantAccessService.assertCanAddressAudience` answers 404 to a teacher who
   * omits the group whatever this screen drew. What this prevents is a teacher
   * filling in four steps and then being told no.
   */
  it("does not offer a teacher the whole kindergarten", async () => {
    const user = userEvent.setup();
    open("FORM", ["TEACHER"]);

    await user.type(await screen.findByLabelText(/Гарчиг/), "Сэтгэл ханамж");
    await user.click(screen.getByRole("button", { name: /Дараах/ }));

    await user.click(await screen.findByLabelText("Хэнд"));
    expect(await screen.findByRole("option", { name: "Дэлбээ бүлэг" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Бүх бүлэг" })).not.toBeInTheDocument();
  });
});
