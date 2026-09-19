import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import PlatformPage from "@/app/(app)/platform/page";

/**
 * Registering a kindergarten — the ESIS path and the manual exception.
 *
 * ★ Rewritten 2026-09-19 with the dialog. It was one form with an optional
 * ESIS box at the top; it is now a method chooser with ESIS selected by
 * default and a three-step flow behind it. Every assertion below is the same
 * fact the previous version checked — which row is offered, what is never
 * prefilled, what the operator is told — re-expressed against the flow that
 * now exists. The one behaviour that genuinely changed has its own test and
 * says so in place: a failed lookup no longer leaves a usable ESIS form, it
 * sends the operator to the manual method.
 *
 * ★★ `selectedChild: false`. The superadmin's shell returns before
 * `SelectedChildProvider` — a platform operator has no selected child — so
 * mounting the provider here would supply a context the real layout never
 * does, and a page that called `useSelectedChild()` would pass this test and
 * throw in production.
 *
 * ★★★ The operator holds **no membership** and `isSuperAdmin: true`. A session
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

const CREATED = {
  kindergarten: { id: "44444444-4444-4444-8444-444444444444", name: "ESIS-гүй" },
  admin: {
    id: "55555555-5555-4555-8555-555555555555",
    username: "erhlegch",
    lastName: "Тест",
    firstName: "Админ",
  },
  invitationToken: "tok",
};

async function openDialog() {
  renderWithProviders(<PlatformPage />, { selectedChild: false });
  const open = await screen.findByRole("button", { name: "Цэцэрлэг бүртгэх" });
  await userEvent.click(open);
  return within(await screen.findByRole("dialog", { name: "Цэцэрлэг бүртгэх" }));
}

async function lookupInstitution(dialog: ReturnType<typeof within>) {
  await userEvent.type(dialog.getByLabelText(/^ESIS байгууллагын ID/), "42778");
  await userEvent.click(dialog.getByRole("button", { name: "ESIS-ээс татах" }));
}

/** Step 1 → step 2, the director chooser. */
async function toDirectorStep(dialog: ReturnType<typeof within>) {
  await waitFor(() => expect(dialog.getByRole("button", { name: /Дараах/ })).toBeEnabled());
  await userEvent.click(dialog.getByRole("button", { name: /Дараах/ }));
}

