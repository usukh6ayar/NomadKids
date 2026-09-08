import { describe, expect, it } from "vitest";
import { referenceBands } from "./growth-reference";

describe("monthly WHO growth reference", () => {
  it("returns one official reference point for every month through age five", () => {
    const reference = referenceBands("MALE");

    expect(reference).not.toBeNull();
    expect(reference!.height).toHaveLength(61);
    expect(reference!.weight).toHaveLength(61);
    expect(reference!.height[1]).toMatchObject({ age: 1 / 12, median: 54.7 });
    expect(reference!.weight[60]).toMatchObject({ age: 5, median: 18.3 });
  });

  it("keeps boys and girls separate and never guesses an unknown sex", () => {
    expect(referenceBands("FEMALE")!.height[60]!.median).toBe(109.4);
    expect(referenceBands(undefined)).toBeNull();
  });
});
