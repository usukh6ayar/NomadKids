import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import PlatformPage from "@/app/(app)/platform/page";

/**
 * Registering a kindergarten from its ESIS institution id.
 *
 * ★ `selectedChild: false`. The superadmin's shell returns before
 * `SelectedChildProvider` — a platform operator has no selected child — so
 * mounting the provider here would supply a context the real layout never
 * does, and a page that called `useSelectedChild()` would pass this test and
 * throw in production.
 *
 * ★★ The operator holds **no membership** and `isSuperAdmin: true`. A session
 * that handed them an `ADMIN` membership would pass while the real operator,
 * who has none, got a 404 from every tenant route.
 */
const operator = () => {
  const base = sessionFor([]);
  return { ...base, memberships: [], user: { ...base.user, isSuperAdmin: true } };
};

const INSTITUTION_PATH = "/platform/esis/institutions/42778";

const STATS = { kindergartens: 1, groups: 0, children: 0, staff: 0, guardians: 0 };
const LIST = { items: [], total: 0, page: 1, pageSize: 50 };

/** The эрхлэгч. Job code 1341 maps to no role on purpose — see the test below. */
const director = {
  personId: "1000048746697",
  registerNumber: "УБ12345678",
  lastName: "Батсайхан",
  firstName: "Оюунаа",
  positionName: "эрхлэгч",
  jobCode: "1341-11",
  suggestedRole: null,
};

const cook = {
  personId: "1000048746698",
  registerNumber: "УБ87654321",
  lastName: "Цэрэн",
  firstName: "Болд",
  positionName: "ахлах Тогооч",
  jobCode: "5120-01",
  suggestedRole: "COOK",
};

const lookup = (overrides: Record<string, unknown> = {}) => ({
  institutionId: "42778",
  name: "Дэгдээхий үрс цэцэрлэг",
  longName: "Улаанбаатар.Баянзүрх.Дэгдээхий үрс цэцэрлэг",
  address: "Улаанбаатар, Баянзүрх, 16-р хороо, Гудамж-52, Байр-8",
  classification: "Цэцэрлэг",
  propertyType: "Хувийн",
  isKindergarten: true,
  alreadyUsed: false,
  staff: [director, cook],
  ...overrides,
});

const baseRoutes = [
  { path: "/auth/me", body: operator() },
  { path: "/platform/stats", body: STATS },
  { path: "/platform/kindergartens?", body: LIST },
];

async function openDialog() {
  renderWithProviders(<PlatformPage />, { selectedChild: false });
  const open = await screen.findByRole("button", { name: "Цэцэрлэг бүртгэх" });
  await userEvent.click(open);
  return within(await screen.findByRole("dialog", { name: "Цэцэрлэг бүртгэх" }));
}

async function lookupInstitution(dialog: ReturnType<typeof within>) {
  await userEvent.type(dialog.getByLabelText("ESIS institution ID"), "42778");
  await userEvent.click(dialog.getByRole("button", { name: "ESIS-ээс татах" }));
}

