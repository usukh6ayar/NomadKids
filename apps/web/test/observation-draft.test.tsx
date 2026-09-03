import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
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
  ];
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

      const situation = await screen.findByLabelText("Нөхцөл байдал");
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

      expect(await screen.findByLabelText("Нөхцөл байдал")).toHaveValue("Цэцэрлэгийн талбайд");
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

    await screen.findByLabelText("Нөхцөл байдал");
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
      await user.type(await screen.findByLabelText("Нөхцөл байдал"), "Хашаанд");
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
      await user.type(await screen.findByLabelText("Нөхцөл байдал"), "Богино тэмдэглэл");

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
    await user.type(await screen.findByLabelText("Нөхцөл байдал"), "Эхний ажиглалт");
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    // Saved for real, so the draft is gone — that much the other tests cover.
    await waitFor(() => expect(window.localStorage.getItem(key)).toBeNull());

    await user.click(await screen.findByRole("button", { name: "Дахин бичих" }));
    await user.type(await screen.findByLabelText("Нөхцөл байдал"), "Хоёр дахь ажиглалт");

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
      await user.type(await screen.findByLabelText("Нөхцөл байдал"), "Гэртээ ном уншив");
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

      expect(await screen.findByLabelText("Нөхцөл байдал")).toHaveValue("");
    },
  );
});
