import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, sessionFor, stubApi } from "./support/render";
import { EsisGroupWrite } from "@/components/esis/esis-group-write";
import { EsisWriteQueue } from "@/components/esis/esis-write-queue";

const KG = "33333333-3333-4333-8333-333333333333";
const GROUP = "11111111-1111-4111-8111-111111111111";
const WRITE = "22222222-2222-4222-8222-222222222222";

/*
 * ★ The payload is the ministry's own, captured from api-40 on 2026-09-18 —
 * `academicLevel` 17 is Ахлах, `programStageId` …361 is that level's stage. A
 * made-up payload would have agreed with whatever the screen printed, and what
 * this screen exists to prove is that it prints the bytes that will be sent.
 */
const PREPARED = {
  id: WRITE,
  service: "groupCreate",
  apiId: 150,
  state: "PREPARED",
  payload: {
    institutionId: 42778,
    event: "create",
    academicYear: "2026",
    studentGroupName: "Дэлбээ",
    academicLevel: "17",
    programStageId: "100000287145361",
  },
  response: null,
  errorCode: null,
  sentAt: null,
  createdAt: "2026-09-18T00:00:00.000Z",
  groupId: GROUP,
  group: { id: GROUP, name: "Дэлбээ" },
  preparedBy: { lastName: "Болд", firstName: "Сараа" },
  approvedBy: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("ЭСИС рүү илгээх — бүлэг", () => {
  it("shows every field of the payload, under ESIS's own names", async () => {
    const user = userEvent.setup();
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        method: "POST",
        body: PREPARED,
        status: 201,
      },
    ]);

    renderWithProviders(<EsisGroupWrite kindergartenId={KG} groupId={GROUP} groupName="Дэлбээ" />, {
      selectedChild: false,
    });

    await user.click(await screen.findByRole("button", { name: "ЭСИС-д бүртгүүлэх" }));

    /*
       The client's instruction on output, applied to a request: "garaltiin
       utguudiig bugdiig ni haruulna nuuj haaj bolohgui". Every key, and the
       ministry's spelling of it.
    */
    expect(await screen.findByText("institutionId")).toBeInTheDocument();
    expect(screen.getByText("42778")).toBeInTheDocument();
    expect(screen.getByText("event")).toBeInTheDocument();
    expect(screen.getByText("create")).toBeInTheDocument();
    expect(screen.getByText("academicLevel")).toBeInTheDocument();
    expect(screen.getByText("programStageId")).toBeInTheDocument();
    expect(screen.getByText("100000287145361")).toBeInTheDocument();
  });

  /*
   * ★★ Preparing is not sending. The whole design rests on a human seeing the
   * payload between the two, so the absence of the approve call is asserted
   * rather than assumed.
   */
  it("sends nothing until Батлах is pressed", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        method: "POST",
        body: PREPARED,
        status: 201,
      },
    ]);

    renderWithProviders(<EsisGroupWrite kindergartenId={KG} groupId={GROUP} groupName="Дэлбээ" />, {
      selectedChild: false,
    });

    await user.click(await screen.findByRole("button", { name: "ЭСИС-д бүртгүүлэх" }));
    await screen.findByText("institutionId");

    expect(calls.filter((call) => call.url.includes("/approve"))).toHaveLength(0);
  });

  it("approves the request the director read, by its own id", async () => {
    const user = userEvent.setup();
    const { calls } = stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes/${WRITE}/approve`,
        method: "POST",
        body: { ...PREPARED, state: "APPROVED" },
      },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        method: "POST",
        body: PREPARED,
        status: 201,
      },
    ]);

    renderWithProviders(<EsisGroupWrite kindergartenId={KG} groupId={GROUP} groupName="Дэлбээ" />, {
      selectedChild: false,
    });

    await user.click(await screen.findByRole("button", { name: "ЭСИС-д бүртгүүлэх" }));
    await user.click(await screen.findByRole("button", { name: "Батлах" }));

    await waitFor(() =>
      expect(calls.filter((call) => call.url.endsWith(`/${WRITE}/approve`))).toHaveLength(1),
    );
  });

  /*
   * ★★★ No delete button. There is no undo on the other side of 152's delete,
   * and spec №3б §5 opens it only against a group this system created in ESIS
   * itself — a watched exercise, not a control on a director's screen.
   */
  it("offers no way to delete a group from this screen", async () => {
    stubApi([{ path: "/auth/me", body: sessionFor(["ADMIN"]) }]);

    renderWithProviders(<EsisGroupWrite kindergartenId={KG} groupId={GROUP} groupName="Дэлбээ" />, {
      selectedChild: false,
    });

    expect(await screen.findByRole("button", { name: "ЭСИС-д бүртгүүлэх" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /устгах/i })).not.toBeInTheDocument();
  });
});

describe("Бичих самбар", () => {
  it("names the state, the group and who approved each write", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        body: {
          items: [
            {
              ...PREPARED,
              state: "SENT",
              sentAt: "2026-09-18T01:00:00.000Z",
              approvedBy: { lastName: "Дорж", firstName: "Оюун" },
              response: { studentGroupId: "100006351517832" },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        },
      },
    ]);

    renderWithProviders(<EsisWriteQueue kindergartenId={KG} />, { selectedChild: false });

    /*
       "Илгээгдсэн", never "Амжилттай": ESIS answering is not ESIS agreeing, and
       the ministry's own response is printed beside the row for the director to
       read rather than summarised into a word by this screen.
    */
    expect(await screen.findByText("Илгээгдсэн")).toBeInTheDocument();
    expect(screen.getByText("Дэлбээ")).toBeInTheDocument();
    expect(screen.getByText(/Оюун/)).toBeInTheDocument();
    expect(screen.getByText("100006351517832")).toBeInTheDocument();
    expect(screen.getByText("studentGroupId")).toBeInTheDocument();
    expect(screen.getByText("Техникийн хариу харах").closest("details")).not.toHaveAttribute(
      "open",
    );
  });

  it("says what to do next when nothing has been written yet", async () => {
    stubApi([
      { path: "/auth/me", body: sessionFor(["ADMIN"]) },
      {
        path: `/kindergartens/${KG}/esis/group-writes`,
        body: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
      },
    ]);

    renderWithProviders(<EsisWriteQueue kindergartenId={KG} />, { selectedChild: false });

    expect(await screen.findByText("ЭСИС рүү илгээсэн зүйл хараахан байхгүй.")).toBeInTheDocument();
    expect(screen.getByText(/Бүлгийн дэлгэц/)).toBeInTheDocument();
  });
});
