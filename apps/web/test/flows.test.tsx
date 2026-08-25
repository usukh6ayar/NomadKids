import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  ROUTER,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import LoginPage from "@/app/login/page";
import NewObservationPage from "@/app/(app)/children/[childId]/observations/new/page";
import GroupAssessmentPage from "@/app/(app)/groups/[groupId]/assessment/page";
import NotificationsPage from "@/app/(app)/notifications/page";
import ChildDetailPage from "@/app/(app)/children/[childId]/page";
import NewChildPage from "@/app/(app)/children/new/page";
import EditChildPage from "@/app/(app)/children/[childId]/edit/page";
import { PhotoUpload } from "@/components/media/photo-upload";
import { ChildGallery } from "@/components/media/child-gallery";
import { ObservationPhotos } from "@/components/observations/observation-photos";
import DashboardPage from "@/app/(app)/dashboard/page";
import TermReportPage from "@/app/(app)/children/[childId]/term-report/page";
import NotificationDetailPage from "@/app/(app)/notifications/[notificationId]/page";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const TERM_ID = "66666666-6666-4666-8666-666666666666";
const DOMAIN_ID = "77777777-7777-4777-8777-777777777777";
const LEVEL_ID = "88888888-8888-4888-8888-888888888888";
const TYPE_ID = "99999999-9999-4999-8999-999999999999";

/**
 * `GET /children/:id/media` answers with a page, not an array.
 *
 * ★ Worth spelling out rather than reusing `[]`: a stub of the wrong shape does
 * not fail here, it makes the component's query error and render an error
 * state, and the assertions in these tests are about other things — so the
 * suite would stay green while the fixture described an API that no longer
 * exists.
 */
const emptyMediaPage = { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 };

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
  kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Цэцэрлэг" },
  healthNotes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  setParams({});
  setSearchParams("");
});

// ── Login ───────────────────────────────────────────────────────────────────

describe("login", () => {
  it("shows the server's message on a bad password and keeps what was typed", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", status: 401 },
      {
        path: "/auth/login",
        status: 401,
        body: {
          type: "about:blank",
          title: "Алдаа",
          status: 401,
          requestId: "t",
          detail: "Нэвтрэх нэр эсвэл нууц үг буруу байна",
        },
      },
    ]);

    renderWithProviders(<LoginPage />);

    const identifier = screen.getByLabelText(/Нэвтрэх нэр, утас эсвэл и-мэйл/);
    await user.type(identifier, "bagsh");
    await user.type(screen.getByLabelText("Нууц үг *"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Нэвтрэх" }));

    await waitFor(() =>
      expect(screen.getByText("Нэвтрэх нэр эсвэл нууц үг буруу байна")).toBeInTheDocument(),
    );

    // ★ Input is preserved on failure. Clearing the form means retyping a
    // username that was never the problem.
    expect(identifier).toHaveValue("bagsh");
  });

  /**
   * ★ No token is ever written to storage.
   *
   * The API sets HttpOnly cookies; the response body carries only a user
   * summary. This asserts the browser side never squirrels a credential away,
   * which is the failure mode a "just cache the token" change would introduce.
   */
  it("stores no credential in localStorage or sessionStorage", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", status: 401 },
      { path: "/auth/login", body: sessionFor(["TEACHER"]) },
      { path: "/dashboard/primary", body: { dashboard: "teacher" } },
    ]);

    renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText(/Нэвтрэх нэр, утас эсвэл и-мэйл/), "bagsh");
    await user.type(screen.getByLabelText("Нууц үг *"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Нэвтрэх" }));

    // Wait for the login to actually complete before asserting.
    await waitFor(() =>
      expect(ROUTER.replace).toHaveBeenCalledWith(expect.stringContaining("/dashboard")),
    );

    expect(Object.keys({ ...localStorage })).toHaveLength(0);
    expect(Object.keys({ ...sessionStorage })).toHaveLength(0);
  });
});

// ── Observations ────────────────────────────────────────────────────────────

