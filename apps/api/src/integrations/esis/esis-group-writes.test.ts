import { describe, expect, it } from "vitest";
import { buildGroupPayload, ESIS_WRITE_ENDPOINT, ESIS_WRITE_SERVICES } from "./esis-group-writes";

const GROUP = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Дэлбээ",
  ageBand: "MIDDLE",
  esisGroupId: null as string | null,
};

describe("group write payloads", () => {
  it("builds a create from the group's own row", () => {
    expect(
      buildGroupPayload({ service: "groupCreate", group: GROUP, institutionId: 42778 }),
    ).toEqual({
      institutionId: 42778,
      groupName: "Дэлбээ",
      ageBand: 3,
    });
  });

  it("names the ministry's group id on an update, not ours", () => {
    expect(
      buildGroupPayload({
        service: "groupUpdate",
        group: { ...GROUP, esisGroupId: "9987" },
        institutionId: 42778,
      }),
    ).toEqual({
      institutionId: 42778,
      studentGroupId: 9987,
      groupName: "Дэлбээ",
      ageBand: 3,
    });
  });

  /*
   * ★ The refusal that keeps an update from becoming a create. A body with
   * `studentGroupId: NaN` would be a well-formed request about no group, and
   * what the ministry does with one is not a thing to find out on their
   * production register.
   */
  it("refuses an update for a group ESIS has never seen", () => {
    expect(() =>
      buildGroupPayload({ service: "groupUpdate", group: GROUP, institutionId: 42778 }),
    ).toThrow("ESIS_GROUP_ID_UNKNOWN");
  });

  it("refuses an update whose stored ESIS id is not a number", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupUpdate",
        group: { ...GROUP, esisGroupId: "not-a-number" },
        institutionId: 42778,
      }),
    ).toThrow("ESIS_GROUP_ID_UNKNOWN");
  });

  it("carries the teacher's ESIS person id on an instructor write", () => {
    expect(
      buildGroupPayload({
        service: "groupInstructor",
        group: { ...GROUP, esisGroupId: "9987" },
        institutionId: 42778,
        esisPersonId: "5512",
      }),
    ).toEqual({
      institutionId: 42778,
      studentGroupId: 9987,
      personId: 5512,
    });
  });

  /*
   * ★ `EsisStaffRoster` is replaced wholesale on every sync, so a teacher who
   * registered since the last one has no `esisPersonId`. That is a refusal the
   * director can fix — refresh the roster — and it has to happen at prepare,
   * not in a worker running after they have already approved.
   */
  it("refuses an instructor write with no person id", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupInstructor",
        group: { ...GROUP, esisGroupId: "9987" },
        institutionId: 42778,
      }),
    ).toThrow("ESIS_PERSON_ID_UNKNOWN");
  });

  it("refuses an age band nobody has mapped to the ministry's code", () => {
    expect(() =>
      buildGroupPayload({
        service: "groupCreate",
        group: { ...GROUP, ageBand: "PRIMARY" },
        institutionId: 42778,
      }),
    ).toThrow("ESIS_AGE_BAND_UNMAPPED");
  });

  /*
   * ★ A delete posts to 152, the same endpoint an update does. If this ever
   * stops being true the guards in `esis-write.service.ts` — the typed name and
   * "we created it ourselves" — would be protecting the wrong call.
   */
  it("sends a delete down the same endpoint as an update", () => {
    expect(ESIS_WRITE_ENDPOINT.groupDelete).toBe("groupUpdate");
    expect(ESIS_WRITE_SERVICES).toContain("groupDelete");
  });
});
