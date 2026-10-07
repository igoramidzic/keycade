import { describe, expect, it } from "vitest";
import { normalizeMoney } from "./money.js";

describe("exact USD decimal strings", () => {
  it.each([
    ["10000", "10000.00"],
    ["0.01", "0.01"],
    ["5000000.1", "5000000.10"],
    ["7500000.00", "7500000.00"],
    ["999999999999999999.99", "999999999999999999.99"],
  ])("normalizes %s without floating point", (input, expected) => {
    expect(normalizeMoney(input)).toBe(expected);
  });
  it.each([
    0,
    1.1,
    "",
    "0",
    "0.00",
    "-1.00",
    "NaN",
    "Infinity",
    "01.00",
    "1e5",
    "1.001",
    " 1.00",
    "1000000000000000000.00",
  ])("rejects invalid amount %s", (input) => {
    expect(() => normalizeMoney(input)).toThrow();
  });
});