describe("recording an observation", () => {
  /**
   * ★ The single most consequential default in the product.
   *
   * A teacher's working note is private until they deliberately share it. If
   * this checkbox ever shipped pre-checked, every private note would be
   * published to families by default — and nobody would notice until one was.
   */
  it("leaves 'эцэг эх харах боломжтой' unchecked by default", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/children/${CHILD_ID}/observations/types`, body: [{ id: TYPE_ID, name: "Чөлөөт" }] },
      { path: `/children/${CHILD_ID}`, body: child },
    ]);

    renderWithProviders(<NewObservationPage />);

    const checkbox = await screen.findByLabelText(/Эцэг эх харах боломжтой/);
    expect(checkbox).not.toBeChecked();
  });

  it("submits the teacher's visibility choice", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/children/${CHILD_ID}/observations/types`, body: [{ id: TYPE_ID, name: "Чөлөөт" }] },
      {
        path: `/children/${CHILD_ID}/observations`,
        method: "POST",
        body: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          observedOn: "2026-08-19",
          source: "TEACHER",
          reviewStatus: "APPROVED",
          visibleToParents: true,
          media: [],
        },
      },
      { path: `/children/${CHILD_ID}/media`, body: emptyMediaPage },
      { path: `/children/${CHILD_ID}`, body: child },
    ]);

    renderWithProviders(<NewObservationPage />);

    // The <option> arrives with the types query, which resolves after the
    // select itself renders — selecting before then finds an empty list.
    await waitFor(() => expect(screen.getByRole("option", { name: "Чөлөөт" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/Ажиглалтын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/Нөхцөл байдал/), "Тоглоомын талбайд");
    await user.click(screen.getByLabelText(/Эцэг эх харах боломжтой/));
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(screen.getByText("Ажиглалт хадгалагдлаа.")).toBeInTheDocument());

    const post = calls.find((c) => c.method === "POST" && c.url.includes("/observations"));
    expect(post?.body).toMatchObject({ typeId: TYPE_ID, visibleToParents: true });
  });

  /**
   * ★ A parent posts to a different endpoint with a smaller body.
   *
   * `visibleToParents`, `includeInReport` and `typeId` are the teacher's
   * decisions (RFP §5.4) and the parent schema is `.strict()` — sending them
   * would be a 400.
   */
  it("a parent submits through /parent-observations without teacher-only fields", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: `/children/${CHILD_ID}/parent-observations`,
        method: "POST",
        body: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          observedOn: "2026-08-19",
          source: "PARENT",
          reviewStatus: "PENDING",
          visibleToParents: true,
          media: [],
        },
      },
      { path: `/children/${CHILD_ID}/media`, body: emptyMediaPage },
      { path: `/children/${CHILD_ID}`, body: child },
    ]);

    renderWithProviders(<NewObservationPage />);

    await screen.findByLabelText(/Нөхцөл байдал/);

    // The teacher's controls are simply not rendered.
    expect(screen.queryByLabelText(/Эцэг эх харах боломжтой/)).toBeNull();
    expect(screen.queryByLabelText(/Ажиглалтын төрөл/)).toBeNull();

    await user.type(screen.getByLabelText(/Нөхцөл байдал/), "Гэртээ ном уншлаа");
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/parent-observations"))).toBe(
        true,
      ),
    );

    const post = calls.find((c) => c.url.includes("/parent-observations"));
    expect(post?.body).not.toHaveProperty("visibleToParents");
    expect(post?.body).not.toHaveProperty("typeId");
  });
});

// ── Assessment ──────────────────────────────────────────────────────────────

describe("group assessment", () => {
  const column = {
    group: { id: GROUP_ID, name: "Дунд бүлэг" },
    term: { id: TERM_ID, number: 1, name: "I улирал" },
    domain: { id: DOMAIN_ID, name: "Хэл яриа", color: "#6C63FF" },
    levels: [
      { id: LEVEL_ID, value: 1, label: "Дэмжлэгтэй" },
      { id: "88888888-8888-4888-8888-888888888889", value: 2, label: "Бие даан" },
    ],
    children: [{ childId: CHILD_ID, lastName: "Ганболд", firstName: "Батбаяр", assessment: null }],
  };

  function stubAssessment() {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/groups/${GROUP_ID}/assessments`, body: column },
      {
        path: `/groups/${GROUP_ID}`,
        body: {
          id: GROUP_ID,
          name: "Дунд бүлэг",
          kindergartenId: "33333333-3333-4333-8333-333333333333",
        },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/assessment-config",
        body: { domains: [{ id: DOMAIN_ID, name: "Хэл яриа" }], levels: column.levels },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/terms",
        body: [{ id: TERM_ID, number: 1, name: "I улирал" }],
      },
    ]);
  }

  /**
   * ★ The scope guard. The nine-domain matrix was explicitly cancelled: one
   * domain at a time, chosen from a single select. A test that asserts the
   * *absence* of the matrix is what stops it creeping back.
   */
  it("assesses one domain at a time, never a grid of domains", async () => {
    setParams({ groupId: GROUP_ID });
    setSearchParams(`termId=${TERM_ID}&domainId=${DOMAIN_ID}`);
    stubAssessment();

    renderWithProviders(<GroupAssessmentPage />);

    await waitFor(() => expect(screen.getByLabelText(/Хөгжлийн чиглэл/)).toBeInTheDocument());

    // Exactly one domain selector, and it is a single-select.
    const domainSelect = screen.getByLabelText(/Хөгжлийн чиглэл/) as HTMLSelectElement;
    expect(domainSelect.multiple).toBe(false);

    // One radiogroup per child — the level choice — not one per domain.
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
  });

  it("saves the whole column in one request", async () => {
    const user = userEvent.setup();
    setParams({ groupId: GROUP_ID });
    setSearchParams(`termId=${TERM_ID}&domainId=${DOMAIN_ID}`);

    const { calls } = stubAssessment();

    renderWithProviders(<GroupAssessmentPage />);

    await waitFor(() => expect(screen.getByText("Ганболд Батбаяр")).toBeInTheDocument());

    await user.click(screen.getByRole("radio", { name: "Дэмжлэгтэй" }));

    // A pending change is stated, not just implied by a colour.
    await waitFor(() =>
      expect(screen.getByText(/1 хүүхдийн үнэлгээ хадгалагдаагүй/)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT");
      expect(put?.body).toMatchObject({
        termId: TERM_ID,
        domainId: DOMAIN_ID,
        entries: [{ childId: CHILD_ID, levelId: LEVEL_ID }],
      });
    });
  });
});

// ── Notifications ───────────────────────────────────────────────────────────

describe("notifications", () => {
  it("marks an announcement read when it is opened", async () => {
    const user = userEvent.setup();

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      {
        path: "/notifications",
        body: {
          items: [
            {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              title: "Аялал",
              body: "Маргааш аялалд явна",
              reads: [],
              targets: [],
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: "/notifications/cccccccc-cccc-4ccc-8ccc-cccccccccccc/read",
        method: "POST",
        body: {},
      },
    ]);

    renderWithProviders(<NotificationsPage />);

    await waitFor(() => expect(screen.getByText("Аялал")).toBeInTheDocument());

    // Unread state is announced, not carried by the dot alone. (The same word
    // is also the filter button, hence scoping to the link.)
    const link = screen.getByRole("link", { name: /Аялал/ });
    expect(link).toHaveTextContent("Уншаагүй");

    await user.click(screen.getByText("Аялал"));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/read"))).toBe(true),
    );
  });
});

// ── Not found ───────────────────────────────────────────────────────────────

describe("a child the viewer may not see", () => {
  /**
   * ★ 404 renders as "Олдсонгүй", never as a permissions message.
   *
   * The API refuses to distinguish absent from forbidden, and the UI must not
   * reintroduce the distinction — saying "танд эрх байхгүй" would confirm the
   * record exists.
   */
  it("renders not-found and never mentions permissions", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/children/${CHILD_ID}`, status: 404 },
    ]);

    renderWithProviders(<ChildDetailPage />);

    await waitFor(() => expect(screen.getByText("Олдсонгүй")).toBeInTheDocument());
    expect(screen.queryByText(/эрх байхгүй/)).toBeNull();
  });
});

