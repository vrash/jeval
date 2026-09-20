import { describe, expect, it } from "vitest";
import { decideThreeWay, decideOption } from "../decision.js";
import { OUTCOME } from "../rubrics.js";
import { ThresholdsSchema } from "../schemas.js";
import { answer } from "./helpers.js";

const T = { pass: 0.75, fail: 0.5 };

describe("decideThreeWay", () => {
  it("fails when p(unacceptable) reaches the fail threshold exactly", () => {
    const d = decideThreeWay(answer({ acceptable: 0.5, unacceptable: 0.5, insufficient_context: 0 }), T, OUTCOME);
    expect(d.status).toBe("fail");
  });
  it("passes when p(acceptable) reaches the pass threshold exactly", () => {
    const d = decideThreeWay(answer({ acceptable: 0.75, unacceptable: 0.1, insufficient_context: 0.15 }), T, OUTCOME);
    expect(d.status).toBe("pass");
    expect(d.reason).toContain("≥ pass threshold");
  });
  it("reviews just below the pass threshold", () => {
    const d = decideThreeWay(answer({ acceptable: 0.7499, unacceptable: 0.1, insufficient_context: 0.1501 }), T, OUTCOME);
    expect(d.status).toBe("review");
  });
  it("reviews when the insufficient outcome leads", () => {
    const d = decideThreeWay(answer({ acceptable: 0.2, unacceptable: 0.2, insufficient_context: 0.6 }), T, OUTCOME);
    expect(d.status).toBe("review");
    expect(d.outcome).toBe("insufficient_context");
    expect(d.reason).toContain("insufficient-context outcome leads");
  });
  it("fail takes precedence when both are ambiguous but unacceptable meets its bar", () => {
    const d = decideThreeWay(answer({ acceptable: 0.45, unacceptable: 0.55, insufficient_context: 0 }), T, OUTCOME);
    expect(d.status).toBe("fail");
  });
  it("rejects overlapping thresholds where pass and fail could both fire", () => {
    expect(() => decideThreeWay(answer({ acceptable: 0.5, unacceptable: 0.5, insufficient_context: 0 }), { pass: 0.5, fail: 0.5 }, OUTCOME)).toThrow(/exceed 1/);
    expect(ThresholdsSchema.safeParse({ pass: 0.6, fail: 0.4 }).success).toBe(false);
    expect(ThresholdsSchema.safeParse({ pass: 0.6, fail: 0.41 }).success).toBe(true);
  });
  it("treats a missing option probability as zero", () => {
    const d = decideThreeWay(answer({ acceptable: 1 }), T, OUTCOME);
    expect(d.status).toBe("pass");
  });
});

describe("decideOption", () => {
  it("returns yes / no / unclear", () => {
    expect(decideOption(answer({ a: 0.8, b: 0.2 }), "a", 0.75).verdict).toBe("yes");
    expect(decideOption(answer({ a: 0.2, b: 0.8 }), "a", 0.75).verdict).toBe("no");
    expect(decideOption(answer({ a: 0.5, b: 0.5 }), "a", 0.75).verdict).toBe("unclear");
  });
});
