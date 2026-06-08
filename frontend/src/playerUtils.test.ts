import { describe, expect, it } from "vitest";

import { formatTime } from "./playerUtils";

describe("formatTime", () => {
  it("formats zero as 0:00", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("pads single-digit seconds", () => {
    expect(formatTime(9)).toBe("0:09");
  });

  it("formats seconds under a minute", () => {
    expect(formatTime(59)).toBe("0:59");
  });

  it("formats whole minutes", () => {
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(90)).toBe("1:30");
  });

  it("formats up to 59:59 without an hours segment", () => {
    expect(formatTime(3599)).toBe("59:59");
  });

  it("includes an hours segment from 1 h onward", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3661)).toBe("1:01:01");
    expect(formatTime(7322)).toBe("2:02:02");
  });

  it("floors fractional seconds", () => {
    expect(formatTime(90.9)).toBe("1:30");
    expect(formatTime(3599.99)).toBe("59:59");
  });

  it("returns 0:00 for negative input", () => {
    expect(formatTime(-1)).toBe("0:00");
  });

  it("returns 0:00 for non-finite input", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-Infinity)).toBe("0:00");
  });
});
