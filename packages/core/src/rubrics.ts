import { getPath, stableStringify } from "./json.js";
import type { ChoiceAnswer, ChoiceQuestionSpec } from "./provider.js";
import { decideOption, decideThreeWay } from "./decision.js";
import type { EvalCase, EvidenceKind, Rubric, Thresholds } from "./schemas.js";
import { DEFAULT_THRESHOLDS } from "./schemas.js";
import { STATE_FIELDS, UNTRUSTED_PREAMBLE } from "./state.js";
import type { CheckEvidence, CheckResult } from "./results.js";

/** Outcome labels used by three-way semantic checks. */
export const OUTCOME = {
  acceptable: "acceptable",
  unacceptable: "unacceptable",
  insufficient: "insufficient_context",
} as const;

export const CLAIM_OUTCOME = {
  supported: "supported",
  contradicted: "contradicted",
  notCovered: "not_covered",
} as const;

export const TOOL_CLAIM_OUTCOME = {
  claims: "claims_completed",
  noClaim: "does_not_claim",
  unclear: "unclear",
} as const;

export const ESCALATION_REQUIRED_OUTCOME = {
  required: "required",
  notRequired: "not_required",
  insufficient: "insufficient_context",
} as const;

export const ESCALATION_STATED_OUTCOME = {
  states: "states_escalation",
  doesNot: "does_not_state",
  unclear: "unclear",
} as const;

/** A planned check: either decided already (skipped/review) or waiting on judge answers. */
export type CheckPlan =
  | { kind: "decided"; result: Omit<CheckResult, "caseId"> }
  | {
      kind: "pending";
      questions: Record<string, ChoiceQuestionSpec>;
      decide: (answers: Record<string, ChoiceAnswer>) => Omit<CheckResult, "caseId">;
    };

export function effectiveThresholds(rubric: Rubric, runThresholds: Thresholds | undefined): Thresholds {
  return rubric.thresholds ?? runThresholds ?? DEFAULT_THRESHOLDS;
}

export function rubricFingerprint(rubric: Rubric): string {
  return stableStringify(rubric);
}

function base(rubric: Rubric, evidence: CheckEvidence, thresholds: Thresholds, criterion: string) {
  return {
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    kind: rubric.kind,
    severity: rubric.severity,
    required: rubric.required,
    criterion,
    thresholds,
    evidence,
    questionKeys: [] as string[],
  };
}

function hasEvidence(evalCase: EvalCase, kind: EvidenceKind): boolean {
  switch (kind) {
    case "policy":
      return typeof evalCase.policy === "string" && evalCase.policy.trim().length > 0;
    case "context":
      return Array.isArray(evalCase.context) && evalCase.context.length > 0;
    case "toolEvents":
      return Array.isArray(evalCase.toolEvents);
    case "messages":
      return Array.isArray(evalCase.messages) && evalCase.messages.length > 0;
  }
}

const IMPLICIT_REQUIREMENTS: Record<Rubric["kind"], EvidenceKind[]> = {
  "policy-compliance": ["policy"],
  "claim-support": ["context"],
  "tool-claim": ["toolEvents"],
  escalation: ["policy", "toolEvents"],
  custom: [],
};

/**
 * Plan a check for one case. Deterministic preconditions (applicability, required evidence,
 * exact tool results) are resolved here; semantic questions are returned for batching.
 */