// ── Registering a child ─────────────────────────────────────────────────────

describe("registering a child", () => {
  it("sends the group with the child, so the roster shows them at once", async () => {
    const user = userEvent.setup();

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups",
        body: {
          items: [{ id: GROUP_ID, name: "Дунд бүлэг" }],
          total: 1,
          page: 1,
          pageSize: 25,
          totalPages: 1,
        },
      },
      { path: "/kindergartens/", method: "POST", body: { id: CHILD_ID } },
    ]);

    renderWithProviders(<NewChildPage />);

    await user.type(await screen.findByLabelText(/Овог/), "Ганболд");
    await user.type(screen.getByLabelText(/^Нэр/), "Батбаяр");
    await user.selectOptions(screen.getByLabelText(/Хүйс/), "MALE");
    await user.type(screen.getByLabelText(/Төрсөн огноо/), "2022-03-15");
    // The select is disabled while the group list loads, so waiting for the
    // option is what makes this deterministic rather than lucky.
    await screen.findByRole("option", { name: "Дунд бүлэг" });
    await user.selectOptions(screen.getByLabelText(/Бүлэг/), GROUP_ID);

    await user.click(screen.getByRole("button", { name: "Бүртгэх" }));

    await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith(`/children/${CHILD_ID}`));

    const post = calls.find((c) => c.method === "POST")!;
    // ★ The group has to travel with the child. Registered without one, the
    // child belongs to no roster and no teacher ever sees them.
    expect(post.body).toMatchObject({
      lastName: "Ганболд",
      firstName: "Батбаяр",
      sex: "MALE",
      dateOfBirth: "2022-03-15",
      groupId: GROUP_ID,
    });
  });

  it("omits the register number rather than sending an empty one", async () => {
    const user = userEvent.setup();

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/groups",
        body: { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 },
      },
      { path: "/kindergartens/", method: "POST", body: { id: CHILD_ID } },
    ]);

    renderWithProviders(<NewChildPage />);

    await user.type(await screen.findByLabelText(/Овог/), "Ганболд");
    await user.type(screen.getByLabelText(/^Нэр/), "Батбаяр");
    await user.selectOptions(screen.getByLabelText(/Хүйс/), "FEMALE");
    await user.type(screen.getByLabelText(/Төрсөн огноо/), "2022-03-15");

    await user.click(screen.getByRole("button", { name: "Бүртгэх" }));

    await waitFor(() => expect(ROUTER.push).toHaveBeenCalled());

    const post = calls.find((c) => c.method === "POST")!;
    // "" would fail the two-letters-eight-digits rule; absent means "not
    // recorded yet", which is what an empty field means.
    expect(post.body).not.toHaveProperty("nationalId");
    expect(post.body).not.toHaveProperty("groupId");
  });
});

// ── Editing a child ─────────────────────────────────────────────────────────

describe("editing a child", () => {
  const childWithId = { ...child, nationalId: "УБ12345678" };

  /**
   * ★ A teacher is not shown the transfer card.
   *
   * `POST /children/:id/enrollments` resolves the target group through the
   * actor's *admin* kindergartens, so for a teacher it can only ever answer
   * "Бүлэг олдсонгүй". Offering the control would be offering a failure.
   */
  it("hides the group transfer from a teacher", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/children/${CHILD_ID}`, body: childWithId },
      {
        path: "/groups",
        body: { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 },
      },
    ]);

    renderWithProviders(<EditChildPage />);

    // The details form is theirs to use…
    await screen.findByLabelText(/Овог/);
    // …the transfer is not.
    expect(screen.queryByText("Бүлэг шилжүүлэх")).not.toBeInTheDocument();
  });

  it("shows the group transfer to an admin", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      { path: `/children/${CHILD_ID}`, body: childWithId },
      {
        path: "/groups",
        body: {
          items: [{ id: GROUP_ID, name: "Ахлах бүлэг" }],
          total: 1,
          page: 1,
          pageSize: 25,
          totalPages: 1,
        },
      },
    ]);

    renderWithProviders(<EditChildPage />);

    expect(await screen.findByText("Бүлэг шилжүүлэх")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Ахлах бүлэг" })).toBeInTheDocument();
  });

  it("clears the register number with null rather than an empty string", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/children/${CHILD_ID}`, body: childWithId },
      { path: `/children/${CHILD_ID}`, method: "PATCH", body: childWithId },
      {
        path: "/groups",
        body: { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 },
      },
    ]);

    renderWithProviders(<EditChildPage />);

    await user.clear(await screen.findByLabelText(/Регистрийн дугаар/));
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));

    const patch = calls.find((c) => c.method === "PATCH")!;
    // "" would fail the format rule; null is how the API is told to forget it.
    expect(patch.body).toMatchObject({ nationalId: null });
  });
});

