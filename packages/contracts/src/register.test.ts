import { describe, expect, it } from "vitest";
import { factsFromRegister } from "./register";

describe("factsFromRegister", () => {
  it("reads a birth from 2000 on — the month raised by 20 — and the sex digit", () => {
    expect(factsFromRegister("УП21241512")).toEqual({ dateOfBirth: "2021-04-15", sex: "MALE" });
    expect(factsFromRegister("ук20310324")).toEqual({ dateOfBirth: "2020-11-03", sex: "FEMALE" });
  });

  it("reads a birth before 2000", () => {
    expect(factsFromRegister("УБ95051234")).toEqual({ dateOfBirth: "1995-05-12", sex: "MALE" });
  });

  it("refuses what is not a register or not a real day", () => {
    expect(factsFromRegister("УБ1234567")).toBeNull();
    expect(factsFromRegister("AB21241512")).toBeNull();
    expect(factsFromRegister("УП21223012")).toBeNull(); // 30 February
  });
});
