import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, setSearchParams, stubApi } from "./support/render";
import { ChildHealth } from "@/components/child/child-health";

/**
 * Removing a health record that should never have existed — RFP Module 2.
 *
 * ★ Why this is a safety feature and not CRUD tidiness.
 *
 * `GET /kindergartens/:id/menu/with-warnings` cross-checks the day's dishes
 * against every active allergy, and the teacher dashboard renders the result as
 * an instruction. A wrong allergy therefore reaches a kitchen. Until now the
 * screen could create all three record types and remove none of them: the
 * DELETE endpoints had shipped with the module and nothing called them.
 *
 * ★★ Deleting is deliberately not the same control as ending.
 *
 * "Дуусгах" (`PATCH { endedOn }`) is for a child who outgrew an allergy — real
 * history. "Устгах" is for a row that was never true. Both exist on the same
 * line, so these assert they stay distinguishable.
 */

const CHILD = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const OTHER_PARENT = "33333333-3333-4333-8333-333333333333";

const ALLERGY = {
  id: "44444444-4444-4444-8444-444444444444",
  kind: "FOOD",
  severity: "SEVERE",
  allergen: "самар",
  reaction: null,
  treatment: null,
  notedOn: "2026-01-10",
  endedOn: null,
};

const VACCINATION = {
  id: "55555555-5555-4555-8555-555555555555",
  vaccineName: "Улаанбурхан",
  administeredOn: "2026-01-05",
  doseLabel: null,
  provider: null,
  note: null,
  recordedBy: null,
};

function medication(authorisedById: string | null) {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    medicineName: "Парацетамол",
    dosage: "5 мл",
    timesOfDay: ["12:00"],
    instructions: null,
    startsOn: "2026-08-20",
    endsOn: "2026-09-20",
    authorisedBy: authorisedById
      ? { id: authorisedById, lastName: "Тест", firstName: "Эцэг" }
      : null,
    isActive: true,
  };
}

function health(over: Record<string, unknown> = {}) {
  return {
    allergies: [ALLERGY],
    medications: [],
    vaccinations: [],
    healthNotes: null,
    ...over,
  };
}

