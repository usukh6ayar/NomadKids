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

const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const NEW_ID = "66666666-6666-4666-8666-666666666666";
const TERM_ID = "77777777-7777-4777-8777-777777777777";

function stubWizard(roles: Parameters<typeof sessionFor>[0] = ["ADMIN"]) {
  const year = new Date().getUTCFullYear();
  return stubApi([
    { path: "/auth/me", body: sessionFor(roles) },
    {
      path: "/groups",
      body: {
        items: [{ id: GROUP_ID, name: "Дэлбээ бүлэг", ageBand: "MIDDLE", childCount: 18 }],
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      },
    },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/terms`,
      body: [
        {
          id: TERM_ID,
          number: 1,
          name: "1-р улирал",
          startsOn: `${year}-01-01`,
          endsOn: `${year}-12-31`,
        },
      ],
    },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/surveys`,
      method: "POST",
      status: 201,
      body: {
        id: NEW_ID,
        title: "Шинэ",
        category: "PARENT_ENGAGEMENT",
        scope: "CHILD",
        kind: "FORM",
        status: "DRAFT",
        questions: [],
        createdAt: new Date().toISOString(),
      },
    },
    { path: `/surveys/${NEW_ID}/questions`, method: "PUT", body: {} },
    { path: `/surveys/${NEW_ID}/publish`, method: "POST", status: 201, body: {} },
  ]);
}

function open(roles: Parameters<typeof sessionFor>[0] = ["ADMIN"], kind: "FORM" | "POLL" = "FORM") {
  const api = stubWizard(roles);
  renderWithProviders(
    <CreateSurveyWizard kindergartenId={KINDERGARTEN_ID} kind={kind} onClose={() => {}} />,
  );
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setParams({});
  setSearchParams("");
});

describe("single-page survey creation", () => {
  it("shows every creation section on one screen without wizard steps", async () => {
    open();
    expect(await screen.findByLabelText(/Гарчиг/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Тайлбар/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Асуулт нэмэх" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Үнэлгээний төрөл" })).toHaveTextContent(
      "Явцын үнэлгээ",
    );
    expect(screen.queryByRole("button", { name: /-р алхам/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Зорилго")).not.toBeInTheDocument();
    expect(screen.queryByText("Нэмэлт тэмдэглэл")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Улирал")).not.toBeInTheDocument();
  });

  it("hides audience from a teacher and selects their group automatically", async () => {
    const user = userEvent.setup();
    const api = open(["TEACHER"]);
    expect(await screen.findByLabelText(/Гарчиг/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Хэнд")).not.toBeInTheDocument();
    await fillQuestion(user);
    await user.type(screen.getByLabelText(/Гарчиг/), "Сэтгэл ханамж");
    await waitFor(() => expect(screen.getByRole("button", { name: "Үүсгэх" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Үүсгэх" }));
    await waitFor(() =>
      expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)).toBeDefined(),
    );
    expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)!.body).toMatchObject({
      groupId: GROUP_ID,
    });
  });

  it("keeps audience selection for an administrator", async () => {
    open(["ADMIN"]);
    expect(await screen.findByLabelText("Хэнд")).toBeInTheDocument();
  });

  it("removes description from a poll and offers Other", async () => {
    const user = userEvent.setup();
    open(["TEACHER"], "POLL");
    expect(await screen.findByLabelText(/Гарчиг/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Тайлбар/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Үнэлгээний төрөл" }));
    expect(screen.getByRole("option", { name: "Бусад" })).toBeInTheDocument();
  });

  it("automatically saves the current term and selected assessment period", async () => {
    const user = userEvent.setup();
    const api = open(["TEACHER"]);
    await fillQuestion(user);
    await user.type(screen.getByLabelText(/Гарчиг/), "Хөгжлийн судалгаа");
    await user.click(screen.getByRole("combobox", { name: "Үнэлгээний төрөл" }));
    await user.click(screen.getByRole("option", { name: "Үр дүнгийн үнэлгээ" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Үүсгэх" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Үүсгэх" }));
    await waitFor(() =>
      expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)).toBeDefined(),
    );
    expect(findCall(api, "POST", `/kindergartens/${KINDERGARTEN_ID}/surveys`)!.body).toMatchObject({
      termId: TERM_ID,
      period: "ENDLINE",
      purpose: null,
      closingNote: null,
    });
  });

  it("starts from a ready template and previews the parent's phone form", async () => {
    const user = userEvent.setup();
    open(["TEACHER"]);

    await user.click(await screen.findByLabelText("Бэлэн загвараас эхлэх"));
    await user.click(screen.getByRole("option", { name: "Эцэг эхийн сэтгэл ханамж" }));

    expect(screen.getByLabelText(/Гарчиг/)).toHaveValue("Эцэг эхийн сэтгэл ханамжийн судалгаа");
    expect(screen.getAllByLabelText(/асуултын текст/)).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Урьдчилан харах" }));
    expect(
      screen.getByText("Эцэг эхийн сэтгэл ханамжийн судалгаа", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("duplicates and reorders question cards without leaving the page", async () => {
    const user = userEvent.setup();
    open(["TEACHER"]);
    await user.click(await screen.findByLabelText("Бэлэн загвараас эхлэх"));
    await user.click(screen.getByRole("option", { name: "Хүүхдийн хөгжил" }));

    await user.click(screen.getByRole("button", { name: "1-р асуултыг хувилах" }));
    expect(screen.getAllByLabelText(/асуултын текст/)).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "2-р асуултыг доош зөөх" }));
    expect(screen.getAllByLabelText(/асуултын текст/)).toHaveLength(4);
  });

  it("keeps dates and advanced switches out of the main flow", async () => {
    const user = userEvent.setup();
    open(["TEACHER"]);

    await screen.findByLabelText(/Гарчиг/);
    expect(screen.queryByLabelText("Эхлэх огноо")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Хариулт нуух")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Нэмэлт тохиргоо" }));
    expect(screen.getByLabelText("Эхлэх огноо")).toBeInTheDocument();
    expect(screen.getByLabelText("Хариулт нуух")).toBeInTheDocument();
  });

  it("restores a locally autosaved draft", async () => {
    window.localStorage.setItem(
      `nomadkids:survey-draft:${KINDERGARTEN_ID}:FORM`,
      JSON.stringify({
        title: "Хадгалсан ноорог",
        description: "",
        questions: [{ type: "TEXT", prompt: "Санал хүсэлт", options: [] }],
      }),
    );

    open(["TEACHER"]);
    expect(await screen.findByLabelText(/Гарчиг/)).toHaveValue("Хадгалсан ноорог");
    expect(screen.getByLabelText(/асуултын текст/)).toHaveValue("Санал хүсэлт");
  });
});

async function fillQuestion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Асуулт нэмэх" }));
  await user.type(await screen.findByLabelText(/асуултын текст/), "Хүүхэд тань дуртай юу?");
  await user.type(screen.getByLabelText("1-р сонголт"), "Тийм");
  await user.type(screen.getByLabelText("2-р сонголт"), "Үгүй");
}

function findCall(api: ReturnType<typeof stubApi>, method: string, url: string) {
  return api.calls.find((call) => call.method === method && call.url === url);
}
