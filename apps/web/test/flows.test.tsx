import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  ROUTER,
  selectOption,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import LoginPage from "@/app/login/page";
import NewObservationPage from "@/app/(app)/children/[childId]/observations/new/page";
import GroupAssessmentPage from "@/app/(app)/groups/[groupId]/assessment/page";
import NotificationsPage from "@/app/(app)/notifications/page";
import ChildGeneralPage from "@/app/(app)/children/[childId]/general/page";
import NewChildPage from "@/app/(app)/children/new/page";
import EditChildPage from "@/app/(app)/children/[childId]/edit/page";
import { PhotoUpload } from "@/components/media/photo-upload";
import { ChildGallery } from "@/components/media/child-gallery";
import { ObservationPhotos } from "@/components/observations/observation-photos";
import DashboardPage from "@/app/(app)/dashboard/page";
import { NeedsAttentionAlerts } from "@/components/dashboard/needs-attention-alerts";
import { RecentObservations } from "@/components/dashboard/recent-observations";
import { TermProgress } from "@/components/dashboard/term-progress";
import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import TermReportPage from "@/app/(app)/children/[childId]/term-report/page";
import NotificationDetailPage from "@/app/(app)/notifications/[notificationId]/page";

const CHILD_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const TERM_ID = "66666666-6666-4666-8666-666666666666";
const DOMAIN_ID = "77777777-7777-4777-8777-777777777777";
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

    /*
      ★ No type select to answer — 2026-09-11, "Ажиглалтын төрөл энийг хас".

      The form resolves the kind instead: `?typeId=` when a link named one, and
      otherwise the `daily` type, or the kindergarten's first. This test arrives
      with no parameter and one configured type, so the assertion below on
      `typeId` is what proves the resolution actually ran — without it the POST
      would be missing a required field and the API would 400.
    */
    await user.type(await screen.findByLabelText("Тэмдэглэл"), "Тоглоомын талбайд");
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

    await screen.findByLabelText("Тэмдэглэл");

    // The teacher's controls are simply not rendered.
    expect(screen.queryByLabelText(/Эцэг эх харах боломжтой/)).toBeNull();
    expect(screen.queryByLabelText("СҮД код")).toBeNull();

    await user.type(screen.getByLabelText("Тэмдэглэл"), "Гэртээ ном уншлаа");
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

/**
 * ★ The register is gone from this screen; what is left is the documentation
 * overview — see the note on `tab` in the page itself.
 *
 * The fixture the column tests used went with them. What stays here is the one
 * thing the change is about: that the screen no longer offers a way into a
 * per-domain grid.
 */