// ── Uploading photos ────────────────────────────────────────────────────────

describe("uploading photos", () => {
  /**
   * ★ One request for the whole selection.
   *
   * This used to be one request per photograph. At 60 uploads an hour, a
   * class-board post with twenty photographs spent a third of a teacher's
   * budget and the rest of the morning was refused.
   */
  it("sends every picked file in a single request", async () => {
    const user = userEvent.setup();

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/media`,
        method: "POST",
        body: {
          items: [
            { id: "11111111-1111-4111-8111-111111111111", purpose: "CHILD_PHOTO" },
            { id: "22222222-2222-4222-8222-222222222222", purpose: "CHILD_PHOTO" },
            { id: "33333333-3333-4333-8333-333333333331", purpose: "CHILD_PHOTO" },
          ],
          failed: [],
        },
      },
    ]);

    renderWithProviders(<PhotoUpload childId={CHILD_ID} />);

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, [
      new File(["a"], "нэг.jpg", { type: "image/jpeg" }),
      new File(["b"], "хоёр.jpg", { type: "image/jpeg" }),
      new File(["c"], "гурав.jpg", { type: "image/jpeg" }),
    ]);

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));

    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect((posts[0]!.body as FormData).getAll("file")).toHaveLength(3);
  });

  /** Partial success names what was refused rather than quietly storing fewer. */
  it("names the files the server would not take", async () => {
    const user = userEvent.setup();

    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/media`,
        method: "POST",
        body: {
          items: [{ id: "11111111-1111-4111-8111-111111111111", purpose: "CHILD_PHOTO" }],
          failed: [{ name: "утас.heic", reason: "HEIC зургийг дэмжихгүй байна." }],
        },
      },
    ]);

    renderWithProviders(<PhotoUpload childId={CHILD_ID} />);

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await user.upload(input, [
      new File(["a"], "сайн.jpg", { type: "image/jpeg" }),
      new File(["b"], "утас.heic", { type: "image/heic" }),
    ]);

    expect(await screen.findByText("утас.heic")).toBeInTheDocument();
    expect(await screen.findByText(/HEIC/)).toBeInTheDocument();
  });
});

// ── Term report ─────────────────────────────────────────────────────────────

describe("the term report", () => {
  const TERM = {
    id: TERM_ID,
    number: 1,
    name: "I улирал",
    startsOn: "2026-09-01",
    endsOn: "2026-12-31",
  };

  function stubFor(role: "TEACHER" | "PARENT", report: Record<string, unknown>) {
    // Order matters: `stubApi` matches by startsWith, so the term-report stub
    // has to come before the child detail one it would otherwise be swallowed
    // by. The terms request is `/kindergartens/:id/terms`, not `/terms`.
    return stubApi([
      { path: "/auth/me", body: sessionFor([role]) },
      { path: `/children/${CHILD_ID}/term-report`, body: report },
      { path: `/children/${CHILD_ID}`, body: child },
      { path: "/kindergartens/", body: [TERM] },
    ]);
  }

  /**
   * ★ A draft is the teacher's working text.
   *
   * The API refuses a guardian anything but FINAL, so the screen must not imply
   * one is coming — and must never render the form for them.
   */
  it("shows a parent nothing while the report is still a draft", async () => {
    setParams({ childId: CHILD_ID });
    stubFor("PARENT", { exists: true, status: "DRAFT", strengths: "Ноорог" });

    renderWithProviders(<TermReportPage />);

    expect(await screen.findByText("Тайлан хараахан бэлэн болоогүй")).toBeInTheDocument();
    expect(screen.queryByLabelText("Давуу тал")).not.toBeInTheDocument();
    expect(screen.queryByText("Ноорог")).not.toBeInTheDocument();
  });

  it("shows a parent the finalised report, read-only", async () => {
    setParams({ childId: CHILD_ID });
    stubFor("PARENT", {
      exists: true,
      status: "FINAL",
      strengths: "Хамт олонтойгоо сайн",
      nextGoals: "Тоо таних",
    });

    renderWithProviders(<TermReportPage />);

    expect(await screen.findByText("Хамт олонтойгоо сайн")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ноорог хадгалах/ })).not.toBeInTheDocument();
  });

  it("gives a teacher the form while it is a draft", async () => {
    setParams({ childId: CHILD_ID });
    stubFor("TEACHER", { exists: true, status: "DRAFT", strengths: "Ноорог" });

    renderWithProviders(<TermReportPage />);

    expect(await screen.findByLabelText("Давуу тал")).toHaveValue("Ноорог");
    expect(screen.getByRole("button", { name: /Ноорог хадгалах/ })).toBeInTheDocument();
  });

  /** Finalising is one-way, so the form is gone rather than merely disabled. */
  it("stops offering a teacher the form once it is final", async () => {
    setParams({ childId: CHILD_ID });
    stubFor("TEACHER", { exists: true, status: "FINAL", strengths: "Хамт олонтойгоо сайн" });

    renderWithProviders(<TermReportPage />);

    expect(await screen.findByText(/баталгаажсан тул засах боломжгүй/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Давуу тал")).not.toBeInTheDocument();
  });
});

