import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  selectOption,
  sessionFor,
  setParams,
  setSearchParams,
  stubApi,
} from "./support/render";
import NewObservationPage from "@/app/(app)/children/[childId]/observations/new/page";

/**
 * The observation form's autosaved draft.
 *
 * ★ This is the guarantee `docs/REDESIGN_BRIEF.md` §4.4 calls the most
 * important thing about the screen — "Losing a written observation to a tapped
 * Back button is the worst failure this screen can have" — and constraint 13
 * repeats. It was documented as existing and did not exist: every field was
 * `useState` alone.
 *
 * ★★ Tested by unmounting and mounting again, not by reading `localStorage`
 * after typing.
 *
 * The failure being defended against is the component going away and coming
 * back — a Back button, a reload, a phone discarding a backgrounded tab. An
 * assertion on the storage key would pass while the restore path was broken,
 * which is the half that faces the teacher.
 */

const CHILD = "66666666-6666-4666-8666-666666666666";
const TYPE = "77777777-7777-4777-8777-777777777777";
const DOMAIN_ID = "88888888-8888-4888-8888-888888888888";
const KINDERGARTEN_ID = "33333333-3333-4333-8333-333333333333";
const INDICATOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const CHILD_DETAIL = {
  id: CHILD,
  firstName: "Сараа",
  lastName: "Болд",
  sex: "FEMALE",
  dateOfBirth: "2021-04-02",
  status: "ACTIVE",
  photoMediaFileId: null,
  enrollments: [],
  guardianships: [],
};

const TYPES = [{ id: TYPE, name: "Өдөр тутмын ажиглалт" }];