describe("registering a kindergarten from an ESIS institution id", () => {
  beforeEach(() => {
    stubApi([...baseRoutes, { path: INSTITUTION_PATH, body: lookup() }]);
  });

  it("opens on the ESIS method, with the manual form not drawn at all", async () => {
    const dialog = await openDialog();

    expect(dialog.getByRole("radio", { name: /ESIS-ээс бүртгэх/ })).toBeChecked();
    expect(dialog.getByRole("radio", { name: /Гар аргаар бүртгэх/ })).not.toBeChecked();
    // The whole point of the redesign: no eight-field form on open.
    expect(dialog.queryByLabelText(/^Цэцэрлэгийн нэр/)).not.toBeInTheDocument();
  });

  it("shows the ministry's answer back rather than asking for it again", async () => {
    const dialog = await openDialog();
    await lookupInstitution(dialog);

    expect(await dialog.findByText("Дэгдээхий үрс цэцэрлэг")).toBeInTheDocument();
    expect(
      dialog.getByText("Улаанбаатар, Баянзүрх, 16-р хороо, Гудамж-52, Байр-8"),
    ).toBeInTheDocument();
    // `longName` is a dotted path. It is shown, labelled as the official name,
    // but it is never what the kindergarten is called.
    expect(dialog.getByText("Албан ёсны нэр")).toBeInTheDocument();
    // Nothing the ministry answered is offered as an input to retype.
    expect(dialog.queryByLabelText(/^Цэцэрлэгийн нэр/)).not.toBeInTheDocument();
    expect(dialog.queryByLabelText(/^Хаяг/)).not.toBeInTheDocument();
  });

  it("offers the эрхлэгч, whose job code maps to no role", async () => {
    // 1341 is refused by `roleForJobCode` because unattended self-registration
    // must never mint an administrator. Here a superadmin is choosing
    // deliberately, which is the approval step that rule is missing — so the
    // row this screen exists to pick must not be filtered out by its own null.
    const dialog = await openDialog();
    await lookupInstitution(dialog);
    await toDirectorStep(dialog);

    const choice = await dialog.findByRole("radio", { name: /Батсайхан Оюунаа/ });
    expect(choice).toBeEnabled();
    await userEvent.click(choice);
    expect(choice).toBeChecked();
  });

  it("fills the administrator's names from the chosen row but never the login name", async () => {
    const dialog = await openDialog();
    await lookupInstitution(dialog);
    await toDirectorStep(dialog);
    await userEvent.click(await dialog.findByRole("radio", { name: /Батсайхан Оюунаа/ }));

    expect(dialog.getByLabelText(/^Овог/)).toHaveValue("Батсайхан");
    expect(dialog.getByLabelText(/^Нэр \*/)).toHaveValue("Оюунаа");
    // A login name has to be something a person can type and remember, and
    // Mongolian names have no single obvious latin form.
    expect(dialog.getByLabelText(/^Нэвтрэх нэр/)).toHaveValue("");
  });

  it("cannot leave the director step without a login name", async () => {
    const dialog = await openDialog();
    await lookupInstitution(dialog);
    await toDirectorStep(dialog);
    await userEvent.click(await dialog.findByRole("radio", { name: /Батсайхан Оюунаа/ }));

    // The names came from ESIS; the one thing it cannot supply is the gate.
    expect(dialog.getByRole("button", { name: /Дараах/ })).toBeDisabled();
    await userEvent.type(dialog.getByLabelText(/^Нэвтрэх нэр/), "erhlegch");
    expect(dialog.getByRole("button", { name: /Дараах/ })).toBeEnabled();
  });

  it("reviews the whole thing before it registers anything", async () => {
    const { calls } = stubApi([
      ...baseRoutes,
      { path: INSTITUTION_PATH, body: lookup() },
      { path: "/platform/kindergartens", method: "POST", body: CREATED },
    ]);

    const dialog = await openDialog();
    await lookupInstitution(dialog);
    await toDirectorStep(dialog);
    await userEvent.click(await dialog.findByRole("radio", { name: /Батсайхан Оюунаа/ }));
    await userEvent.type(dialog.getByLabelText(/^Нэвтрэх нэр/), "erhlegch");
    await userEvent.click(dialog.getByRole("button", { name: /Дараах/ }));

    expect(await dialog.findByText("Мэдээллийг шалгах")).toBeInTheDocument();
    // Nothing has been sent yet — the review step is a step, not a receipt.
    expect(calls.find((call) => call.method === "POST")).toBeUndefined();

    await userEvent.click(dialog.getByRole("button", { name: /Цэцэрлэг бүртгэх/ }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === "POST");
      expect(post).toBeDefined();
      const body = post!.body as Record<string, unknown>;
      expect(body.esisInstitutionId).toBe("42778");
      expect(body.adminEsisPersonId).toBe(director.personId);
    });
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

  it("names the kindergarten already holding the institution, and goes no further", async () => {
    stubApi([...baseRoutes, { path: INSTITUTION_PATH, body: lookup({ alreadyUsed: true }) }]);
    const dialog = await openDialog();
    await lookupInstitution(dialog);

    // The warning names the kindergarten that holds it, so the operator knows
    // whether they are looking at a duplicate or at someone else's tenant.
    expect(
      await dialog.findByText(/аль хэдийн бүртгэлтэй: Дэгдээхий үрс цэцэрлэг/),
    ).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /Дараах/ })).toBeDisabled();
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
    // A warning, not a block — the classification is free text we do not own.
    expect(dialog.getByRole("button", { name: /Дараах/ })).toBeEnabled();
  });

  it("sends the operator to the manual method when ESIS does not answer", async () => {
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

    /*
     * ★ The behaviour that changed, and why it is still the same requirement.
     *
     * An outage at the ministry must not stop a kindergarten being registered.
     * It used to not stop it because the ESIS box sat on top of a full manual
     * form; now the two are separate methods, so carrying on means switching
     * to the one the client calls "тусгай тохиолдолд" — which is exactly the
     * case it exists for, and which leaves a record of the choice in the shape
     * of a tenant registered with no institution id.
     */
    await userEvent.click(dialog.getByRole("radio", { name: /Гар аргаар бүртгэх/ }));
    expect(dialog.getByLabelText(/^Цэцэрлэгийн нэр/)).toBeEnabled();
  });

  it("posts neither ESIS field from the manual method", async () => {
    const { calls } = stubApi([
      ...baseRoutes,
      { path: INSTITUTION_PATH, body: lookup() },
      { path: "/platform/kindergartens", method: "POST", body: CREATED },
    ]);
    const dialog = await openDialog();

    /*
     * ★ The lookup runs **first**, then the operator changes their mind. This
     * is the case that would silently map a tenant the operator believes they
     * registered by hand, so it is the one worth testing rather than a manual
     * path that never touched ESIS at all.
     */
    await lookupInstitution(dialog);
    await waitFor(() => expect(dialog.getByRole("button", { name: /Дараах/ })).toBeEnabled());
    await userEvent.click(dialog.getByRole("radio", { name: /Гар аргаар бүртгэх/ }));

    await userEvent.type(dialog.getByLabelText(/^Цэцэрлэгийн нэр/), "ESIS-гүй");
    await userEvent.type(dialog.getByLabelText(/^Овог/), "Тест");
    await userEvent.type(dialog.getByLabelText(/^Нэр \*/), "Админ");
    await userEvent.type(dialog.getByLabelText(/^Нэвтрэх нэр/), "erhlegch");
    await userEvent.click(dialog.getByRole("button", { name: /Цэцэрлэг бүртгэх/ }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === "POST");
      expect(post).toBeDefined();
      const body = post!.body as Record<string, unknown>;
      expect(body).not.toHaveProperty("esisInstitutionId");
      expect(body).not.toHaveProperty("adminEsisPersonId");
      // The name the ministry supplied must not survive the switch either.
      expect(body.name).toBe("ESIS-гүй");
    });
  });

  it("closes when the backdrop is clicked", async () => {
    // The client, 2026-09-19: "modal-ийн гадна дарахад modal алга болох ёстой
    // шүү бүх хэсэгт". `useBackdropDismiss` is the shared answer.
    await openDialog();
    const overlay = screen.getByRole("dialog", { name: "Цэцэрлэг бүртгэх" });

    await userEvent.click(overlay);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Цэцэрлэг бүртгэх" })).not.toBeInTheDocument(),
    );
  });
});