// ── Revoking access ─────────────────────────────────────────────────────────

describe("revoking a guardian's access", () => {
  const GUARDIANSHIP_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

  function childWithGuardian(canView: boolean) {
    return {
      ...child,
      guardianships: [
        {
          id: GUARDIANSHIP_ID,
          relation: "MOTHER",
          canView,
          isPrimary: true,
          guardian: {
            id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
            lastName: "Дорж",
            firstName: "Сараа",
            phone: "99112233",
          },
        },
      ],
    };
  }

  /**
   * ★ A revoked guardian stays on the list.
   *
   * Hiding them made a revocation look like a deletion, left staff no way back
   * when a custody situation reversed, and hid the reason a parent could no
   * longer open the child.
   */
  it("keeps a revoked guardian visible, with a way to restore them", async () => {
    setParams({ childId: CHILD_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/observations`,
        body: { items: [], total: 0, page: 1, pageSize: 5, totalPages: 0 },
      },
      { path: `/children/${CHILD_ID}/assessments`, body: [] },
      { path: `/children/${CHILD_ID}`, body: childWithGuardian(false) },
    ]);

    renderWithProviders(<ChildDetailPage />);

    expect(await screen.findByText("Хураасан")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сэргээх/ })).toBeInTheDocument();
  });

  it("sends canView false when staff revoke", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/observations`,
        body: { items: [], total: 0, page: 1, pageSize: 5, totalPages: 0 },
      },
      { path: `/children/${CHILD_ID}/assessments`, body: [] },
      { path: `/guardianships/${GUARDIANSHIP_ID}`, method: "PATCH", body: {} },
      { path: `/children/${CHILD_ID}`, body: childWithGuardian(true) },
    ]);

    renderWithProviders(<ChildDetailPage />);

    await user.click(await screen.findByRole("button", { name: /харах эрхийг хураах/ }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ canView: false });

    confirmSpy.mockRestore();
  });
});

// ── The child profile's tabs ────────────────────────────────────────────────

/**
 * The tabbed child profile.
 *
 * ★ These exist because the tab state lives in the URL rather than in `useState`,
 * and that is the whole argument for accepting tabs on a screen that used to
 * scroll. A `useState` version passes any test that clicks a tab and reads the
 * panel — and still loses the user's place on refresh, breaks the Back button
 * and cannot be linked to.
 */
