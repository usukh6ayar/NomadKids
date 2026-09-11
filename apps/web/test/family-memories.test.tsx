import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setParams, stubApi } from "./support/render";
import AgeProfilePage from "@/app/(app)/children/[childId]/portfolio/growth/age/[age]/page";

/**
 * "Гэр бүлийн дурсамж" — the family section's memory builder.
 *
 * ★ Two things are under test, and the second is the reason the feature was
 * asked for: that a memory persists through the *existing* age-profile PATCH,
 * and that its photograph is filed into that age's album rather than into a
 * store of its own. The second is what makes a picture added here show up
 * under `portfolio/gallery/:age` → "Миний гэр бүл", and it is asserted on the
 * request the browser actually makes — `category=FAMILY` plus the age — not on
 * a helper that could agree with a broken screen.
 */

const CHILD_ID = "44444444-4444-4444-8444-444444444444";
const ARCHIVE_PHOTO_ID = "55555555-5555-4555-8555-555555555555";
const FILED_PHOTO_ID = "66666666-6666-4666-8666-666666666666";

const CHILD = {
  id: CHILD_ID,
  lastName: "Ганболд",
  firstName: "Батбаяр",
  sex: "MALE",
  dateOfBirth: "2023-04-12",
  status: "ACTIVE",
  photoMediaFileId: null,
  enrollments: [],
  guardianships: [],
  kindergarten: { id: "33333333-3333-4333-8333-333333333333", name: "Цэцэрлэг" },
  healthNotes: null,
};

/** An untagged photograph — no age, no category, no caption. */
const UNTAGGED = {
  id: ARCHIVE_PHOTO_ID,
  caption: null,
  age: null,
  category: null,
  takenAt: null,
};

/** One already filed under a different album, with a caption of its own. */
const ALREADY_FILED = {
  id: FILED_PHOTO_ID,
  caption: "Далайн эрэг",
  age: 3,
  category: "TRAVEL",
  takenAt: "2024-05-01T00:00:00.000Z",
};

function stub({
  profile = { age: 3 },
  archive = [UNTAGGED],
  patchStatus,
  patchBody,
}: {
  profile?: Record<string, unknown>;
  archive?: Record<string, unknown>[];
  patchStatus?: number;
  patchBody?: unknown;
} = {}) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["PARENT"]) },
    {
      path: `/children/${CHILD_ID}/age-profiles/3`,
      method: "PATCH",
      status: patchStatus,
      body: patchBody ?? { ...profile, age: 3 },
    },
    { path: `/children/${CHILD_ID}/age-profiles`, body: [profile] },
    {
      path: `/children/${CHILD_ID}/media`,
      body: {
        items: archive,
        page: 1,
        pageSize: 40,
        total: archive.length,
        totalPages: 1,
      },
    },
    { path: "/media/", method: "PATCH", body: UNTAGGED },
    { path: `/children/${CHILD_ID}`, body: CHILD },
  ]);
}

async function openFamilyEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Миний гэр бүл үйлдэл" }));
  await user.click(screen.getByRole("menuitem", { name: "Засах" }));
  return screen.getByRole("dialog", { name: "Миний гэр бүл" });
}

/**
 * The one member picker left — the memory's own. It is a `<fieldset>`, which is
 * a `group` named by its `<legend>`.
 */
const memoryMembers = (dialog: HTMLElement) =>
  within(dialog).getByRole("group", { name: "Хэнтэй хамт байсан бэ?" });

/**
 * Fills a field in one event instead of one per character.
 *
 * ★ Not a style preference — a budget. Every keystroke in this dialog
 * re-renders the member picker, the archive grid and the live preview, and a
 * 31-character Cyrillic title spent 1.7s of a 5s ceiling doing it. That passes
 * alone and is a coin flip in a full run, which is exactly the kind of failure
 * CLAUDE.md §4.4 asks nobody to wave through.
 *
 * `user.type` is kept where the per-keystroke behaviour *is* the subject — the
 * live-preview test below.
 */
async function fill(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, value: string) {
  await user.click(field);
  await user.paste(value);
}

const patchOf = (api: ReturnType<typeof stubApi>, path: string) =>
  api.calls.find((call) => call.method === "PATCH" && call.url.startsWith(path));

beforeEach(() => {
  vi.clearAllMocks();
  setParams({ childId: CHILD_ID, age: "3" });
});

