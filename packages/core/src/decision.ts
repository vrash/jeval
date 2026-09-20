import type { ChoiceAnswer } from "./provider.js";
import { ThresholdsSchema, type CheckStatus, type Thresholds } from "./schemas.js";

export interface OutcomeKeys {
  acceptable: string;
  unacceptable: string;
  insufficient: string;
}

export interface Decision {
  status: Extract<CheckStatus, "pass" | "fail" | "review">;
  /** The option with the highest probability. */
  outcome: string;
  /** Plain description of the rule that produced the status. */
  reason: string;
}

export function assertValidThresholds(thresholds: Thresholds): Thresholds {
  return ThresholdsSchema.parse(thresholds);
}

function pct(n: number): string {
  return n.toFixed(2);
}

/**
 * Map a three-outcome distribution to pass/fail/review.
 *
 * - fail   when p(unacceptable) >= thresholds.fail
 * - pass   when p(acceptable)   >= thresholds.pass
 * - review otherwise, including when the insufficient-context outcome leads.
 *
 * `thresholds.pass + thresholds.fail > 1` is enforced so both rules can never fire together.
 */
export function decideThreeWay(answer: ChoiceAnswer, thresholds: Thresholds, keys: OutcomeKeys): Decision {
  assertValidThresholds(thresholds);
  const p = answer.probabilities;
  const acceptable = p[keys.acceptable] ?? 0;
  const unacceptable = p[keys.unacceptable] ?? 0;
  const insufficient = p[keys.insufficient] ?? 0;
  const outcome = argmax(p);

  if (unacceptable >= thresholds.fail) {
    return {
      status: "fail",
      outcome,
      reason: `p(${keys.unacceptable})=${pct(unacceptable)} ≥ fail threshold ${pct(thresholds.fail)}`,
    };
  }
  if (acceptable >= thresholds.pass) {
    return {
      status: "pass",
      outcome,
      reason: `p(${keys.acceptable})=${pct(acceptable)} ≥ pass threshold ${pct(thresholds.pass)}`,
    };
  }
  const lead =
    outcome === keys.insufficient
      ? `insufficient-context outcome leads with p=${pct(insufficient)}`
      : `no outcome reached its threshold`;
  return {
    status: "review",
    outcome,
    reason: `${lead}; p(${keys.acceptable})=${pct(acceptable)} < ${pct(thresholds.pass)} and p(${keys.unacceptable})=${pct(unacceptable)} < ${pct(thresholds.fail)}`,
  };
}

/**
 * Decide whether a single option is established: returns `yes` when the option's
 * probability reaches `threshold`, `no` when a different option reaches it, and
 * `unclear` otherwise.
 */
export function decideOption(
  answer: ChoiceAnswer,
  option: string,
  threshold: number,
): { verdict: "yes" | "no" | "unclear"; outcome: string; probability: number } {
  const p = answer.probabilities;
  const outcome = argmax(p);
  const probability = p[option] ?? 0;
  if (probability >= threshold) return { verdict: "yes", outcome, probability };
  if ((p[outcome] ?? 0) >= threshold && outcome !== option) return { verdict: "no", outcome, probability };
  return { verdict: "unclear", outcome, probability };
}

export function argmax(probabilities: Record<string, number>): string {
  let best = "";
  let bestValue = -1;
  for (const [label, value] of Object.entries(probabilities)) {
    if (value > bestValue) {
      best = label;
      bestValue = value;
    }
  }
  return best;
}