describe("the child profile tabs", () => {
  const enrolled = (over: Record<string, unknown> = {}) => ({
    ...child,
    enrollments: [
      {
        id: "eeee1111-1111-4111-8111-eeeeeeeeeeee",
        group: { id: GROUP_ID, name: "Дунд бүлэг", ageBand: "JUNIOR" },
        schoolYear: { id: "ffff1111-1111-4111-8111-ffffffffffff", name: "2026-2027" },
        status: "ACTIVE",
        startedOn: "2026-08-01",
        endedOn: null,
      },
    ],
    ...over,
  });

  function stubChild(body: unknown) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/children/${CHILD_ID}/observations`, body: emptyMediaPage },
      { path: `/children/${CHILD_ID}/assessments`, body: [] },
      { path: `/children/${CHILD_ID}`, body },
    ]);
  }

  it("opens on Ерөнхий when the URL carries no tab", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    stubChild(enrolled());

    renderWithProviders(<ChildDetailPage />);

    const general = await screen.findByRole("tab", { name: "Ерөнхий" });
    expect(general).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Ажиглалт" })).toHaveAttribute("aria-selected", "false");
  });

  /** A shared link must land on what the sender was looking at. */
  it("opens the tab named in the URL", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("tab=assessments");
    stubChild(enrolled());

    renderWithProviders(<ChildDetailPage />);

    expect(await screen.findByRole("tab", { name: "Үнэлгээ" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByText("Үнэлгээ хараахан алга")).toBeInTheDocument();
  });

  /** A hand-edited or stale link opens the record rather than an empty page. */
  it("falls back to the first tab when the URL names one that does not exist", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("tab=meals");
    stubChild(enrolled());

    renderWithProviders(<ChildDetailPage />);

    expect(await screen.findByRole("tab", { name: "Ерөнхий" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("writes the chosen tab to the URL", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    stubChild(enrolled());

    renderWithProviders(<ChildDetailPage />);

    await user.click(await screen.findByRole("tab", { name: "Ажиглалт" }));

    expect(ROUTER.replace).toHaveBeenCalledWith(
      expect.stringContaining("tab=observations"),
      // `push` would make every tab press a history entry to unwind, and
      // re-anchoring to the top on each one is disorienting on a phone.
      expect.objectContaining({ scroll: false }),
    );
  });

  /**
   * The canonical URL of a child is the bare path — going back to the default
   * tab must not leave `?tab=general` behind for someone to copy and share.
   *
   * Rendered at `?tab=observations` rather than clicked into it: the test
   * harness's `useSearchParams` is a static mock, so a click cannot change what
   * the next render reads. Starting there is the honest way to exercise the
   * clearing branch.
   */
  it("clears the parameter when returning to the default tab", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });
    setSearchParams("tab=observations");
    stubChild(enrolled());

    renderWithProviders(<ChildDetailPage />);

    await user.click(await screen.findByRole("tab", { name: "Ерөнхий" }));

    const last = ROUTER.replace.mock.calls.at(-1)!;
    expect(last[0]).not.toContain("tab=");
  });

  /**
   * ★ "Current" is the ACTIVE enrollment, not the first one.
   *
   * The API orders enrollments newest-first, so for a child who has left, the
   * row at the top is the year they finished. Reading position as state labels
   * that as the group they are in now.
   */
  it("marks the ended enrollment as finished, not as current", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    stubChild(
      enrolled({
        enrollments: [
          {
            id: "eeee2222-2222-4222-8222-eeeeeeeeeeee",
            group: { id: GROUP_ID, name: "Ахлах бүлэг", ageBand: "MIDDLE" },
            schoolYear: { id: "ffff2222-2222-4222-8222-ffffffffffff", name: "2025-2026" },
            status: "ENDED",
            startedOn: "2025-08-01",
            endedOn: "2026-06-01",
          },
        ],
      }),
    );

    renderWithProviders(<ChildDetailPage />);

    const history = await screen.findByRole("region", { name: "Бүртгэлийн түүх" });
    expect(within(history).getByText("Дууссан")).toBeInTheDocument();
    expect(within(history).queryByText("Одоогийн")).not.toBeInTheDocument();
  });

  /**
   * ★ A tab's data is not fetched until the tab is opened.
   *
   * This is Radix's doing, not the page's: an inactive `Tabs.Content` is
   * unmounted, so a panel's query cannot fire early. The page relies on that
   * rather than gating each panel on `?tab=` itself, which would be a second
   * derivation of the same fact.
   *
   * Pinned here because the failure mode is silent and cheap to reintroduce:
   * `forceMount` on the panels makes four requests happen on every visit to a
   * child, and everything still renders correctly while it does.
   */
  it("does not fetch a tab's data until the tab is opened", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    const { calls } = stubChild(enrolled());

    renderWithProviders(<ChildDetailPage />);
    await screen.findByRole("region", { name: "Бүртгэлийн түүх" });

    expect(calls.some((c) => c.url.includes("/observations"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/assessments"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/media"))).toBe(false);
    // Exactly one panel is in the DOM, which is what makes the above true.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("fetches the observations once that tab is the one in the URL", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("tab=observations");
    const { calls } = stubChild(enrolled());

    renderWithProviders(<ChildDetailPage />);
    await screen.findByText("Ажиглалт бичигдээгүй байна");

    expect(calls.some((c) => c.url.includes("/observations"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/assessments"))).toBe(false);
  });

  /**
   * The hero's health badge says "there is a note to read", and it is staff
   * only — the notes section it points at is. A chip a family cannot open is
   * worse than none.
   *
   * ★ Updated 2026-08-25. This assertion used to be `queryByText(/Эрүүл мэнд/)`
   * and its comment said health was kept out of the parent-facing product
   * entirely. Both were true when written and neither is now: RFP Module 2 is
   * in scope, and a guardian gets an **Эрүүл мэнд** tab — it is where they
   * authorise medication, which Module 2 has the family doing in as many words.
   *
   * So the loose regex started matching the new tab, and the honest fix is to
   * assert on what the badge actually renders rather than on any occurrence of
   * the phrase. The rule under test never changed: the staff note, and the chip
   * pointing at it, stay staff-only.
   */
  it("never shows the staff health-note badge to a guardian", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/children/${CHILD_ID}/observations`, body: emptyMediaPage },
      { path: `/children/${CHILD_ID}/assessments`, body: [] },
      { path: `/children/${CHILD_ID}`, body: enrolled({ healthNotes: "Харшилтай" }) },
    ]);

    renderWithProviders(<ChildDetailPage />);

    expect(await screen.findByRole("tab", { name: "Ерөнхий" })).toBeInTheDocument();

    // The badge, and the note it points at — neither reaches a family.
    expect(screen.queryByText("Эрүүл мэндийн тэмдэглэлтэй")).not.toBeInTheDocument();
    expect(screen.queryByText("Харшилтай")).not.toBeInTheDocument();

    // …while the tab, which is theirs, is present. Asserted rather than left
    // implicit, so a future tightening of the badge rule cannot quietly take
    // the medication form away from the people RFP Module 2 gives it to.
    expect(screen.getByRole("tab", { name: "Эрүүл мэнд" })).toBeInTheDocument();
  });
});

// ── Archiving ───────────────────────────────────────────────────────────────