describe("the legacy fields survive losing their editors", () => {
  /**
   * ★ The guard on a stripped-down editor: what it no longer edits, it must
   * not destroy.
   *
   * Both legacy fields lost their controls on 2026-09-10 — the member picker
   * first, then the free-text box. `familyMemberTypes` comes back unchanged
   * because there are no memories to derive it from; `familyDescription` is
   * absent from the body altogether, and a partial upsert leaves an absent
   * field alone. A save here must not blank either one.
   */
  it("no longer edits the two legacy fields, and does not wipe them", async () => {
    const user = userEvent.setup();
    const api = stub({
      profile: {
        age: 3,
        familyMemberTypes: ["Аав, ээж"],
        familyDescription: "Ном унших дуртай.",
      },
    });
    renderWithProviders(<AgeProfilePage />);

    const dialog = await openFamilyEditor(user);

    expect(
      within(dialog).queryByRole("group", { name: "Гэр бүлийн гишүүд" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("textbox", { name: "Хамтдаа хийх дуртай зүйлс" }),
    ).not.toBeInTheDocument();
    // The memory's own picker is what is left.
    expect(memoryMembers(dialog)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => {
      expect(patchOf(api, `/children/${CHILD_ID}/age-profiles/3`)?.body).toEqual({
        familyMemberTypes: ["Аав, ээж"],
        familyMemories: [],
      });
    });
  });

  /** A record written before memories existed opens and reads back normally. */
  it("renders a stored record that has no memories at all", async () => {
    stub({
      profile: {
        age: 3,
        familyMemberTypes: ["Эмээ, өвөө"],
        familyDescription: "Хамт хоол хийдэг.",
      },
    });
    renderWithProviders(<AgeProfilePage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Миний гэр бүл дэлгэрэнгүй" })).toBeInTheDocument(),
    );
  });
});

describe("building a memory", () => {
  it("stores who, what, when and the photograph in one age-profile save", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<AgeProfilePage />);

    const dialog = await openFamilyEditor(user);

    // The archive is the child's own photographs, read from the ordinary
    // gallery endpoint — no second store to populate first.
    const photo = await within(dialog).findByRole("button", {
      name: /Тэмдэглэлгүй зураг — дурсамжид сонгох/,
    });
    await user.click(photo);

    await user.click(within(memoryMembers(dialog)).getByRole("button", { name: /Эмээ, өвөө/ }));
    await fill(
      user,
      within(dialog).getByRole("textbox", { name: /Дурсамжийн нэр/ }),
      "2 насандаа эмээтэйгээ парк орсон",
    );
    await fill(
      user,
      within(dialog).getByRole("textbox", { name: "Дурсамжийн тайлбар" }),
      "Парканд цэцэг үзэж алхсан.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Дурсамж нэмэх" }));
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(patchOf(api, `/children/${CHILD_ID}/age-profiles/3`)).toBeDefined());

    const body = patchOf(api, `/children/${CHILD_ID}/age-profiles/3`)!.body as {
      familyMemories: Record<string, unknown>[];
      familyMemberTypes: string[];
    };
    expect(body.familyMemories).toHaveLength(1);
    // ★ The section's member list is now the memories' own, deduplicated — the
    // upper picker that used to write it was removed on 2026-09-10.
    expect(body.familyMemberTypes).toEqual(["Эмээ, өвөө"]);
    expect(body.familyMemories[0]).toMatchObject({
      mediaId: ARCHIVE_PHOTO_ID,
      members: ["Эмээ, өвөө"],
      title: "2 насандаа эмээтэйгээ парк орсон",
      description: "Парканд цэцэг үзэж алхсан.",
    });
  });

  it("refuses a memory with no name and no family member, and says why", async () => {
    const user = userEvent.setup();
    const api = stub();
    renderWithProviders(<AgeProfilePage />);

    const dialog = await openFamilyEditor(user);
    await user.click(
      await within(dialog).findByRole("button", { name: /Тэмдэглэлгүй зураг — дурсамжид сонгох/ }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Дурсамж нэмэх" }));

    // Inline, announced, and beside the control — never an alert().
    expect(await within(dialog).findByText("Дурсамжийн нэрийг бичнэ үү.")).toBeInTheDocument();
    expect(within(dialog).getByText("Хэнтэй хамт байсныг сонгоно уу.")).toBeInTheDocument();
    expect(within(dialog).getByText("Хадгалсан дурсамжууд (0)")).toBeInTheDocument();

    // …and the invalid draft never reaches the API.
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));
    expect(patchOf(api, `/children/${CHILD_ID}/age-profiles/3`)).toBeUndefined();
  });

  /**
   * The preview is the point of the two-column layout: it has to be the memory
   * being written, not a rendering of what was last saved.
   */
  it("shows what is being typed, before anything is saved", async () => {
    const user = userEvent.setup();
    stub();
    renderWithProviders(<AgeProfilePage />);

    const dialog = await openFamilyEditor(user);
    await user.type(
      within(dialog).getByRole("textbox", { name: /Дурсамжийн нэр/ }),
      "Өвөөтэйгөө дугуй унасан",
    );

    expect(
      await within(dialog).findByRole("heading", { name: "Өвөөтэйгөө дугуй унасан" }),
    ).toBeInTheDocument();
  });

  it("edits and deletes a stored memory, with a confirmation before the delete", async () => {
    const user = userEvent.setup();
    const api = stub({
      profile: {
        age: 3,
        familyMemberTypes: ["Аав, ээж"],
        familyMemories: [
          {
            id: "m1",
            mediaId: ARCHIVE_PHOTO_ID,
            members: ["Аав, ээж"],
            title: "Ааваараа дугуй унасан",
            description: null,
            date: "2024-06-20",
          },
        ],
      },
    });
    renderWithProviders(<AgeProfilePage />);

    const dialog = await openFamilyEditor(user);

    // Editing loads the memory back into the draft, photograph and all.
    await user.click(within(dialog).getByRole("button", { name: "Ааваараа дугуй унасан засах" }));
    expect(within(dialog).getByRole("textbox", { name: /Дурсамжийн нэр/ })).toHaveValue(
      "Ааваараа дугуй унасан",
    );

    // Distinct from the dialog's own "Болих", which closes the section.
    await user.click(within(dialog).getByRole("button", { name: "Засварыг болих" }));
    await user.click(within(dialog).getByRole("button", { name: "Ааваараа дугуй унасан устгах" }));

    // CLAUDE.md §5 — confirmed before it goes, and in place rather than in a
    // second dialog stacked on this one.
    expect(within(dialog).getByText("Устгах уу?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Тийм" }));
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() =>
      expect(
        (patchOf(api, `/children/${CHILD_ID}/age-profiles/3`)?.body as { familyMemories: [] })
          .familyMemories,
      ).toEqual([]),
    );
  });

  /**
   * ★ A failed save must not cost the parent the memory they just wrote.
   *
   * "Дурсамж нэмэх" only moves the draft into the list held on this
   * screen; the write happens on "Хадгалах". So a 500 has to leave the
   * dialog open with the memory still in it, ready to retry — the same
   * guarantee `growth-age-navigation.test.tsx` asks of the other four cards,
   * where the draft is a sentence rather than a whole memory.
   */
  it("keeps a written memory on screen when the save fails", async () => {
    const user = userEvent.setup();
    stub({
      patchStatus: 500,
      patchBody: {
        type: "about:blank",
        title: "Серверийн алдаа",
        status: 500,
        detail: "Түр хүлээгээд дахин оролдоно уу.",
        requestId: "test",
      },
    });
    renderWithProviders(<AgeProfilePage />);

    const dialog = await openFamilyEditor(user);
    await user.click(within(memoryMembers(dialog)).getByRole("button", { name: /Эмээ, өвөө/ }));
    await fill(
      user,
      within(dialog).getByRole("textbox", { name: /Дурсамжийн нэр/ }),
      "Эмээтэй хамт",
    );
    await user.click(within(dialog).getByRole("button", { name: "Дурсамж нэмэх" }));
    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    expect(await screen.findAllByText("Түр хүлээгээд дахин оролдоно уу.")).toHaveLength(2);
    expect(screen.getByRole("dialog", { name: "Миний гэр бүл" })).toBeInTheDocument();
    expect(within(dialog).getByText("Хадгалсан дурсамжууд (1)")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Эмээтэй хамт засах" })).toBeInTheDocument();
  });
});