function routes() {
  return [
    { path: "/auth/me", body: sessionFor(["TEACHER"]) },
    { path: `/children/${CHILD}/observations/types`, body: TYPES },
    { path: `/children/${CHILD}`, body: CHILD_DETAIL },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/assessment-config`,
      body: {
        domains: [
          { id: DOMAIN_ID, name: "Хэл яриа, харилцаа", color: "#3b82f6", order: 3 },
          { id: "99999999-9999-4999-8999-999999999999", name: "Танин мэдэхүй", order: 4 },
        ],
        levels: [],
      },
    },
    {
      path: `/kindergartens/${KINDERGARTEN_ID}/curriculum-indicators`,
      body: [
        {
          id: INDICATOR_ID,
          code: "ХЯ1а",
          domainId: DOMAIN_ID,
          levels: [
            { level: 1, text: "Нэг дэх түвшний тайлбар." },
            { level: 2, text: "Хоёр дахь түвшний тайлбар." },
            { level: 3, text: "Гурав дахь түвшний тайлбар." },
            { level: 4, text: "Дөрөв дэх түвшний тайлбар." },
          ],
        },
      ],
    },
    {
      path: `/children/${CHILD}/observations`,
      method: "POST",
      body: { id: "created" },
      status: 201,
    },
  ];
}

/** The form with everything it reads answered. */
function stubNewObservation() {
  return stubApi(routes());
}

beforeEach(() => {
  window.localStorage.clear();
  setParams({ childId: CHILD });
  setSearchParams("");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/*
 * ★ A longer timeout than the 5s default, and it is not a flake being papered
 * over. Each of these mounts the form twice, waits out a real 500ms debounce
 * between them, and resolves three stubbed requests per mount. That is several
 * seconds of genuine waiting on an unloaded machine and more than five under a
 * full-suite run, where these files share a box with 37 others.
 */
const TIMEOUT = 20_000;

describe("Шинэ ажиглалт — ноорог", () => {
  it(
    "restores what was typed after the form is left and reopened",
    { timeout: TIMEOUT },
    async () => {
      const user = userEvent.setup();
      stubApi(routes());

      const first = renderWithProviders(<NewObservationPage />);

      const situation = await screen.findByLabelText("Ажиглагдсан байдал");
      await user.type(situation, "Цэцэрлэгийн талбайд");

      // The write is debounced, so the draft lands a moment after typing stops.
      await waitFor(() =>
        expect(window.localStorage.getItem(`nomadkids:observation-draft:staff:${CHILD}`)).toContain(
          "Цэцэрлэгийн талбайд",
        ),
      );

      // The Back button, as far as React is concerned.
      first.unmount();

      stubApi(routes());
      renderWithProviders(<NewObservationPage />);

      expect(await screen.findByLabelText("Ажиглагдсан байдал")).toHaveValue("Цэцэрлэгийн талбайд");
    },
  );

  it(
    "says the draft was restored rather than filling the form silently",
    { timeout: TIMEOUT },
    async () => {
      const user = userEvent.setup();
      stubApi(routes());

      const first = renderWithProviders(<NewObservationPage />);
      await user.type(await screen.findByLabelText("Хүүхэд юу хийсэн бэ?"), "Бөмбөг өнхрүүлэв");
      await waitFor(() =>
        expect(
          window.localStorage.getItem(`nomadkids:observation-draft:staff:${CHILD}`),
        ).toBeTruthy(),
      );
      first.unmount();

      stubApi(routes());
      renderWithProviders(<NewObservationPage />);

      expect(await screen.findByText("Хадгалаагүй ноорог сэргээгдлээ.")).toBeInTheDocument();
    },
  );

  it("does not announce a restore on a form opened fresh", async () => {
    stubApi(routes());
    renderWithProviders(<NewObservationPage />);

    await screen.findByLabelText("Ажиглагдсан байдал");
    expect(screen.queryByText("Хадгалаагүй ноорог сэргээгдлээ.")).not.toBeInTheDocument();
  });

  it(
    "keeps the draft when the save fails, because that is what it is for",
    { timeout: TIMEOUT },
    async () => {
      const user = userEvent.setup();
      // ★ The POST route goes FIRST. `stubApi` matches by `startsWith` and a
      // route with no `method` matches every verb, so `/children/:id` — which
      // has to be in the list for the child query — would otherwise answer the
      // POST with a child record and the save would fail for the wrong reason.
      stubApi([
        {
          path: `/children/${CHILD}/observations`,
          method: "POST",
          status: 500,
          body: { type: "about:blank", title: "Алдаа", status: 500, requestId: "test" },
        },
        ...routes(),
      ]);

      renderWithProviders(<NewObservationPage />);
      await user.type(await screen.findByLabelText("Ажиглагдсан байдал"), "Хашаанд");
      const key = `nomadkids:observation-draft:staff:${CHILD}`;
      await waitFor(() => expect(window.localStorage.getItem(key)).toBeTruthy());

      await user.click(screen.getByRole("button", { name: "Хадгалах" }));

      // The POST was refused; the text is still the only copy that exists.
      await waitFor(() => expect(window.localStorage.getItem(key)).toContain("Хашаанд"));
    },
  );

  /**
   * ★ Saving inside the autosave window leaves nothing behind.
   *
   * The write is debounced by 500ms, and a teacher who finishes a short note
   * and presses Хадгалах straight away does so with that timer still armed.
   * `clear()` runs on the response; the timer then fires afterwards, and its
   * dependencies have not changed, so the effect never re-ran and never
   * cleared it. Without a second check *inside* the callback it writes the
   * just-filed text back, and the next visit offers a draft of an observation
   * that has already been saved.
   *
   * The other tests cannot catch this: each waits for the draft to appear
   * before saving, which means waiting the debounce out, so no timer is armed
   * by the time they click. This one deliberately does not wait.
   */
  it(
    "leaves no draft when the save lands inside the debounce window",
    { timeout: TIMEOUT },
    async () => {
      const user = userEvent.setup();
      const key = `nomadkids:observation-draft:staff:${CHILD}`;
      stubApi([
        {
          path: `/children/${CHILD}/observations`,
          method: "POST",
          body: {
            id: "dddddddd-dddd-4ddd-8ddd-000000000002",
            childId: CHILD,
            observedOn: "2026-09-03",
            source: "TEACHER",
            reviewStatus: "APPROVED",
            visibleToParents: false,
            media: [],
          },
        },
        ...routes(),
      ]);

      renderWithProviders(<NewObservationPage />);
      await user.type(await screen.findByLabelText("Ажиглагдсан байдал"), "Богино тэмдэглэл");

      // No `waitFor` on the draft: the point is to save while it is still armed.
      await user.click(screen.getByRole("button", { name: "Хадгалах" }));
      await screen.findByText("Ажиглалт хадгалагдлаа.");

      // Outlast the debounce, then confirm nothing was written back.
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(window.localStorage.getItem(key)).toBeNull();
    },
  );

  /**
   * ★ The second observation of a sitting drafts too.
   *
   * `clear()` latches deliberately, so that the field reset which follows a
   * save is not written back out as a fresh empty draft. That latch is
   * permanent, and "Дахин бичих" reuses the same mounted form for the next
   * observation about the same child — the case the button exists for. Without
   * `resume()` autosave would be silently dead from the first save onward:
   * the guarantee this whole file is about, failing later instead of never.
   */
  it("drafts again after Дахин бичих", { timeout: TIMEOUT }, async () => {
    const user = userEvent.setup();
    const key = `nomadkids:observation-draft:staff:${CHILD}`;
    // The POST route first — see the note in the failing-save test above.
    stubApi([
      {
        path: `/children/${CHILD}/observations`,
        method: "POST",
        body: {
          id: "dddddddd-dddd-4ddd-8ddd-000000000001",
          childId: CHILD,
          observedOn: "2026-09-03",
          source: "TEACHER",
          reviewStatus: "APPROVED",
          visibleToParents: false,
          media: [],
        },
      },
      ...routes(),
    ]);

    renderWithProviders(<NewObservationPage />);
    await user.type(await screen.findByLabelText("Ажиглагдсан байдал"), "Эхний ажиглалт");
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    // Saved for real, so the draft is gone — that much the other tests cover.
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeNull());

    await user.click(await screen.findByRole("button", { name: "Дахин бичих" }));
    await user.type(await screen.findByLabelText("Ажиглагдсан байдал"), "Хоёр дахь ажиглалт");

    await waitFor(() => expect(window.localStorage.getItem(key)).toContain("Хоёр дахь ажиглалт"));
  });

  it(
    "separates a parent's draft from a teacher's on the same child",
    { timeout: TIMEOUT },
    async () => {
      const user = userEvent.setup();
      stubApi([
        { path: "/auth/me", body: sessionFor(["PARENT"]) },
        { path: `/children/${CHILD}`, body: CHILD_DETAIL },
      ]);

      const parent = renderWithProviders(<NewObservationPage />);
      await user.type(await screen.findByLabelText("Ажиглагдсан байдал"), "Гэртээ ном уншив");
      await waitFor(() =>
        expect(
          window.localStorage.getItem(`nomadkids:observation-draft:parent:${CHILD}`),
        ).toBeTruthy(),
      );
      parent.unmount();

      // The teacher's form has fields the parent's does not; a shared key would
      // reopen the family's sentence under "Багшийн дүгнэлт".
      stubApi(routes());
      renderWithProviders(<NewObservationPage />);

      expect(await screen.findByLabelText("Ажиглагдсан байдал")).toHaveValue("");
    },
  );
});

/**
 * The compose form's 2026-09-11 shape — the client's design.
 *
 * ★ Two of these fields were never on the form, and one of them was the reason
 * a whole panel elsewhere read almost zero.
 *
 * `domainIds` has been on `createObservationSchema` since it was written and
 * only the review screen ever set it, so every note a teacher filed arrived
 * untagged and "Сургалтын чиглэлийн хамралт" counted nothing. The activity was
 * free text, which produced "Өглөөний цай", "өглөөний цай" and "Өглөөний цай "
 * as three separate activities on the same breakdown.
 */
describe("Шинэ ажиглалт — the form's own fields", () => {
  it("picks the activity from the day's stages rather than typing it", async () => {
    const user = userEvent.setup();
    stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    const activity = await screen.findByLabelText("Үйл ажиллагааны явц");
    await user.click(activity);

    // The same reference list the coverage breakdown groups by, so the form
    // and the panel cannot disagree about what an activity is called.
    expect(await screen.findByRole("option", { name: "Өглөөний цай" })).toBeInTheDocument();
  });

  it("tags the note with one development strand", async () => {
    const user = userEvent.setup();
    const api = stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    await selectOption(user, "Сургалтын чиглэл", "Хэл яриа, харилцаа");
    await user.type(await screen.findByLabelText(/Ажиглагдсан байдал/), "Тэмдэглэл");
    await user.click(screen.getByRole("button", { name: /Хадгалах/ }));

    await waitFor(() =>
      expect(
        api.calls.find((call) => call.method === "POST")?.body as Record<string, unknown>,
      ).toMatchObject({ domainIds: [DOMAIN_ID] }),
    );
  });

  /**
   * ★ An unchosen strand sends nothing, not an empty array.
   *
   * The schema accepts `[]` and the service would store it as "tagged with
   * nothing" — indistinguishable from a note nobody classified, and it would
   * make the untagged case invisible.
   */
  it("sends no strand at all when none is chosen", async () => {
    const user = userEvent.setup();
    const api = stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    await user.type(await screen.findByLabelText(/Ажиглагдсан байдал/), "Тэмдэглэл");
    await user.click(screen.getByRole("button", { name: /Хадгалах/ }));

    await waitFor(() => expect(api.calls.some((call) => call.method === "POST")).toBe(true));
    const body = api.calls.find((call) => call.method === "POST")?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("domainIds");
  });

  /** A limit nobody can see is a limit discovered by losing the end of a sentence. */
  it("counts the characters against the limit", async () => {
    const user = userEvent.setup();
    stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    expect(await screen.findByText("0/1000")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Ажиглагдсан байдал/), "Тэмдэглэл");
    expect(screen.getByText("9/1000")).toBeInTheDocument();
    expect(screen.getByText("0/500")).toBeInTheDocument();
  });
});

/**
 * СҮД — the curriculum indicator and the level judged against it.
 *
 * ★ The level the child's age suggests is offered, not imposed — client,
 * 2026-09-11: 2→I, 3→II, 4→III, 5→IV.
 *
 * A four-year-old is described at level III by default because that is where
 * the curriculum expects them, and preselecting the commonest answer saves a
 * press on every note. But a teacher recording exactly the thing that differs
 * from expectation must be able to move it — and it must then stay moved,
 * which is the half a naive default gets wrong.
 */
/**
 * The code picker is disabled while the strand's indicators are in flight, so
 * a click on it before they land does nothing at all — this waits for the
 * control to be usable rather than for the option to exist.
 */
async function chooseIndicator(user: ReturnType<typeof userEvent.setup>, code: string) {
  // The picker is disabled while the strand's indicators are in flight, and
  // Radix swallows a popup opened in the same tick as the click that mounted
  // the control — so this waits for both to settle before pressing.
  await waitFor(() => expect(screen.getByLabelText("СҮД код")).toBeEnabled());
  await user.click(screen.getByLabelText("СҮД код"));
  await user.click(await screen.findByRole("option", { name: code }));
}

describe("Шинэ ажиглалт — СҮД", () => {
  it("asks for a code only once a strand is chosen", async () => {
    const user = userEvent.setup();
    stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    await screen.findByLabelText("Сургалтын чиглэл");
    expect(screen.queryByLabelText("СҮД код")).not.toBeInTheDocument();

    await selectOption(user, "Сургалтын чиглэл", "Хэл яриа, харилцаа");

    expect(await screen.findByLabelText("СҮД код")).toBeInTheDocument();
  });

  it("preselects the level the child's age suggests", async () => {
    const user = userEvent.setup();
    stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    await selectOption(user, "Сургалтын чиглэл", "Хэл яриа, харилцаа");
    await chooseIndicator(user, "ХЯ1а");

    // Сараа was born 2021-04-02 and the suite runs in 2026 — five years old,
    // which the client's rule puts at IV.
    await waitFor(() => expect(screen.getByLabelText("Түвшин")).toHaveTextContent("IV түвшин"));
  });

  /**
   * ★ Moved stays moved.
   *
   * The indicator list refetches in the background; a default that reclaimed
   * the field would undo the teacher's judgement without them touching
   * anything.
   */
  it("leaves the level alone once the teacher has set it", async () => {
    const user = userEvent.setup();
    stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    await selectOption(user, "Сургалтын чиглэл", "Хэл яриа, харилцаа");
    await chooseIndicator(user, "ХЯ1а");
    await selectOption(user, "Түвшин", "II түвшин");

    expect(screen.getByLabelText("Түвшин")).toHaveTextContent("II түвшин");
  });

  /** The descriptor is read back, so a teacher sees what they have claimed. */
  it("shows the chosen descriptor", async () => {
    const user = userEvent.setup();
    stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    await selectOption(user, "Сургалтын чиглэл", "Хэл яриа, харилцаа");
    await chooseIndicator(user, "ХЯ1а");
    await selectOption(user, "Түвшин", "II түвшин");

    expect(await screen.findByText("СҮД-ийн агуулга")).toBeInTheDocument();
    expect(screen.getByText(/Хоёр дахь түвшний тайлбар/)).toBeInTheDocument();
  });

  it("sends the code and the level together", async () => {
    const user = userEvent.setup();
    const api = stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    await selectOption(user, "Сургалтын чиглэл", "Хэл яриа, харилцаа");
    await chooseIndicator(user, "ХЯ1а");
    await user.type(screen.getByLabelText(/Ажиглагдсан байдал/), "Тэмдэглэл");
    await user.click(screen.getByRole("button", { name: /Хадгалах/ }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST")?.body).toMatchObject({
        indicatorId: INDICATOR_ID,
        indicatorLevel: 4,
      }),
    );
  });

  /**
   * ★ Changing the strand clears the code.
   *
   * The codes belong to the strand, so a code left behind would name an
   * indicator from somewhere else — and the API would refuse it, after the
   * teacher had written the note.
   */
  it("clears the code when the strand changes", async () => {
    const user = userEvent.setup();
    stubNewObservation();
    renderWithProviders(<NewObservationPage />);

    await selectOption(user, "Сургалтын чиглэл", "Хэл яриа, харилцаа");
    await chooseIndicator(user, "ХЯ1а");
    await selectOption(user, "Сургалтын чиглэл", "Танин мэдэхүй");

    expect(screen.getByLabelText("СҮД код")).toHaveTextContent("Сонгоно уу");
  });
});