function stubHealth(body: unknown, deleteStatus = 200) {
  return stubApi([
    { path: "/auth/me", body: sessionFor(["TEACHER"], ME) },
    { path: "/allergies/", method: "DELETE", status: deleteStatus, body: { id: ALLERGY.id } },
    { path: "/vaccinations/", method: "DELETE", body: { id: VACCINATION.id } },
    {
      path: "/medications/",
      method: "DELETE",
      body: { id: "66666666-6666-4666-8666-666666666666" },
    },
    { path: `/children/${CHILD}/health`, body },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSearchParams("");
});

describe("устгах — харшил", () => {
  it("offers staff a delete beside the end action", async () => {
    stubHealth(health());
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    expect(await screen.findByRole("button", { name: "самар — устгах" })).toBeInTheDocument();
    // The two are different actions and must stay tellable apart.
    expect(screen.getByRole("button", { name: "Дуусгах" })).toBeInTheDocument();
  });

  it("shows a guardian no delete — an allergy is staff's to record and remove", async () => {
    stubHealth(health());
    renderWithProviders(<ChildHealth childId={CHILD} isStaff={false} />);

    expect(await screen.findByText("самар")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /устгах/ })).toBeNull();
  });

  it("opens a confirmation that names the record and says which action to use", async () => {
    stubHealth(health());
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "самар — устгах" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/буруу бүртгэсэн бол устгана/)).toBeInTheDocument();
    // The copy has to steer an outgrown allergy to "Дуусгах" instead.
    expect(within(dialog).getByText(/Дуусгах/)).toBeInTheDocument();
  });

  it("cancelling sends no request", async () => {
    const { calls } = stubHealth(health());
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "самар — устгах" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Болих" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  /** ★ Exactly one — the dialog's confirm is disabled while the request runs. */
  it("confirming sends exactly one DELETE to the record's own path", async () => {
    const { calls } = stubHealth(health());
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "самар — устгах" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Устгах" }));

    await waitFor(() => {
      const deletes = calls.filter((c) => c.method === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.url).toBe(`/allergies/${ALLERGY.id}`);
    });
  });

  it("refetches the health record and confirms with a toast", async () => {
    const { calls } = stubHealth(health());
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "самар — устгах" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Устгах" }),
    );

    // The row leaves because the query is invalidated, not because the client
    // removed it from a local list.
    await waitFor(() => {
      const reads = calls.filter((c) => c.method === "GET" && c.url.includes("/health"));
      expect(reads.length).toBeGreaterThan(1);
    });
    expect(await screen.findByText(/устгагдлаа/)).toBeInTheDocument();
  });

  /**
   * ★★ The API error stays on the page.
   *
   * The likely failure is a 404 for a row somebody else already removed, and
   * that message explains a list that is about to change under the reader. A
   * toast would take it away on a timer.
   */
  it("keeps an API failure inline rather than dismissing it", async () => {
    stubHealth(health(), 500);
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "самар — устгах" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Устгах" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/устгагдлаа/)).toBeNull();
  });

  /**
   * ★★★ A record entered by mistake is often ended before anyone works out it
   * was wrong. Ending it again is not the repair, so the delete has to reach
   * the ended list — where "Дуусгах" is correctly absent.
   */
  it("can delete an allergy that has already been ended", async () => {
    stubHealth(health({ allergies: [{ ...ALLERGY, endedOn: "2026-08-01" }] }));
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByText(/Дууссан харшил/));

    expect(await screen.findByRole("button", { name: "самар — устгах" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Дуусгах" })).toBeNull();
  });
});

describe("устгах — вакцин ба эм", () => {
  it("lets staff delete a vaccination", async () => {
    const { calls } = stubHealth(health({ allergies: [], vaccinations: [VACCINATION] }));
    const user = userEvent.setup();
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    await user.click(await screen.findByRole("button", { name: "Улаанбурхан — устгах" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Устгах" }),
    );

    await waitFor(() =>
      expect(calls.find((c) => c.method === "DELETE")!.url).toBe(`/vaccinations/${VACCINATION.id}`),
    );
  });

  it("shows a guardian no delete on a vaccination — it is the kindergarten's register", async () => {
    stubHealth(health({ allergies: [], vaccinations: [VACCINATION] }));
    renderWithProviders(<ChildHealth childId={CHILD} isStaff={false} />);

    expect(await screen.findByText("Улаанбурхан")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /устгах/ })).toBeNull();
  });

  /**
   * ★ The row *is* the consent, so the parent who signed it may withdraw it —
   * and `removeMedication` 404s any other guardian. Offering them the button
   * would be offering a control that always fails.
   */
  it("offers the authorising guardian a delete on their own medication", async () => {
    stubHealth(health({ allergies: [], medications: [medication(ME)] }));
    renderWithProviders(<ChildHealth childId={CHILD} isStaff={false} />);

    expect(await screen.findByRole("button", { name: "Парацетамол — устгах" })).toBeInTheDocument();
  });

  it("hides it from a guardian who did not authorise it", async () => {
    stubHealth(health({ allergies: [], medications: [medication(OTHER_PARENT)] }));
    renderWithProviders(<ChildHealth childId={CHILD} isStaff={false} />);

    expect(await screen.findByText("Парацетамол")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /устгах/ })).toBeNull();
  });

  it("staff may withdraw a medication a family authorised", async () => {
    stubHealth(health({ allergies: [], medications: [medication(OTHER_PARENT)] }));
    renderWithProviders(<ChildHealth childId={CHILD} isStaff />);

    expect(await screen.findByRole("button", { name: "Парацетамол — устгах" })).toBeInTheDocument();
  });
});