describe("archiving", () => {
  const NOTICE_ID = "cccccccc-1111-4111-8111-cccccccccccc";

  const notice = {
    id: NOTICE_ID,
    title: "Аяллын мэдээлэл",
    body: "Маргааш 9 цагт",
    status: "PUBLISHED",
    isImportant: false,
    publishedAt: "2026-08-20T09:00:00.000Z",
    createdAt: "2026-08-20T09:00:00.000Z",
    author: { id: "dddddddd-1111-4111-8111-dddddddddddd", lastName: "Дорж", firstName: "Багш" },
    targets: [],
    reads: [{ id: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee" }],
    media: [],
    likeCount: 0,
    likedByMe: false,
  };

  /**
   * ★ Staff only, matching `@Roles("TEACHER", "ADMIN")` on the endpoint.
   *
   * A parent offered this would get a 404 from a button that looked live.
   */
  it("does not offer a parent the archive control", async () => {
    setParams({ notificationId: NOTICE_ID });
    stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/notifications/${NOTICE_ID}`, body: notice },
    ]);

    renderWithProviders(<NotificationDetailPage />);

    await screen.findByText("Аяллын мэдээлэл");
    expect(screen.queryByRole("button", { name: /Архивлах/ })).not.toBeInTheDocument();
  });

  it("archives with DELETE and returns to the list", async () => {
    const user = userEvent.setup();
    setParams({ notificationId: NOTICE_ID });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/notifications/${NOTICE_ID}`, method: "DELETE", body: {} },
      { path: `/notifications/${NOTICE_ID}`, body: notice },
    ]);

    renderWithProviders(<NotificationDetailPage />);

    await user.click(await screen.findByRole("button", { name: /Архивлах/ }));

    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/notifications"));

    confirmSpy.mockRestore();
  });

  /** Nothing happens if the confirmation is declined — it is a soft delete, not a free one. */
  it("does nothing when the confirmation is declined", async () => {
    const user = userEvent.setup();
    setParams({ notificationId: NOTICE_ID });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/notifications/${NOTICE_ID}`, body: notice },
    ]);

    renderWithProviders(<NotificationDetailPage />);

    await user.click(await screen.findByRole("button", { name: /Архивлах/ }));

    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    confirmSpy.mockRestore();
  });
});

/**
 * The gallery and the observation photo strip, after `GET /children/:id/media`
 * became paginated.
 *
 * ★ Both of these assert against the *request*, not just the render. The
 * regression these guard against is silent: a component that quietly shows the
 * first page of a larger set looks exactly like one showing everything, and a
 * component that filters in the browser looks exactly like one that asks the
 * server to filter — right up to the day the second page exists.
 */
describe("paginated media", () => {
  const PHOTO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const OBSERVATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

  const photo = {
    id: PHOTO_ID,
    caption: "Зурсан зураг",
    originalName: "art.jpg",
    mimeType: "image/jpeg",
    purpose: "CHILD_PHOTO",
  };

  /**
   * Truncation is stated, never silent.
   *
   * There is no pager yet, so the gallery asks for one large page. If a child
   * has more photographs than that, the screen has to say so — showing 100 of
   * 140 with nothing to indicate it is a worse failure than the unbounded list
   * this replaced, because nobody can see it happening.
   */
  it("says so when there are more photos than one page", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/media`,
        body: { items: [photo], page: 1, pageSize: 100, total: 140, totalPages: 2 },
      },
    ]);

    renderWithProviders(<ChildGallery childId={CHILD_ID} canEdit={false} />);

    expect(await screen.findByText(/Нийт 140/)).toBeInTheDocument();
  });

  /** One page that holds everything says nothing. */
  it("stays quiet when one page holds them all", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/media`,
        body: { items: [photo], page: 1, pageSize: 100, total: 1, totalPages: 1 },
      },
    ]);

    renderWithProviders(<ChildGallery childId={CHILD_ID} canEdit={false} />);

    await screen.findByRole("button", { name: /томоор харах/ });
    expect(screen.queryByText(/Нийт/)).not.toBeInTheDocument();
  });

  /**
   * ★ The filter is the server's.
   *
   * This component used to fetch the child's whole OBSERVATION set and match
   * `observationId` in the browser. With pagination that returns the wrong
   * photos — or none — so the id has to reach the query string.
   */
  it("asks the API for one observation's photos", async () => {
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/media`,
        body: {
          items: [{ ...photo, purpose: "OBSERVATION", observationId: OBSERVATION_ID }],
          page: 1,
          pageSize: 12,
          total: 1,
          totalPages: 1,
        },
      },
    ]);

    renderWithProviders(<ObservationPhotos childId={CHILD_ID} observationId={OBSERVATION_ID} />);

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes(`observationId=${OBSERVATION_ID}`))).toBe(true),
    );
  });
});

/**
 * The teacher dashboard's §12.1 tiles.
 *
 * ★ Both of these are new fields on `GET /dashboard/teacher`, and both are the
 * kind of thing that renders plausibly while being wrong: a birthday list that
 * quietly shows nobody, a progress bar that divides by zero and prints "NaN%".
 */