describe("a memory's photograph lands in that age's album", () => {
  /**
   * ★ The requirement, stated as a request: an upload from the family section
   * is an ordinary album write carrying `category=FAMILY` and the age, which is
   * exactly what `portfolio/gallery/:age` reads. No parallel store, no copy.
   */
  it("uploads through the album endpoint, tagged with the family category and the age", async () => {
    const user = userEvent.setup();
    const api = stubApi([
      { path: "/auth/me", body: sessionFor(["PARENT"]) },
      { path: `/children/${CHILD_ID}/age-profiles`, body: [{ age: 3 }] },
      {
        path: `/children/${CHILD_ID}/media`,
        method: "POST",
        body: { items: [UNTAGGED], failed: [] },
      },
      {
        path: `/children/${CHILD_ID}/media`,
        body: { items: [], page: 1, pageSize: 40, total: 0, totalPages: 0 },
      },
      { path: `/children/${CHILD_ID}`, body: CHILD },
    ]);
    renderWithProviders(<AgeProfilePage />);

    const dialog = await openFamilyEditor(user);
    const input = within(dialog).getByLabelText("Зураг нэмэх");

    /*
      ★ The trigger is a dashed tile carrying the icon alone — the client asked
      for the "Зураг нэмэх" text to go on 2026-09-10.

      Asserted on the class and the `sr-only` span rather than on visibility,
      because jsdom has no layout engine and cannot tell a hidden span from a
      shown one — the same reason `responsive.test.tsx` pins constraints in
      source. The half that matters is that the *name* survived the text: an
      icon-only control with no accessible name is unusable by anything that
      cannot see it, and `getByLabelText` above is what proves it did.
    */
    const trigger = dialog.querySelector(`label[for="${input.id}"]`)!;
    expect(trigger.className).toContain("border-dashed");
    expect(trigger.querySelector("span.sr-only")).toHaveTextContent("Зураг нэмэх");

    const file = new File(["photo"], "eej.jpg", { type: "image/jpeg" });
    await user.upload(input, file);

    await waitFor(() => {
      const upload = api.calls.find(
        (call) => call.method === "POST" && call.url.startsWith(`/children/${CHILD_ID}/media`),
      );
      expect(upload).toBeDefined();
      const form = upload!.body as FormData;
      expect(form.get("category")).toBe("FAMILY");
      expect(form.get("age")).toBe("3");
      expect(form.get("purpose")).toBe("CHILD_PHOTO");
    });
  });

  /**
   * ★ An archive photograph is filed, not re-filed.
   *
   * A picture the family already put under "Аялал, зугаалга" with a caption of
   * its own keeps both when it is reused in a memory — only the blanks are
   * filled. Re-tagging it would move a photograph out of an album nobody asked
   * to empty.
   */
  it("fills an untagged archive photo's blanks and leaves a filed one alone", async () => {
    const user = userEvent.setup();
    const api = stub({ archive: [UNTAGGED, ALREADY_FILED] });
    renderWithProviders(<AgeProfilePage />);

    const dialog = await openFamilyEditor(user);

    // The one that is already filed elsewhere.
    await user.click(await within(dialog).findByRole("button", { name: /Далайн эрэг/ }));
    await user.click(within(memoryMembers(dialog)).getByRole("button", { name: /Аав, ээж/ }));
    await fill(
      user,
      within(dialog).getByRole("textbox", { name: /Дурсамжийн нэр/ }),
      "Далайд явсан",
    );
    await user.click(within(dialog).getByRole("button", { name: "Дурсамж нэмэх" }));

    // …and the untagged one.
    await user.click(
      within(dialog).getByRole("button", { name: /Тэмдэглэлгүй зураг — дурсамжид сонгох/ }),
    );
    await user.click(within(memoryMembers(dialog)).getByRole("button", { name: /Эмээ, өвөө/ }));
    await fill(
      user,
      within(dialog).getByRole("textbox", { name: /Дурсамжийн нэр/ }),
      "Эмээтэй хамт",
    );
    await user.click(within(dialog).getByRole("button", { name: "Дурсамж нэмэх" }));

    await user.click(screen.getByRole("button", { name: "Хадгалах" }));

    await waitFor(() => expect(patchOf(api, `/media/${ARCHIVE_PHOTO_ID}`)).toBeDefined());

    expect(patchOf(api, `/media/${ARCHIVE_PHOTO_ID}`)!.body).toEqual({
      caption: "Эмээтэй хамт",
      age: 3,
      category: "FAMILY",
    });
    // Nothing was sent for the photograph that already had all three.
    expect(patchOf(api, `/media/${FILED_PHOTO_ID}`)).toBeUndefined();
  });
});