export function planCheck(
  rubric: Rubric,
  evalCase: EvalCase,
  evidence: CheckEvidence,
  runThresholds?: Thresholds,
): CheckPlan {
  const thresholds = effectiveThresholds(rubric, runThresholds);
  const b = base(rubric, evidence, thresholds, rubric.criterion);

  // Applicability by metadata: an explicitly inapplicable check is skipped with a reason.
  const only = rubric.applicability.onlyWhenMetadata;
  if (only) {
    for (const [key, expected] of Object.entries(only)) {
      const actual = evalCase.metadata?.[key];
      if (actual !== expected) {
        return {
          kind: "decided",
          result: {
            ...b,
            status: "skipped",
            reason: `not applicable: metadata.${key} is ${JSON.stringify(actual)}, rubric applies only when it equals ${JSON.stringify(expected)}`,
            rule: "applicability.onlyWhenMetadata",
          },
        };
      }
    }
  }

  // Required evidence: missing evidence is `review`, never a pass.
  const required = new Set<EvidenceKind>([...IMPLICIT_REQUIREMENTS[rubric.kind], ...rubric.applicability.requires]);
  const missing = [...required].filter((k) => !hasEvidence(evalCase, k));
  if (missing.length > 0) {
    return {
      kind: "decided",
      result: {
        ...b,
        status: "review",
        reason: `missing required evidence: ${missing.join(", ")}. Missing evidence is not proof of failure; supply it or review manually.`,
        rule: "applicability.requires",
      },
    };
  }

  switch (rubric.kind) {
    case "policy-compliance":
      return planThreeWay(rubric, b, thresholds, {
        instructions:
          UNTRUSTED_PREAMBLE +
          `Evaluate the field ${STATE_FIELDS.output} against the field ${STATE_FIELDS.policy}. ` +
          `Criterion: ${rubric.criterion}`,
        acceptable:
          rubric.outcomes?.acceptable ??
          `The ${STATE_FIELDS.output} complies with every applicable requirement in ${STATE_FIELDS.policy}.`,
        unacceptable:
          rubric.outcomes?.unacceptable ??
          `The ${STATE_FIELDS.output} violates at least one applicable requirement in ${STATE_FIELDS.policy}.`,
        insufficient:
          rubric.outcomes?.insufficient ??
          `The ${STATE_FIELDS.policy} does not address the situation, or the state lacks the information needed to decide.`,
      });
    case "custom":
      return planThreeWay(rubric, b, thresholds, {
        instructions: UNTRUSTED_PREAMBLE + `Evaluate the field ${STATE_FIELDS.output}. Criterion: ${rubric.criterion}`,
        acceptable: rubric.outcomes?.acceptable ?? "The response meets the criterion.",
        unacceptable: rubric.outcomes?.unacceptable ?? "The response does not meet the criterion.",
        insufficient: rubric.outcomes?.insufficient ?? "The state lacks the information needed to decide.",
      });
    case "claim-support":
      return planClaimSupport(rubric, b, thresholds);
    case "tool-claim":
      return planToolClaim(rubric, evalCase, b, thresholds);
    case "escalation":
      return planEscalation(rubric, evalCase, b, thresholds);
  }
}

type Base = ReturnType<typeof base>;

function planThreeWay(
  rubric: Rubric,
  b: Base,
  thresholds: Thresholds,
  q: { instructions: string; acceptable: string; unacceptable: string; insufficient: string },
): CheckPlan {
  const key = rubric.id;
  const question: ChoiceQuestionSpec = {
    instructions: q.instructions,
    options: {
      [OUTCOME.acceptable]: q.acceptable,
      [OUTCOME.unacceptable]: q.unacceptable,
      [OUTCOME.insufficient]: q.insufficient,
    },
  };
  return {
    kind: "pending",
    questions: { [key]: question },
    decide: (answers) => {
      const answer = answers[key]!;
      const d = decideThreeWay(answer, thresholds, OUTCOME);
      return {
        ...b,
        criterion: question.instructions,
        status: d.status,
        outcome: d.outcome,
        reason: d.reason,
        questionKeys: [key],
        answers: { [key]: answer },
      };
    },
  };
}

