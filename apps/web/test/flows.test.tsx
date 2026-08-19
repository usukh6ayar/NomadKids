import { screen, waitFor } from "@testing-library/react";
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

const CHILD_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const TERM_ID = "66666666-6666-4666-8666-666666666666";
const DOMAIN_ID = "77777777-7777-4777-8777-777777777777";
const LEVEL_ID = "88888888-8888-4888-8888-888888888888";
const TYPE_ID = "99999999-9999-4999-8999-999999999999";

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

    const identifier = screen.getByLabelText(/Хэрэглэгчийн нэр/);
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

    await user.type(screen.getByLabelText(/Хэрэглэгчийн нэр/), "bagsh");
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
      { path: `/children/${CHILD_ID}/media`, body: [] },
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
      { path: `/children/${CHILD_ID}/media`, body: [] },
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
