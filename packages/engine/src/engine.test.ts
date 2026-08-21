import { describe, it, expect } from "vitest";
import { DEFAULT_CONSTANTS } from "./index";

describe("engine — scaffold", () => {
  it("exposes the launch constants", () => {
    expect(DEFAULT_CONSTANTS.SLOTS).toBe(10);
    expect(DEFAULT_CONSTANTS.RENT_FLOOR_CENTS).toBe(300);
  });
});