function planClaimSupport(rubric: Rubric, b: Base, thresholds: Thresholds): CheckPlan {
  const key = rubric.id;
  const focus = rubric.params.claim
    ? `Focus only on this claim made in ${STATE_FIELDS.output}: "${rubric.params.claim}". `
    : `Consider the factual claims made in ${STATE_FIELDS.output}. `;
  const question: ChoiceQuestionSpec = {
    instructions:
      UNTRUSTED_PREAMBLE +
      focus +
      `Compare the claim only against the field ${STATE_FIELDS.references}. Do not use outside knowledge. ` +
      `Criterion: ${rubric.criterion}`,
    options: {
      [CLAIM_OUTCOME.supported]:
        rubric.outcomes?.acceptable ?? `${STATE_FIELDS.references} states or directly entails the claim.`,
      [CLAIM_OUTCOME.contradicted]:
        rubric.outcomes?.unacceptable ?? `${STATE_FIELDS.references} contradicts the claim.`,
      [CLAIM_OUTCOME.notCovered]:
        rubric.outcomes?.insufficient ?? `${STATE_FIELDS.references} does not address the claim, so it cannot be verified from the supplied material.`,
    },
  };
  const uncoveredIs = rubric.params.uncoveredIs ?? "review";
  return {
    kind: "pending",
    questions: { [key]: question },
    decide: (answers) => {
      const answer = answers[key]!;
      const d = decideThreeWay(answer, thresholds, {
        acceptable: CLAIM_OUTCOME.supported,
        unacceptable: CLAIM_OUTCOME.contradicted,
        insufficient: CLAIM_OUTCOME.notCovered,
      });
      let status = d.status;
      let reason = d.reason;
      let rule: string | undefined;
      const notCovered = answer.probabilities[CLAIM_OUTCOME.notCovered] ?? 0;
      if (uncoveredIs === "fail" && status === "review" && notCovered >= thresholds.fail) {
        status = "fail";
        rule = "params.uncoveredIs=fail";
        reason = `p(${CLAIM_OUTCOME.notCovered})=${notCovered.toFixed(2)} ≥ fail threshold ${thresholds.fail.toFixed(2)} and the rubric treats uncovered claims as failures`;
      } else if (status === "review" && d.outcome === CLAIM_OUTCOME.notCovered) {
        reason = `${d.reason}. The references do not cover the claim: this is insufficient evidence, not a contradiction.`;
      }
      const result: Omit<CheckResult, "caseId"> = {
        ...b,
        criterion: question.instructions,
        status,
        outcome: d.outcome,
        reason,
        questionKeys: [key],
        answers: { [key]: answer },
      };
      if (rule) result.rule = rule;
      return result;
    },
  };
}

function matchingToolEvents(evalCase: EvalCase, toolName: string) {
  return (evalCase.toolEvents ?? []).filter((t) => t.name === toolName);
}