describe("group assessment", () => {
  const SCHOOL_YEAR_ID = "77777777-7777-4777-8777-777777777777";

  it("removes the assessment tab and keeps note entry in the monthly goal", async () => {
    setParams({ groupId: GROUP_ID });
    setSearchParams(`termId=${TERM_ID}&domainId=${DOMAIN_ID}`);
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      {
        path: `/children/${CHILD_ID}/observations/types`,
        body: [
          { id: TYPE_ID, name: "Ажиглалт", code: "daily" },
          { id: "22222222-2222-4222-8222-222222222222", name: "Ярилцлага", code: "conversation" },
          { id: "55555555-5555-4555-8555-555555555555", name: "Бүтээл", code: "artwork" },
        ],
      },
      {
        path: "/children",
        body: {
          items: [
            {
              id: CHILD_ID,
              lastName: "Ганболд",
              firstName: "Батбаяр",
              sex: "MALE",
              dateOfBirth: "2021-04-12",
            },
          ],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        },
      },
      {
        path: `/groups/${GROUP_ID}/observation-stats`,
        body: {
          total: 1,
          enrolled: 1,
          childrenWithNotes: 1,
          byType: [{ id: TYPE_ID, name: "Ажиглалт", count: 1 }],
          byDomain: [],
          byActivity: [],
          byMonth: [{ month: "2025-09", count: 1, childrenCount: 1 }],
        },
      },
      {
        path: `/groups/${GROUP_ID}`,
        body: {
          id: GROUP_ID,
          name: "Дунд бүлэг",
          kindergartenId: "33333333-3333-4333-8333-333333333333",
          schoolYearId: SCHOOL_YEAR_ID,
          monthlyNoteGoal: 1,
          monthlyNotesPerChildGoal: 1,
        },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/assessment-config",
        body: { domains: [], levels: [] },
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/terms",
        body: [],
      },
      {
        path: "/kindergartens/33333333-3333-4333-8333-333333333333/school-years",
        body: [],
      },
      { path: "/groups?", body: { items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 } },
    ]);

    renderWithProviders(<GroupAssessmentPage />);

    const goal = (await screen.findByText("Энэ сарын зорилт")).closest(
      '[data-ui="card"]',
    ) as HTMLElement;
    expect(screen.queryByRole("tab", { name: "Үнэлэх" })).not.toBeInTheDocument();
    expect(within(goal).queryByLabelText("Хүүхэд сонгох")).not.toBeInTheDocument();
    expect(await within(goal).findByRole("button", { name: "Ажиглалт" })).toBeInTheDocument();
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

    renderWithProviders(<ChildGeneralPage />);

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
    await selectOption(user, /Хүйс/, "Хүү");
    await user.type(screen.getByLabelText(/Төрсөн огноо/), "2022-03-15");
    // The select is disabled while the group list loads, so waiting for it to
    // become enabled is what makes this deterministic rather than lucky.
    await waitFor(() => expect(screen.getByLabelText(/Бүлэг/)).not.toBeDisabled());
    await selectOption(user, /Бүлэг/, "Дунд бүлэг");

    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith(`/children/${CHILD_ID}/general`));

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
    await selectOption(user, /Хүйс/, "Охин");
    await user.type(screen.getByLabelText(/Төрсөн огноо/), "2022-03-15");

    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

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
    const user = userEvent.setup();
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
    // Radix only mounts `role="option"` once its listbox opens, unlike a
    // native `<select>`'s always-present `<option>`s.
    await user.click(screen.getByLabelText("Шинэ бүлэг"));
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
      { path: `/children/${CHILD_ID}`, body: childWithGuardian(false) },
    ]);

    renderWithProviders(<ChildGeneralPage />);

    expect(await screen.findByText("Хураасан")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сэргээх/ })).toBeInTheDocument();
  });

  it("sends canView false when staff revoke", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/guardianships/${GUARDIANSHIP_ID}`, method: "PATCH", body: {} },
      { path: `/children/${CHILD_ID}`, body: childWithGuardian(true) },
    ]);

    renderWithProviders(<ChildGeneralPage />);

    // ★ Was `vi.spyOn(window, "confirm")`. The native prompt is gone; this now
    // opens the shared `ConfirmDialog` and presses its confirm, which is the
    // path a person takes.
    await user.click(await screen.findByRole("button", { name: /харах эрхийг хураах/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Эрхийг хураах" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ canView: false });
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

  const emptyGrowth = { points: [] };

  function stubChild(body: unknown) {
    return stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/children/${CHILD_ID}/growth`, body: emptyGrowth },
      { path: `/children/${CHILD_ID}`, body },
    ]);
  }

  /**
   * ★ The child record sections are direct tabs, and the "Бусад" pane that
   * used to hold four of them is gone because it never worked.
   *
   * Radix picks which `Tabs.Content` renders from the value on `Tabs.Root`, and
   * `ChildTabs` set that value to `"more"` whenever a secondary section was
   * active — so `?tab=growth` re-rendered the tile grid instead of Өсөлт, and
   * pressing the Өсөлт tile handed back the Өсөлт tile. Four sections were
   * unreachable for as long as the pane existed. See `child-tabs.tsx`.
   */
  it("opens on Ерөнхий when the URL carries no tab", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    stubChild(enrolled());

    renderWithProviders(<ChildGeneralPage />);

    const general = await screen.findByRole("tab", { name: "Ерөнхий" });
    expect(general).toHaveAttribute("aria-selected", "true");
    // The remaining profile sections are directly available in the strip.
    for (const label of ["Өсөлт", "Эрүүл мэнд", "Суралцсан түүх"]) {
      expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "false");
    }
    expect(screen.queryByRole("tab", { name: "Аюулгүй байдал" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Бусад" })).toBeNull();
  });

  it("shows the base group category in the registration history", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    stubChild(
      enrolled({
        enrollments: [
          {
            id: "eeee1111-1111-4111-8111-eeeeeeeeeeee",
            group: { id: GROUP_ID, name: "Дэлбээ бүлэг", ageBand: "NURSERY" },
            schoolYear: { id: "ffff1111-1111-4111-8111-ffffffffffff", name: "2026-2027" },
            status: "ACTIVE",
            startedOn: "2026-08-01",
            endedOn: null,
          },
        ],
      }),
    );

    renderWithProviders(<ChildGeneralPage />);

    const history = await screen.findByRole("region", { name: "Бүртгэлийн түүх" });
    const groupName = within(history).getByText("Дэлбээ бүлэг");
    expect(groupName.parentElement).toHaveTextContent(/Дэлбээ бүлэг\s*·\s*Бага бүлэг/);
    expect(within(history).getByText(/2026–2027 · Элссэн:\s*2026\.08\.01/)).toBeInTheDocument();
  });

  it("shows the current registration and guardian contact in the general-information cards", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    const guardianId = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
    const guardianshipId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const kindergarten = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Бяцхан Нүүдэлчид цэцэрлэг",
    };
    const body = enrolled({
      kindergarten,
      nationalId: "УШ21241200",
      enrollments: [
        {
          id: "eeee1111-1111-4111-8111-eeeeeeeeeeee",
          group: { id: GROUP_ID, name: "Дэлбээ бүлэг", ageBand: "JUNIOR" },
          schoolYear: { id: "ffff1111-1111-4111-8111-ffffffffffff", name: "2026-2027" },
          status: "ACTIVE",
          startedOn: "2026-08-01",
          endedOn: null,
        },
      ],
      guardianships: [
        {
          id: guardianshipId,
          relation: "FATHER",
          canView: true,
          isPrimary: true,
          guardian: {
            id: guardianId,
            lastName: "Ганболд",
            firstName: "Энхтүвшин",
            phone: "99123456",
            email: null,
          },
        },
      ],
    });

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"], guardianId) },
      { path: "/me/profile", method: "PATCH", body: {} },
      { path: `/guardianships/${guardianshipId}`, method: "PATCH", body: {} },
      {
        path: `/children/${CHILD_ID}/enrollment-archive`,
        body: {
          child: { id: CHILD_ID, lastName: "Ганболд", firstName: "Батбаяр" },
          current: {
            id: "eeee1111-1111-4111-8111-eeeeeeeeeeee",
            startedOn: "2026-08-01",
            schoolYear: {
              id: "ffff1111-1111-4111-8111-ffffffffffff",
              name: "2026-2027",
            },
            kindergarten: {
              ...kindergarten,
              address: null,
              phone: null,
              email: null,
              description: null,
            },
            group: { id: GROUP_ID, name: "Дэлбээ бүлэг", schedule: null, rules: null },
            teachers: [
              {
                id: "cccccccc-1111-4111-8111-cccccccccccc",
                lastName: "Бат",
                firstName: "Оюунчимэг",
                role: "LEAD",
              },
            ],
          },
          history: [],
        },
      },
      { path: `/children/${CHILD_ID}`, body },
    ]);

    renderWithProviders(<ChildGeneralPage />);

    const general = await screen.findByRole("region", { name: "Ерөнхий мэдээлэл" });
    expect(
      within(general).getByRole("heading", { name: "Хүүхдийн үндсэн мэдээлэл" }),
    ).toBeInTheDocument();
    expect(within(general).getByText("Ганболд Батбаяр")).toBeInTheDocument();
    expect(within(general).getByText("5 нас · 2021.04.12")).toBeInTheDocument();
    expect(within(general).getByText("УШ21241200")).toBeInTheDocument();
    expect(within(general).getByText("Хүү")).toBeInTheDocument();
    expect(within(general).getByText("Б. Оюунчимэг")).toBeInTheDocument();
    expect(within(general).getByText("Суралцаж байгаа")).toBeInTheDocument();
    expect(screen.getByText("9912 3456")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Холбоо барих" })).toHaveAttribute(
      "href",
      "tel:99123456",
    );
    expect(screen.queryByRole("button", { name: "Урих" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /харах эрхийг хураах/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Засах" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Асран хамгаалагчийн мэдээлэл засах",
    });
    const nameInput = within(dialog).getByLabelText(/Асран хамгаалагчийн нэр/);
    const phoneInput = within(dialog).getByLabelText(/Холбоо барих утас/);

    expect(nameInput).toHaveValue("Ганболд Энхтүвшин");
    expect(phoneInput).toHaveValue("99123456");

    await user.clear(nameInput);
    await user.type(nameInput, "Б.Энхцэцэг");
    await selectOption(user, /Хүүхэдтэй холбоо/, "Ээж");
    await user.clear(phoneInput);
    await user.type(phoneInput, "88112233");
    await user.click(within(dialog).getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(
        calls.find((call) => call.url === "/me/profile" && call.method === "PATCH")?.body,
      ).toEqual({ lastName: "Б.", firstName: "Энхцэцэг", phone: "88112233" }),
    );
    expect(
      calls.find(
        (call) => call.url === `/guardianships/${guardianshipId}` && call.method === "PATCH",
      )?.body,
    ).toEqual({ relation: "MOTHER" });
    expect(
      await screen.findByText("Асран хамгаалагчийн мэдээлэл хадгалагдлаа."),
    ).toBeInTheDocument();
  });

  it("routes kindergarten registration edits through the admin child form", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/children/${CHILD_ID}/enrollment-archive`,
        body: {
          child: { id: CHILD_ID, lastName: "Ганболд", firstName: "Батбаяр" },
          current: null,
          history: [],
        },
      },
      { path: `/children/${CHILD_ID}`, body: child },
    ]);

    renderWithProviders(<ChildGeneralPage />);

    const general = await screen.findByRole("region", { name: "Ерөнхий мэдээлэл" });
    expect(within(general).getByRole("link", { name: "Засах" })).toHaveAttribute(
      "href",
      `/children/${CHILD_ID}/edit`,
    );
  });

  /**
   * ★ The regression test for the bug above: a link naming a section opens
   * *that section*, not a menu pointing back at it.
   */
  it("opens the section a link names", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("tab=growth");
    stubChild(enrolled());

    renderWithProviders(<ChildGeneralPage />);

    expect(await screen.findByRole("tab", { name: "Өсөлт" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Ерөнхий" })).toHaveAttribute("aria-selected", "false");
  });

  /** A hand-edited or stale link opens the record rather than an empty page. */
  it("falls back to the first tab when the URL names one that does not exist", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("tab=meals");
    stubChild(enrolled());

    renderWithProviders(<ChildGeneralPage />);

    expect(await screen.findByRole("tab", { name: "Ерөнхий" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("writes the opened tab to the URL", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    stubChild(enrolled());

    renderWithProviders(<ChildGeneralPage />);

    await user.click(await screen.findByRole("tab", { name: "Өсөлт" }));

    expect(ROUTER.replace).toHaveBeenCalledWith(
      expect.stringContaining("tab=growth"),
      // `push` would make every tab press a history entry to unwind, and
      // re-anchoring to the top on each one is disorienting on a phone.
      expect.objectContaining({ scroll: false }),
    );
  });

  /**
   * The canonical URL of a child is the bare path — going back to the default
   * tab must not leave `?tab=general` behind for someone to copy and share.
   *
   * Rendered at `?tab=growth` rather than clicked into it: the test harness's
   * `useSearchParams` is a static mock, so a click cannot change what the next
   * render reads. Starting there is the honest way to exercise the clearing
   * branch.
   */
  it("clears the parameter when returning to the default tab", async () => {
    const user = userEvent.setup();
    setParams({ childId: CHILD_ID });
    setSearchParams("tab=growth");
    stubChild(enrolled());

    renderWithProviders(<ChildGeneralPage />);

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

    renderWithProviders(<ChildGeneralPage />);

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
   * `forceMount` on the panels makes every secondary panel's request happen on
   * every visit to a child, and everything still renders correctly while it
   * does.
   */
  it("does not fetch a tab's data until the tab is opened", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("");
    const { calls } = stubChild(enrolled());

    renderWithProviders(<ChildGeneralPage />);
    await screen.findByRole("region", { name: "Бүртгэлийн түүх" });

    expect(calls.some((c) => c.url.includes("/growth"))).toBe(false);
    // Exactly one panel is in the DOM, which is what makes the above true.
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  /**
   * ★ This asserted the opposite until 2026-08-29, and passing was the symptom.
   *
   * It read "does not fetch a secondary tab's data merely because the URL names
   * it" and was green — because landing on `?tab=growth` rendered the overflow
   * tile grid rather than `ChildGrowth`, so the growth query never fired. The
   * test was describing the bug as though it were a policy. A link to a
   * section must open the section, which means fetching what the section
   * shows.
   */
  it("fetches a tab's data when the URL names it", async () => {
    setParams({ childId: CHILD_ID });
    setSearchParams("tab=growth");
    const { calls } = stubChild(enrolled());

    renderWithProviders(<ChildGeneralPage />);
    await screen.findByRole("tab", { name: "Өсөлт" });

    await waitFor(() => expect(calls.some((c) => c.url.includes("/growth"))).toBe(true));
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
      { path: `/children/${CHILD_ID}`, body: enrolled({ healthNotes: "Харшилтай" }) },
    ]);

    renderWithProviders(<ChildGeneralPage />);

    expect(await screen.findByRole("tab", { name: "Ерөнхий" })).toBeInTheDocument();

    // The badge, and the note it points at — neither reaches a family.
    expect(screen.queryByText("Эрүүл мэндийн тэмдэглэлтэй")).not.toBeInTheDocument();
    expect(screen.queryByText("Харшилтай")).not.toBeInTheDocument();

    /*
     * …while the section, which is theirs, is still reachable. Asserted rather
     * than left implicit, so a future tightening of the badge rule cannot
     * quietly take the medication form away from the people RFP Module 2 gives
     * it to.
     *
     * ★ It spent 2026-08-25 to 08-29 behind a "Бусад" pane that could not
     * actually open it (see the tab tests above), so this assertion checked the
     * pane rather than the section. It is a tab of its own again.
     */
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

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/notifications/${NOTICE_ID}`, method: "DELETE", body: {} },
      { path: `/notifications/${NOTICE_ID}`, body: notice },
    ]);

    renderWithProviders(<NotificationDetailPage />);

    // ★ Was `vi.spyOn(window, "confirm")`. `ArchiveButton` now opens the shared
    // `ConfirmDialog`, so the trigger and the confirm are two separate presses.
    await user.click(await screen.findByRole("button", { name: /Архивлах/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Архивлах/ }));

    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(ROUTER.push).toHaveBeenCalledWith("/notifications"));

    // "Toast after save": the row is gone and often the page with it, so the
    // confirmation has nowhere to live except the toast.
    expect(await screen.findByText(/архивлагдлаа/i)).toBeInTheDocument();
  });

  /** Nothing happens if the confirmation is declined — it is a soft delete, not a free one. */
  it("does nothing when the confirmation is declined", async () => {
    const user = userEvent.setup();
    setParams({ notificationId: NOTICE_ID });

    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: `/notifications/${NOTICE_ID}`, body: notice },
    ]);

    renderWithProviders(<NotificationDetailPage />);

    /*
      ★ This now cancels the dialog explicitly.

      With `window.confirm` mocked to `false` the old version asserted a real
      decline. Against the new dialog the same code would pass without ever
      declining anything — opening the dialog sends no request either — so the
      assertion has to press "Болих" for the test to still mean what it says.
    */
    await user.click(await screen.findByRole("button", { name: /Архивлах/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
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
/**
 * The teacher's dashboard.
 *
 * The 2026-09-06 mockup restores a greeting, header search and four illustrated
 * quick actions, while keeping the real data widgets that already have API
 * support. Older widgets that are no longer mounted here remain covered by
 * direct component tests above.
 */
describe("teacher dashboard", () => {
  const BIRTHDAY_CHILD = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

  function dashboardBody(over: Record<string, unknown> = {}) {
    return {
      currentTerm: { id: TERM_ID, number: 1, name: "I улирал" },
      counts: { children: 10, groups: 1, pendingReviews: 0 },
      needsAttention: { pendingReviews: 0, childrenMissingAssessment: [] },
      birthdaysToday: [],
      birthdaysThisMonth: [],
      termProgress: { assessed: 0, total: 10 },
      recentObservations: [],
      boardNotice: null,
      ...over,
    };
  }

  function stubDashboard(over: Record<string, unknown> = {}) {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/dashboard/teacher", body: dashboardBody(over) },
      { path: "/chat/rooms", body: [] },
      { path: "/groups", body: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } },
      { path: "/children/summary", body: { total: 10, averageAgeMonths: 48, boys: 5, girls: 5 } },
    ]);
  }

  // ═══ The page the client asked for ═══

  it("renders the teacher mockup dashboard sections", async () => {
    stubDashboard();

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Х.Тест" })).toBeInTheDocument();
    expect(screen.queryByText(/Сайн байна уу/)).not.toBeInTheDocument();
    expect(screen.getByAltText("Багш хоёр хүүхдэд ном уншиж байна").getAttribute("src")).toContain(
      "teacher-reading-with-children.png",
    );

    for (const action of ["Ирц", "Мэдээ", "Судалгаа", "Явцын үнэлгээ"]) {
      expect(
        await screen.findByRole("link", { name: new RegExp(`^${action}`) }),
      ).toBeInTheDocument();
    }

    for (const [action, asset] of [
      ["Ирц", "icon-attendance-3d"],
      ["Мэдээ", "icon-notice-3d"],
      ["Судалгаа", "icon-survey-3d"],
      ["Явцын үнэлгээ", "icon-progress-3d"],
    ] as const) {
      const link = await screen.findByRole("link", { name: new RegExp(`^${action}`) });
      const icon = link.querySelector("img");
      expect(icon, `${action} must use the supplied transparent icon`).not.toBeNull();
      expect(icon!.getAttribute("src")).toContain(asset);
      expect(icon).toHaveAttribute("alt", "");
    }

    for (const card of [
      "Өнөөдрийн ирц",
      // ★ Was "Сарын ирц" until 2026-09-09. The card charts Monday to Friday
      // of the current week, so the mock-up's "month" label was describing
      // data the card does not hold — `weekly-attendance.tsx` renamed it to
      // what it actually shows. The assertion is that the card is on the
      // dashboard at all, which is unchanged.
      "Долоо хоногийн ирц",
      "Төрсөн өдөр",
      "Явцын үнэлгээ",
      "Сүүлийн нийтлэл",
      "Сургуулийн чат",
    ]) {
      expect(
        await screen.findByRole("heading", { name: card }),
        `${card} is missing`,
      ).toBeInTheDocument();
    }
  });

  /**
   * ★ The nine removals, asserted as removals.
   *
   * Without this the next person restoring one of them — the launcher grid is
   * the likely candidate, since it was itself added on request — would not know
   * it had been taken off deliberately rather than lost in a merge.
   */
  it("does not carry the widgets the client removed", async () => {
    stubDashboard({
      needsAttention: {
        pendingReviews: 4,
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
    });

    renderWithProviders(<DashboardPage />);

    await screen.findByRole("heading", { name: "Өнөөдрийн ирц" });

    for (const region of [
      "Анхаарах зүйлс",
      "Түргэн холбоос",
      "Өнөөдрийн тойм",
      "Сүүлийн ажиглалтууд",
      "Бүлгийн бүртгэлүүд",
    ]) {
      expect(screen.queryByRole("region", { name: region }), `${region} is back`).toBeNull();
    }
    // The "+ Үйлдэл" menu went with the old dashboard. Search now belongs to
    // the teacher shell's desktop header rather than this page component.
    expect(screen.queryByRole("button", { name: /Үйлдэл/ })).toBeNull();

    /*
      ★ Хоолны цэс is the one that came back, on 2026-08-29.

      It left with the other eight and, unlike them, had nowhere else to go:
      `TodayMenu` is the only surface in the product for the allergy
      cross-check, which CLAUDE.md §7 lists as delivered. It sits *below* the
      five cards the client drew rather than among them, so their layout is
      untouched — this asserts it is on the page at all, which is the part that
      was broken.
    */
    expect(screen.getByRole("region", { name: "Хоолны цэс" })).toBeInTheDocument();
  });

  // ═══ Guarantees that outlived the widgets carrying them ═══

  it("names the children whose birthday is today", () => {
    renderWithProviders(
      <NeedsAttentionAlerts
        birthdaysToday={[
          { id: BIRTHDAY_CHILD, lastName: "Ганболд", firstName: "Сарнай", dateOfBirth: null },
        ]}
        needsAttention={{ pendingReviews: 0, childrenMissingAssessment: [] }}
      />,
    );

    expect(screen.getByText(/Өнөөдөр төрсөн өдөртэй/)).toBeInTheDocument();
    expect(screen.getByText(/Сарнай/)).toBeInTheDocument();
  });

  it("shows the term progress as a labelled progressbar", () => {
    renderWithProviders(<TermProgress term="I улирал" progress={{ assessed: 4, total: 10 }} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  });

  /**
   * ★ A group with no children is a real state on the first day of a school
   * year. `4/0` is not — and `Math.round(0/0)` renders the string "NaN%".
   */
  it("does not print NaN when the roster is empty", () => {
    const { container } = renderWithProviders(
      <TermProgress term="I улирал" progress={{ assessed: 0, total: 0 }} />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(container.textContent).not.toContain("NaN");
  });

  /**
   * ★ The alerts section is absent, not empty, on a quiet day.
   *
   * Its whole value is that seeing it means something. A version that always
   * rendered — three headings over three "байхгүй" lines — would teach a teacher
   * to skip past the one part of the screen that is asking for something, and
   * that failure is invisible in a screenshot of a busy day.
   */
  it("hides the alerts entirely when nothing needs attention", () => {
    renderWithProviders(
      <NeedsAttentionAlerts
        birthdaysToday={[]}
        needsAttention={{ pendingReviews: 0, childrenMissingAssessment: [] }}
      />,
    );

    // Not `toBeEmptyDOMElement` on the container: `renderWithProviders` mounts
    // the toast viewport alongside whatever it is given, so the container is
    // never empty. The absence that matters is the section itself.
    expect(screen.queryByRole("region", { name: "Анхаарах зүйлс" })).toBeNull();
  });

  it("names every child still missing an assessment, and links to them", () => {
    renderWithProviders(
      <NeedsAttentionAlerts
        birthdaysToday={[]}
        needsAttention={{
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
        }}
      />,
    );

    const alerts = screen.getByRole("region", { name: "Анхаарах зүйлс" });
    expect(within(alerts).getByText(/Сарнай/)).toBeInTheDocument();
    expect(within(alerts).getByText("Дунд бүлэг")).toBeInTheDocument();
    expect(within(alerts).getByRole("link", { name: /Сарнай/ })).toHaveAttribute(
      "href",
      `/children/${BIRTHDAY_CHILD}/assessments`,
    );
  });

  /**
   * A new kindergarten has no observations for its first week. That is a quiet
   * day, not a broken screen, and it has to say so — an empty section that
   * simply vanishes reads as a feature that failed to load.
   */
  it("offers the way to write the first observation when the feed is empty", () => {
    renderWithProviders(<RecentObservations observations={[]} />);

    const feed = screen.getByRole("region", { name: "Сүүлийн ажиглалтууд" });
    expect(within(feed).getByText("Ажиглалт хараахан бичигдээгүй")).toBeInTheDocument();
    expect(within(feed).getByRole("link", { name: "Хүүхдүүд" })).toBeInTheDocument();
  });

  /**
   * ★ `pendingReviews` exists twice in the response with the same value, and
   * this fixture gives them **different** ones on purpose.
   *
   * `dashboard.service.ts` computes one number and writes it to both
   * `counts.pendingReviews` and `needsAttention.pendingReviews`, so a fixture
   * that sets them equal cannot tell which field the screen reads. "Waiting for
   * you" is the `needsAttention` one, and the day the queue is narrowed to a
   * teacher's own groups this is what catches a card reading the other.
   */
  it("reads the review count from needsAttention, not from counts", () => {
    renderWithProviders(
      <NeedsAttentionAlerts
        birthdaysToday={[]}
        needsAttention={{ pendingReviews: 3, childrenMissingAssessment: [] }}
      />,
    );

    const alerts = screen.getByRole("region", { name: "Анхаарах зүйлс" });
    expect(within(alerts).getByText(/3 бичлэг/)).toBeInTheDocument();
    expect(within(alerts).queryByText(/9 бичлэг/)).not.toBeInTheDocument();
    expect(within(alerts).getByRole("link", { name: "Хянах" })).toBeInTheDocument();
  });

  it("counts the roster and the groups, and leaves the rest to the sections", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["TEACHER"]) },
      { path: "/children/summary", body: { total: 10, averageAgeMonths: 48, boys: 5, girls: 5 } },
    ]);

    renderWithProviders(<DashboardStats counts={{ children: 10, groups: 2, pendingReviews: 9 }} />);

    const tiles = await screen.findByRole("region", { name: "Өнөөдрийн тойм" });
    expect(within(tiles).getByText("Хүүхэд")).toBeInTheDocument();
    expect(within(tiles).getByText("Бүлэг")).toBeInTheDocument();
    // The two that were saying what the sections below already said.
    expect(within(tiles).queryByText("70%")).not.toBeInTheDocument();
    expect(within(tiles).queryByText("Хянах")).not.toBeInTheDocument();
  });
});
