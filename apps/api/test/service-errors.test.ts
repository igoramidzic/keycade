import { describe, expect, it } from "vitest";
import { isServiceUnavailable } from "../src/service-errors.js";

describe("service availability errors", () => {
  it.each([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EPIPE",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
    "08000",
    "08001",
    "08003",
    "08006",
    "57P01",
    "57P02",
    "57P03",
    "53300",
  ])("recognizes the structured availability code %s through driver wrappers", (code) => {
    const driver = Object.assign(new Error("confidential driver details"), { code });
    const attempts = new AggregateError([driver], "confidential addresses");
    const query = new Error("confidential query and parameters", { cause: attempts });
    expect(isServiceUnavailable(query)).toBe(true);
  });

  it.each([
    undefined,
    null,
    "ECONNREFUSED",
    new Error("ECONNREFUSED"),
    { code: "23505" }, // A constraint failure is not an availability failure.
    { code: "42P01" }, // Missing schema requires a fix, not a retry.
    { code: "28P01" }, // Bad configuration must not be disguised as transient.
    { code: "08P01" }, // A protocol violation is not necessarily transient.
    { code: 503 },
    new Error("wrapper", { cause: { code: "UNKNOWN" } }),
    new AggregateError([new Error("unexpected application failure")]),
  ])("does not classify unknown errors or error-message text as unavailable", (error) => {
    expect(isServiceUnavailable(error)).toBe(false);
  });

  it("terminates on cyclic causes and still examines other connection attempts", () => {
    const cycle = new Error("cycle");
    cycle.cause = cycle;
    expect(isServiceUnavailable(cycle)).toBe(false);
    const attempts = new AggregateError([Object.assign(new Error(), { code: "ECONNREFUSED" })]);
    attempts.errors.push(attempts, cycle);
    expect(isServiceUnavailable(attempts)).toBe(true);
  });
});
