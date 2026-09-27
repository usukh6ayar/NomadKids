import { describe, expect, it } from "vitest";
import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_REQUEST_REGISTER, ESIS_RESOURCE_CATALOG } from "./esis.catalog";
import {
  ESIS_DISPOSITIONS,
  ESIS_PORTAL_REQUESTS,
  esisGrant,
  esisPortalRequest,
} from "./esis.requests";

/**
 * The join between the services this product calls and the ESIS grants it has.
 *
 * ★ This is the test that would have caught the defect it was written for.
 * `studentInfo` carried `apiId: 147` — read off its slug `API-000147` — and 147
 * is a *milk* service that is not even approved. The slug and the id are
 * separate numbers, nothing checked that the id was one the ministry had
 * granted, and the catalog screen printed "ID 147" beside "Сурагчийн ерөнхий
 * мэдээлэл" for three days.
 *
 * ★★ It is a pure data test on purpose: no app, no database, no token. The
 * facts under test are in two files and the assertion is that they agree.
 */
describe("ESIS request register", () => {
  const keys = Object.keys(ESIS_ENDPOINTS) as (keyof typeof ESIS_ENDPOINTS)[];

  /*
   * ★ 97/84 since 2026-09-14, was 96/83.
   *
   * The portal's "Ашиглах боломжтой сервисүүд" list was reconciled against
   * this register row by row and came to 84 approvals against the register's
   * 83: `apiId: 105`, the v2 attendance save, was the row that had been
   * missed. Nothing calls it — the adapter uses v3 on purpose — but a register
   * that silently omits a grant is one the portal cannot be checked against,
   * which is the only thing this file is for.
   */
  it("carries the portal's register as read on 2026-09-14", () => {
    expect(ESIS_PORTAL_REQUESTS).toHaveLength(97);
    expect(ESIS_REQUEST_REGISTER.counts.total).toBe(97);
    expect(ESIS_REQUEST_REGISTER.counts.approved).toBe(84);
    expect(ESIS_REQUEST_REGISTER.counts.pending).toBe(12);
    expect(ESIS_REQUEST_REGISTER.counts.cancelled).toBe(1);
  });

  /*
   * ★★ The portal's own count, pinned separately from the register's length.
   *
   * The assertion above would still pass if a pending row were flipped to
   * approved to make the total match — this one would not. 84 is what the
   * portal's approved list shows, and it is the number an operator can read
   * back off the screen without adding anything up.
   */
  it("counts exactly the 84 services the portal lists as available", () => {
    const approved = ESIS_PORTAL_REQUESTS.filter((request) => request.status === "APPROVED");
    expect(approved).toHaveLength(84);
  });

  it("gives every carried service an id the ministry approved", () => {
    for (const key of keys) {
      const { apiId } = ESIS_ENDPOINTS[key];
      expect(apiId, `${key} has no portal id`).not.toBeNull();
      expect(esisGrant(apiId), `${key} (api ${apiId}) is not approved`).toBe("APPROVED");
    }
  });

  /*
   * ★ The defect, pinned from both ends.
   *
   * The first assertion is the correction: "Сурагчийн ерөнхий мэдээлэл" is 48.
   * The second is why the old value was wrong rather than merely different —
   * 147 is a service this product does not call and could not call if it
   * wanted to, because the request is still pending.
   */
  it("prices studentInfo at 48, not at its slug", () => {
    expect(ESIS_ENDPOINTS.studentInfo.apiId).toBe(48);
    expect(esisPortalRequest(48)?.name).toBe("Сурагчийн ерөнхий мэдээлэл");

    const milk = esisPortalRequest(147);
    expect(milk?.name).toBe("Сүү хөтөлбөрийн гүйцэтгэл хадгалах");
    expect(milk?.status).toBe("PENDING");
    expect(ESIS_REQUEST_REGISTER.items.find((item) => item.apiId === 147)?.serviceKey).toBeNull();
  });

  /*
   * ★ Two services sharing an id is the other way this can go wrong, and it is
   * quieter: the second one silently reports the first one's grant, and
   * `WIRED_API_IDS` keeps only one of them so the "in use" count is short.
   */
  it("gives each service its own id", () => {
    const ids = keys.map((key) => ESIS_ENDPOINTS[key].apiId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names each service's id in the register, for checking against the portal", () => {
    for (const endpoint of ESIS_RESOURCE_CATALOG) {
      expect(endpoint.portalName, `${endpoint.key} has no portal name`).not.toBeNull();
      expect(endpoint.grant).toBe("APPROVED");
    }
  });

  /*
   * ★ The count the operator screen shows, derived rather than asserted by
   * hand: every carried service is one of the register's approved rows, so the
   * "in use" figure is exactly the number of services in the catalog.
   */
  it("counts the grants in use as the size of the catalog", () => {
    expect(ESIS_REQUEST_REGISTER.counts.wired).toBe(keys.length);
    expect(ESIS_REQUEST_REGISTER.counts.approvedUnwired).toBe(
      ESIS_REQUEST_REGISTER.counts.approved - keys.length,
    );
  });

  /*
   * ★ Plan `2026-09-16-esis-sync-tiers.md` Task 9: an approved-but-unwired
   * grant must say *why*, or spec №4's matrix cannot tell "declined on
   * purpose" from "not reached yet". Every disposition names an id that is
   * actually approved and actually uncalled — a reason attached to a wired
   * service, or to one the ministry never granted, would be a note nobody can
   * act on.
   */
  it("gives every disposition a real, unwired grant to explain", () => {
    for (const apiId of Object.keys(ESIS_DISPOSITIONS).map(Number)) {
      const request = esisPortalRequest(apiId);
      expect({ apiId, status: request?.status ?? null }).toEqual({ apiId, status: "APPROVED" });
      expect({ apiId, wired: keys.some((key) => ESIS_ENDPOINTS[key].apiId === apiId) }).toEqual({
        apiId,
        wired: false,
      });
    }
  });

  it("carries the disposition reason through to the register", () => {
    for (const apiId of Object.keys(ESIS_DISPOSITIONS).map(Number)) {
      const item = ESIS_REQUEST_REGISTER.items.find((entry) => entry.apiId === apiId);
      expect(item?.dispositionReason).toBe(ESIS_DISPOSITIONS[apiId]);
    }
  });
});