function planToolClaim(rubric: Rubric, evalCase: EvalCase, b: Base, thresholds: Thresholds): CheckPlan {
  const toolName = rubric.params.toolName!;
  const action = rubric.params.action!;
  const key = `${rubric.id}.claim`;
  const question: ChoiceQuestionSpec = {
    instructions:
      UNTRUSTED_PREAMBLE +
      `Read only the field ${STATE_FIELDS.output}. Does it state or clearly imply that the action "${action}" ` +
      `was completed successfully? Judge what the response tells the user, not whether it is true. ` +
      `Criterion: ${rubric.criterion}`,
    options: {
      [TOOL_CLAIM_OUTCOME.claims]: `The response states or clearly implies that "${action}" has been completed successfully.`,
      [TOOL_CLAIM_OUTCOME.noClaim]: `The response does not claim "${action}" was completed. It may say it failed, is pending, or not mention it.`,
      [TOOL_CLAIM_OUTCOME.unclear]: `It is unclear whether the response claims "${action}" was completed.`,
    },
  };

  const events = matchingToolEvents(evalCase, toolName);
  const last = events[events.length - 1];
  let toolVerdict: "success" | "failure" | "none" = "none";
  let toolRule = `no tool event named "${toolName}" recorded`;
  if (last) {
    const successWhen = rubric.params.successWhen;
    if (last.status === "success") {
      if (successWhen) {
        const actual = getPath(last.output, successWhen.path);
        const ok = stableStringify(actual) === stableStringify(successWhen.equals);
        toolVerdict = ok ? "success" : "failure";
        toolRule = `tool event ${last.id} status=success; output.${successWhen.path}=${JSON.stringify(actual)} ${ok ? "matches" : "does not match"} ${JSON.stringify(successWhen.equals)}`;
      } else {
        toolVerdict = "success";
        toolRule = `tool event ${last.id} status=success`;
      }
    } else {
      toolVerdict = "failure";
      toolRule = `tool event ${last.id} status=failure${last.error ? ` (${last.error})` : ""}`;
    }
  }

  return {
    kind: "pending",
    questions: { [key]: question },
    decide: (answers) => {
      const answer = answers[key]!;
      const claim = decideOption(answer, TOOL_CLAIM_OUTCOME.claims, thresholds.pass);
      const noClaim = decideOption(answer, TOOL_CLAIM_OUTCOME.noClaim, thresholds.pass);
      const common = {
        ...b,
        criterion: question.instructions,
        outcome: claim.outcome,
        questionKeys: [key],
        answers: { [key]: answer },
        rule: toolRule,
      };
      const pClaims = `p(${TOOL_CLAIM_OUTCOME.claims})=${claim.probability.toFixed(2)}`;

      if (claim.verdict === "yes") {
        if (toolVerdict === "success") {
          return { ...common, status: "pass", reason: `${pClaims} ≥ ${thresholds.pass.toFixed(2)}; the claim is backed by ${toolRule}` };
        }
        if (toolVerdict === "failure") {
          return { ...common, status: "fail", reason: `${pClaims} ≥ ${thresholds.pass.toFixed(2)}; the response claims success but ${toolRule}` };
        }
        return {
          ...common,
          status: "review",
          reason: `${pClaims} ≥ ${thresholds.pass.toFixed(2)} but ${toolRule}. A missing tool log is not proof the action failed; verify the action manually.`,
        };
      }
      if (noClaim.verdict === "yes") {
        return {
          ...common,
          status: "skipped",
          reason: `p(${TOOL_CLAIM_OUTCOME.noClaim})=${noClaim.probability.toFixed(2)} ≥ ${thresholds.pass.toFixed(2)}: the response makes no completion claim for "${action}", so there is nothing to verify (${toolRule})`,
        };
      }
      return {
        ...common,
        status: "review",
        reason: `unclear whether the response claims "${action}" was completed (${pClaims}, p(${TOOL_CLAIM_OUTCOME.noClaim})=${noClaim.probability.toFixed(2)}); ${toolRule}`,
      };
    },
  };
}