describe("teacher dashboard", () => {
  const BIRTHDAY_CHILD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

  function dashboardBody(over: Record<string, unknown> = {}) {
    return {
      currentTerm: { id: TERM_ID, number: 1, name: "I улирал" },
      counts: { children: 10, groups: 1, pendingReviews: 0 },
      needsAttention: { pendingReviews: 0, childrenMissingAssessment: [] },
      birthdaysToday: [],
      termProgress: { assessed: 0, total: 10 },
      recentObservations: [],
      ...over,
    };
  }

  it("names the children whose birthday is today", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/dashboard/teacher",
        body: dashboardBody({
          birthdaysToday: [
            { id: BIRTHDAY_CHILD, lastName: "Ганболд", firstName: "Сарнай", dateOfBirth: null },
          ],
        }),
      },
      { path: "/groups", body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    ]);

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/Өнөөдөр төрсөн өдөртэй/)).toBeInTheDocument();
    expect(screen.getByText(/Сарнай/)).toBeInTheDocument();
  });

  it("shows the term progress as a labelled progressbar", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/dashboard/teacher",
        body: dashboardBody({ termProgress: { assessed: 4, total: 10 } }),
      },
      { path: "/groups", body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    ]);

    renderWithProviders(<DashboardPage />);

    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  /**
   * ★ A group with no children is a real state on the first day of a school
   * year. `4/0` is not — and `Math.round(0/0)` renders the string "NaN%".
   */
  it("does not print NaN when the roster is empty", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/dashboard/teacher",
        body: dashboardBody({
          counts: { children: 0, groups: 1, pendingReviews: 0 },
          termProgress: { assessed: 0, total: 0 },
        }),
      },
      { path: "/groups", body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    ]);

    renderWithProviders(<DashboardPage />);

    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  /**
   * ★ The alerts section is absent, not empty, on a quiet day.
   *
   * Its whole value is that seeing it means something. A version that always
   * rendered — three headings over three "байхгүй" lines — would teach a teacher
   * to skip past the one part of the screen that is asking for something, and
   * that failure is invisible in a screenshot of a busy day.
   */
  it("hides the alerts entirely when nothing needs attention", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/dashboard/teacher", body: dashboardBody() },
      { path: "/groups", body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    ]);

    renderWithProviders(<DashboardPage />);

    // Wait for the render to settle on content before asserting an absence —
    // otherwise this passes against the loading state.
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Анхаарах зүйлс" })).not.toBeInTheDocument();
  });

  it("names every child still missing an assessment, and links to them", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/dashboard/teacher",
        body: dashboardBody({
          needsAttention: {
            pendingReviews: 0,
            childrenMissingAssessment: [
              {
                id: BIRTHDAY_CHILD,
                lastName: "Ганболд",
                firstName: "Сарнай",
                photoMediaFileId: null,
                group: { id: GROUP_ID, name: "Дунд бүлэг" },
              },
            ],
          },
        }),
      },
      { path: "/groups", body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    ]);

    renderWithProviders(<DashboardPage />);

    const alerts = await screen.findByRole("region", { name: "Анхаарах зүйлс" });
    expect(within(alerts).getByText(/Сарнай/)).toBeInTheDocument();
    expect(within(alerts).getByText("Дунд бүлэг")).toBeInTheDocument();
    expect(within(alerts).getByRole("link", { name: /Сарнай/ })).toHaveAttribute(
      "href",
      `/children/${BIRTHDAY_CHILD}`,
    );
  });

  /**
   * A new kindergarten has no observations for its first week. That is a quiet
   * day, not a broken screen, and it has to say so — an empty section that
   * simply vanishes reads as a feature that failed to load.
   */
  it("offers the way to write the first observation when the feed is empty", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/dashboard/teacher", body: dashboardBody({ recentObservations: [] }) },
      { path: "/groups", body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    ]);

    renderWithProviders(<DashboardPage />);

    const feed = await screen.findByRole("region", { name: "Сүүлийн ажиглалтууд" });
    expect(within(feed).getByText("Ажиглалт хараахан бичигдээгүй")).toBeInTheDocument();
    expect(within(feed).getByRole("link", { name: "Хүүхдүүд" })).toBeInTheDocument();
  });

  /**
   * ★ The tile row lost its term-progress and review tiles, and the rule one of
   * them carried had to survive the removal.
   *
   * Both were already on the screen: "Улирлын явц" repeated the `TermProgress`
   * section's own numbers a few hundred pixels above it, and "Хянах" repeated a
   * count that the alert card below states *and acts on*.
   *
   * The review tile was pinned here for a reason worth keeping, though. The two
   * `pendingReviews` fields are given **different** values in this fixture:
   * `dashboard.service.ts` computes one number and writes it to both
   * `counts.pendingReviews` and `needsAttention.pendingReviews`, so a fixture
   * that sets them equal — as every other one in this file does — cannot tell
   * which field the screen reads. "Waiting for you" is the `needsAttention` one,
   * and the day the queue is narrowed to a teacher's own groups this is what
   * catches the alert card reading the other. The assertion moved from the tile
   * to the card; the guarantee did not move at all.
   */
  it("counts the roster and the groups, and leaves the rest to the sections", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: "/dashboard/teacher",
        body: dashboardBody({
          counts: { children: 10, groups: 2, pendingReviews: 9 },
          needsAttention: { pendingReviews: 3, childrenMissingAssessment: [] },
          termProgress: { assessed: 7, total: 10 },
        }),
      },
      { path: "/groups", body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } },
    ]);

    renderWithProviders(<DashboardPage />);

    const tiles = await screen.findByRole("region", { name: "Өнөөдрийн тойм" });
    expect(within(tiles).getByText("Хүүхэд")).toBeInTheDocument();
    expect(within(tiles).getByText("Бүлэг")).toBeInTheDocument();

    // The two that were saying what the sections below already said.
    expect(within(tiles).queryByText("70%")).not.toBeInTheDocument();
    expect(within(tiles).queryByText("Хянах")).not.toBeInTheDocument();

    // The term's share is stated once, by the element that is a `progressbar`.
    const progress = await screen.findByRole("region", { name: "Улирлын үнэлгээний явц" });
    expect(within(progress).getByText("70%")).toBeInTheDocument();
    expect(within(progress).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "70");

    // …and the review queue is stated once, by the card that can act on it.
    const alerts = await screen.findByRole("region", { name: "Анхаарах зүйлс" });
    expect(within(alerts).getByText(/3 бичлэг/)).toBeInTheDocument();
    expect(within(alerts).queryByText(/9 бичлэг/)).not.toBeInTheDocument();
    expect(within(alerts).getByRole("link", { name: "Хянах" })).toBeInTheDocument();
  });
});