describe("registering a kindergarten from an ESIS institution id", () => {
  beforeEach(() => {
    stubApi([...baseRoutes, { path: INSTITUTION_PATH, body: lookup() }]);
  });

  it("fills the name and address from the ministry's answer", async () => {
    const dialog = await openDialog();
    await lookupInstitution(dialog);

    await waitFor(() =>
      expect(dialog.getByLabelText(/^Цэцэрлэгийн нэр/)).toHaveValue("Дэгдээхий үрс цэцэрлэг"),
    );
    // `longName` is a dotted path, not a display name — the screen must use `name`.
    expect(dialog.getByLabelText(/^Цэцэрлэгийн нэр/)).not.toHaveValue(
      "Улаанбаатар.Баянзүрх.Дэгдээхий үрс цэцэрлэг",
    );
    expect(dialog.getByLabelText("Хаяг")).toHaveValue(
      "Улаанбаатар, Баянзүрх, 16-р хороо, Гудамж-52, Байр-8",
    );
    // The confirmation line, as one string: the operator is checking that the
    // id they typed resolved to the institution they meant.
    expect(dialog.getByText("Дэгдээхий үрс цэцэрлэг · Цэцэрлэг · Хувийн")).toBeInTheDocument();
  });

  it("offers the эрхлэгч, whose job code maps to no role", async () => {
    // 1341 is refused by `roleForJobCode` because unattended self-registration
    // must never mint an administrator. Here a superadmin is choosing
    // deliberately, which is the approval step that rule is missing — so the
    // row this screen exists to pick must not be filtered out by its own null.
    const dialog = await openDialog();
    await lookupInstitution(dialog);

    const choice = await dialog.findByRole("radio", { name: /Батсайхан Оюунаа/ });
    expect(choice).toBeEnabled();
    await userEvent.click(choice);
    expect(choice).toBeChecked();
  });

  it("fills the administrator's names from the chosen row but never the login name", async () => {
    const dialog = await openDialog();
    await lookupInstitution(dialog);
    await userEvent.click(await dialog.findByRole("radio", { name: /Батсайхан Оюунаа/ }));

    expect(dialog.getByLabelText(/^Овог/)).toHaveValue("Батсайхан");
    expect(dialog.getByLabelText(/^Нэр \*/)).toHaveValue("Оюунаа");
    // A login name has to be something a person can type and remember, and
    // Mongolian names have no single obvious latin form.
    expect(dialog.getByLabelText(/^Нэвтрэх нэр/)).toHaveValue("");
  });

  it("says what to do when the ministry has not granted the institution", async () => {
    stubApi([
      ...baseRoutes,
      {
        path: INSTITUTION_PATH,
        status: 409,
        body: {
          type: "about:blank",
          title: "Зөрчил",
          status: 409,
          requestId: "r1",
          code: "SCOPE_DENIED",
          detail: "Яам энэ институцид эрх олгоогүй байна. Гэрээний дараа яамнаас нэмүүлнэ үү.",
        },
      },
    ]);
    const dialog = await openDialog();
    await lookupInstitution(dialog);

    expect(await dialog.findByText(/Яам энэ институцид эрх олгоогүй байна/)).toBeInTheDocument();
  });

  it("names the kindergarten already holding the institution", async () => {
    stubApi([...baseRoutes, { path: INSTITUTION_PATH, body: lookup({ alreadyUsed: true }) }]);
    const dialog = await openDialog();
    await lookupInstitution(dialog);

    // The warning names the kindergarten that holds it, so the operator knows
    // whether they are looking at a duplicate or at someone else's tenant.
    expect(
      await dialog.findByText(/аль хэдийн бүртгэлтэй: Дэгдээхий үрс цэцэрлэг/),
    ).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Бүртгэх" })).toBeDisabled();
  });

  it("warns when the institution is not a kindergarten", async () => {
    stubApi([
      ...baseRoutes,
      {
        path: INSTITUTION_PATH,
        body: lookup({
          isKindergarten: false,
          classification: "Ерөнхий боловсролын сургууль",
        }),
      },
    ]);
    const dialog = await openDialog();
    await lookupInstitution(dialog);

    expect(await dialog.findByText(/цэцэрлэг биш/)).toBeInTheDocument();
  });

  it("lets the operator carry on when ESIS does not answer", async () => {
    stubApi([
      ...baseRoutes,
      {
        path: INSTITUTION_PATH,
        status: 502,
        body: {
          type: "about:blank",
          title: "Гадаад системээс хариу ирсэнгүй",
          status: 502,
          requestId: "r2",
          code: "TIMEOUT",
          detail: "ESIS хариу өгсөнгүй.",
        },
      },
    ]);
    const dialog = await openDialog();
    await lookupInstitution(dialog);

    expect(await dialog.findByText(/ESIS хариу өгсөнгүй/)).toBeInTheDocument();
    // An outage at the ministry must not stop a kindergarten being registered;
    // the id can be mapped later.
    expect(dialog.getByRole("button", { name: "Бүртгэх" })).toBeEnabled();
  });

  it("posts neither new field when the institution id is never touched", async () => {
    const { calls } = stubApi([
      ...baseRoutes,
      {
        path: "/platform/kindergartens",
        method: "POST",
        body: {
          kindergarten: { id: "44444444-4444-4444-8444-444444444444", name: "ESIS-гүй" },
          admin: {
            id: "55555555-5555-4555-8555-555555555555",
            username: "erhlegch",
            lastName: "Тест",
            firstName: "Админ",
          },
          invitationToken: "tok",
        },
      },
    ]);
    const dialog = await openDialog();

    await userEvent.type(dialog.getByLabelText(/^Цэцэрлэгийн нэр/), "ESIS-гүй");
    await userEvent.type(dialog.getByLabelText(/^Нэвтрэх нэр/), "erhlegch");
    await userEvent.type(dialog.getByLabelText(/^Овог/), "Тест");
    await userEvent.type(dialog.getByLabelText(/^Нэр \*/), "Админ");
    await userEvent.click(dialog.getByRole("button", { name: "Бүртгэх" }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post).toBeDefined();
      const body = post!.body as Record<string, unknown>;
      expect(body).not.toHaveProperty("esisInstitutionId");
      expect(body).not.toHaveProperty("adminEsisPersonId");
    });
  });
});