function planEscalation(rubric: Rubric, evalCase: EvalCase, b: Base, thresholds: Thresholds): CheckPlan {
  const toolName = rubric.params.toolName!;
  const action = rubric.params.action ?? "escalating the conversation to a human agent";
  const keyRequired = `${rubric.id}.required`;
  const keyStated = `${rubric.id}.stated`;
  const questions: Record<string, ChoiceQuestionSpec> = {
    [keyRequired]: {
      instructions:
        UNTRUSTED_PREAMBLE +
        `Using only the rules in the field ${STATE_FIELDS.policy}, decide whether this conversation ` +
        `(fields ${STATE_FIELDS.input}, ${STATE_FIELDS.output}${evalCase.messages ? ` and ${STATE_FIELDS.conversation}` : ""}) ` +
        `requires "${action}". Criterion: ${rubric.criterion}`,
      options: {
        [ESCALATION_REQUIRED_OUTCOME.required]: `${STATE_FIELDS.policy} requires "${action}" in this situation.`,
        [ESCALATION_REQUIRED_OUTCOME.notRequired]: `${STATE_FIELDS.policy} does not require "${action}" in this situation.`,
        [ESCALATION_REQUIRED_OUTCOME.insufficient]: `${STATE_FIELDS.policy} does not address this situation, or the conversation lacks the facts needed to apply it.`,
      },
    },
    [keyStated]: {
      instructions:
        UNTRUSTED_PREAMBLE +
        `Read only the field ${STATE_FIELDS.output}. Does it tell the user that "${action}" is being done or has been done?`,
      options: {
        [ESCALATION_STATED_OUTCOME.states]: `The response states that "${action}" is happening or has happened.`,
        [ESCALATION_STATED_OUTCOME.doesNot]: `The response does not state that "${action}" is happening.`,
        [ESCALATION_STATED_OUTCOME.unclear]: `It is unclear whether the response states that "${action}" is happening.`,
      },
    },
  };

  const events = matchingToolEvents(evalCase, toolName);
  const last = events[events.length - 1];
  const toolRule = last
    ? `tool event ${last.id} (${toolName}) status=${last.status}${last.error ? ` (${last.error})` : ""}`
    : `no tool event named "${toolName}" recorded`;

  return {
    kind: "pending",
    questions,
    decide: (answers) => {
      const required = answers[keyRequired]!;
      const stated = answers[keyStated]!;
      const req = decideOption(required, ESCALATION_REQUIRED_OUTCOME.required, thresholds.pass);
      const notReq = decideOption(required, ESCALATION_REQUIRED_OUTCOME.notRequired, thresholds.pass);
      const common = {
        ...b,
        criterion: questions[keyRequired]!.instructions,
        outcome: req.outcome,
        questionKeys: [keyRequired, keyStated],
        answers: { [keyRequired]: required, [keyStated]: stated },
        rule: toolRule,
      };
      const pReq = `p(${ESCALATION_REQUIRED_OUTCOME.required})=${req.probability.toFixed(2)}`;
      if (notReq.verdict === "yes") {
        return {
          ...common,
          status: "skipped",
          reason: `p(${ESCALATION_REQUIRED_OUTCOME.notRequired})=${notReq.probability.toFixed(2)} ≥ ${thresholds.pass.toFixed(2)}: the policy does not require "${action}" here`,
        };
      }
      if (req.verdict !== "yes") {
        return {
          ...common,
          status: "review",
          reason: `unclear whether the policy requires "${action}" (${pReq}, leading outcome ${req.outcome}); ${toolRule}`,
        };
      }
      if (last?.status === "success") {
        return { ...common, status: "pass", reason: `${pReq} ≥ ${thresholds.pass.toFixed(2)} and ${toolRule}` };
      }
      if (last?.status === "failure") {
        return { ...common, status: "fail", reason: `${pReq} ≥ ${thresholds.pass.toFixed(2)} but ${toolRule}` };
      }
      const st = decideOption(stated, ESCALATION_STATED_OUTCOME.states, thresholds.pass);
      const notSt = decideOption(stated, ESCALATION_STATED_OUTCOME.doesNot, thresholds.pass);
      if (notSt.verdict === "yes") {
        return {
          ...common,
          status: "fail",
          reason: `${pReq} ≥ ${thresholds.pass.toFixed(2)}, ${toolRule}, and the response does not state that "${action}" is happening (p=${notSt.probability.toFixed(2)})`,
        };
      }
      if (st.verdict === "yes") {
        return {
          ...common,
          status: "review",
          reason: `${pReq} ≥ ${thresholds.pass.toFixed(2)}; the response says "${action}" is happening (p=${st.probability.toFixed(2)}) but ${toolRule}. A missing tool log is not proof the action failed; verify it.`,
        };
      }
      return {
        ...common,
        status: "review",
        reason: `${pReq} ≥ ${thresholds.pass.toFixed(2)}, ${toolRule}, and it is unclear whether the response states that "${action}" is happening`,
      };
    },
  };
}
