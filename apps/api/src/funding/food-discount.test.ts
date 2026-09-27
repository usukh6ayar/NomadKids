import { describe, expect, it } from "vitest";
import {
  countByStatus,
  discountStatus,
  foodDiscountByChild,
  personIdByChild,
  type DiscountEntry,
  type LocalChild,
  type RosterEntry,
} from "./food-discount";

/**
 * The join between the ministry's meal-subsidy list and the local roster.
 *
 * ★ A pure data test, like `funding-rules.test.ts` beside it: no app, no
 * database, no token. What is hard here is the matching, and matching is
 * exactly what has to be readable on its own.
 *
 * ★★ The shapes are the real ones. `cook/levelHood/students` returns 65 rows
 * against a roster of 83 on institution 42778, of which 31 say "Тийм" — so the
 * three-state answer below is not a hypothetical, it is what that response
 * looks like.
 */

const child = (id: string, lastName: string, firstName: string, dob: string): LocalChild => ({
  id,
  lastName,
  firstName,
  dateOfBirth: new Date(`${dob}T00:00:00.000Z`),
});

const rosterEntry = (
  personId: string,
  lastName: string,
  firstName: string,
  dob: string,
): RosterEntry => ({
  personId,
  lastName,
  firstName,
  // ESIS sends midnight UTC with the time attached, which is the form the
  // matcher has to cope with.
  dateOfBirth: `${dob}T00:00:00.000Z`,
});

const discount = (personId: string, isFoodDiscount: string | null): DiscountEntry => ({
  personId,
  isFoodDiscount,
  orderNum: null,
});

describe("ESIS-ийн хоолны хөнгөлөлтийн төлөв", () => {
  it("reads the ministry's Mongolian yes and no", () => {
    expect(discountStatus("Тийм")).toBe("ELIGIBLE");
    expect(discountStatus("Үгүй")).toBe("NOT_ELIGIBLE");
  });

  /*
   * ★ Prose, not a code — so case and padding are not contract. ESIS sends
   * "Тийм" today and nothing promises it will not send " тийм" tomorrow.
   */
  it("does not depend on the casing or padding ESIS happens to send", () => {
    expect(discountStatus("  тийм ")).toBe("ELIGIBLE");
    expect(discountStatus("ҮГҮЙ")).toBe("NOT_ELIGIBLE");
  });

  /*
   * ★★ The safe direction. An unrecognised word must never read as a refusal:
   * "not eligible" charges a family, and a value this code has not seen before
   * is not a statement that the state declined to pay.
   */
  it("treats anything it does not recognise as unassessed, never as a refusal", () => {
    for (const value of [null, "", "   ", "Тодорхойгүй"]) {
      expect(discountStatus(value), JSON.stringify(value)).toBe("UNASSESSED");
    }
  });
});

describe("хүүхдийг ESIS-ийн бүртгэлтэй тулгах", () => {
  it("matches on name and date of birth together", () => {
    const children = [child("c1", "Ганболд", "Батбаяр", "2021-04-12")];
    const roster = [rosterEntry("90001", "Ганболд", "Батбаяр", "2021-04-12")];

    expect(personIdByChild(children, roster)).toEqual(new Map([["c1", "90001"]]));
  });

  /*
   * ★ The birth date is what makes the match safe enough to price money
   * against. Two children called Б.Сараа in one kindergarten is ordinary.
   */
  it("does not match a namesake born on another day", () => {
    const children = [child("c1", "Ганболд", "Батбаяр", "2021-04-12")];
    const roster = [rosterEntry("90001", "Ганболд", "Батбаяр", "2022-01-01")];

    expect(personIdByChild(children, roster).size).toBe(0);
  });

  /*
   * ★★ The case that must not be a coin toss. Two roster entries fitting one
   * child resolves to *neither*: the child comes back UNASSESSED and their
   * price is left alone, rather than being decided by whichever row sorted
   * first.
   */
  it("refuses to choose between two identical roster entries", () => {
    const children = [child("c1", "Ганболд", "Батбаяр", "2021-04-12")];
    const roster = [
      rosterEntry("90001", "Ганболд", "Батбаяр", "2021-04-12"),
      rosterEntry("90002", "Ганболд", "Батбаяр", "2021-04-12"),
    ];

    expect(personIdByChild(children, roster).size).toBe(0);
  });

  /* ESIS sends `2024-07-04T00:00:00.000Z`; the column holds a bare date. */
  it("compares the day, not the timestamp", () => {
    const children = [child("c1", "Дорж", "Намуун", "2024-07-04")];
    const roster: RosterEntry[] = [
      {
        personId: "90003",
        lastName: "Дорж",
        firstName: "Намуун",
        dateOfBirth: "2024-07-04T00:00:00.000Z",
      },
    ];

    expect(personIdByChild(children, roster).get("c1")).toBe("90003");
  });
});

describe("хүүхэд бүрийн хоолны хөнгөлөлт", () => {
  const children = [
    child("c1", "Ганболд", "Батбаяр", "2021-04-12"),
    child("c2", "Дорж", "Намуун", "2022-05-30"),
    child("c3", "Пүрэв", "Тэмүүлэн", "2023-01-09"),
  ];
  const roster = [
    rosterEntry("90001", "Ганболд", "Батбаяр", "2021-04-12"),
    rosterEntry("90002", "Дорж", "Намуун", "2022-05-30"),
    rosterEntry("90003", "Пүрэв", "Тэмүүлэн", "2023-01-09"),
  ];

  /*
   * ★★★ The distinction the whole file exists for.
   *
   * `cook/levelHood/students` returned 65 rows against 83 children, so
   * eighteen were in no row at all. They are not children without a subsidy —
   * they are children the ministry has not ruled on, and pricing them as "no
   * discount" bills a family for something the state may be about to pay.
   */
  it("tells an assessed refusal apart from no assessment at all", () => {
    const rows = foodDiscountByChild(children, roster, [
      discount("90001", "Тийм"),
      discount("90002", "Үгүй"),
      // 90003 is absent from the response entirely.
    ]);

    expect(rows).toEqual([
      { childId: "c1", status: "ELIGIBLE", orderNum: null },
      { childId: "c2", status: "NOT_ELIGIBLE", orderNum: null },
      { childId: "c3", status: "UNASSESSED", orderNum: null },
    ]);
  });

  it("returns every child, including the ones it could not match", () => {
    const rows = foodDiscountByChild(children, [], []);

    expect(rows.map((row) => row.childId)).toEqual(["c1", "c2", "c3"]);
    expect(rows.every((row) => row.status === "UNASSESSED")).toBe(true);
  });

  /* A blank order number is no order number — it must not render as an empty cell. */
  it("keeps a real order number and drops a blank one", () => {
    const rows = foodDiscountByChild(children.slice(0, 2), roster, [
      { personId: "90001", isFoodDiscount: "Тийм", orderNum: "A/218" },
      { personId: "90002", isFoodDiscount: "Тийм", orderNum: "   " },
    ]);

    expect(rows[0]?.orderNum).toBe("A/218");
    expect(rows[1]?.orderNum).toBeNull();
  });

  it("counts the three states for the register", () => {
    const rows = foodDiscountByChild(children, roster, [
      discount("90001", "Тийм"),
      discount("90002", "Үгүй"),
    ]);

    expect(countByStatus(rows)).toEqual({ eligible: 1, notEligible: 1, unassessed: 1 });
  });
});
