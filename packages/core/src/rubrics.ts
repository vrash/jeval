import { getPath, stableStringify } from "./json.js";
import type { ChoiceAnswer, ChoiceQuestionSpec } from "./provider.js";
import { decideOption, decideThreeWay } from "./decision.js";
import type { EvalCase, EvidenceKind, Rubric, Thresholds } from "./schemas.js";
import { DEFAULT_THRESHOLDS } from "./schemas.js";
import { STATE_FIELDS, UNTRUSTED_PREAMBLE } from "./state.js";
import type { CheckEvidence, CheckPart, CheckResult } from "./results.js";
import { splitSentences } from "./sentences.js";
import { groundValues } from "./values.js";

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
  "grounded-values": [],
};

/** Average two answers to the same question. */
function meanAnswer(a: ChoiceAnswer, b: ChoiceAnswer): ChoiceAnswer {
  const probabilities: Record<string, number> = {};
  for (const k of Object.keys(a.probabilities)) probabilities[k] = ((a.probabilities[k] ?? 0) + (b.probabilities[k] ?? 0)) / 2;
  const choice = Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0]![0];
  return { choice, confidence: (a.confidence + b.confidence) / 2, probabilities };
}

/**
 * Second-reader support: returns the question set (one or two phrasings) and a combiner that yields
 * the answer to decide on plus whether the readers' own decisions disagreed.
 */
function readersFor(
  rubric: Rubric,
  key: string,
  primary: ChoiceQuestionSpec,
  altInstructions: string,
  decideOne: (a: ChoiceAnswer) => "pass" | "fail" | "review",
): { questions: Record<string, ChoiceQuestionSpec>; combine: (answers: Record<string, ChoiceAnswer>) => { answer: ChoiceAnswer; kept: Record<string, ChoiceAnswer>; disagreement: string | null } } {
  if (rubric.params.readers !== 2) {
    return { questions: { [key]: primary }, combine: (answers) => ({ answer: answers[key]!, kept: { [key]: answers[key]! }, disagreement: null }) };
  }
  const key2 = `${key}.r2`;
  const questions = { [key]: primary, [key2]: { instructions: altInstructions, options: primary.options } };
  return {
    questions,
    combine: (answers) => {
      const a = answers[key]!;
      const b = answers[key2]!;
      const da = decideOne(a);
      const db = decideOne(b);
      const disagreement = (da === "pass" && db === "fail") || (da === "fail" && db === "pass") ? `readers disagree (reader 1: ${da} on ${a.choice}, reader 2: ${db} on ${b.choice})` : null;
      return { answer: meanAnswer(a, b), kept: { [key]: a, [key2]: b }, disagreement };
    },
  };
}

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
      return planClaimSupport(rubric, b, thresholds, evalCase.output);
    case "grounded-values":
      return planGroundedValues(rubric, evalCase, b);
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
  const alt =
    UNTRUSTED_PREAMBLE +
    `Independent second reading. Start from the assumption that the ${STATE_FIELDS.output} is ${OUTCOME.unacceptable} and look for what would make it ${OUTCOME.acceptable} instead; choose ${OUTCOME.insufficient} only if the state truly lacks what is needed to decide. ` +
    `Criterion: ${rubric.criterion}`;
  const readers = readersFor(rubric, key, question, alt, (a) => decideThreeWay(a, thresholds, OUTCOME).status);
  return {
    kind: "pending",
    questions: readers.questions,
    decide: (answers) => {
      const { answer, kept, disagreement } = readers.combine(answers);
      const d = decideThreeWay(answer, thresholds, OUTCOME);
      const status = disagreement ? "review" : d.status;
      const result: Omit<CheckResult, "caseId"> = {
        ...b,
        criterion: question.instructions,
        status,
        outcome: d.outcome,
        reason: disagreement ? `${disagreement}; averaged ${d.reason}` : d.reason,
        questionKeys: Object.keys(readers.questions),
        answers: kept,
        scores: { acceptable: answer.probabilities[OUTCOME.acceptable] ?? 0, unacceptable: answer.probabilities[OUTCOME.unacceptable] ?? 0 },
      };
      if (disagreement) result.rule = "params.readers=2: disagreement forces review";
      return result;
    },
  };
}

/**
 * Default outcome descriptions. The paraphrase-tolerant wording was validated on RAGTruth
 * (examples/public-benchmarks/TUNING-DECISION.md): +18 points sentence-level precision with recall held.
 */
const CLAIM_OPTIONS = (rubric: Rubric): Record<string, string> => ({
  [CLAIM_OUTCOME.supported]:
    rubric.outcomes?.acceptable ??
    `${STATE_FIELDS.references} states the claim, directly entails it, or the claim is a reasonable paraphrase or summary of it. General, evaluative or connective wording that adds no specific fact (names, numbers, dates, places, causes) counts as supported.`,
  [CLAIM_OUTCOME.contradicted]:
    rubric.outcomes?.unacceptable ?? `${STATE_FIELDS.references} contains a passage that says otherwise: a different number, date, name, place, cause or outcome.`,
  [CLAIM_OUTCOME.notCovered]:
    rubric.outcomes?.insufficient ??
    `The claim adds a specific fact (a name, number, date, place, cause or claim) that no passage in ${STATE_FIELDS.references} contains or entails.`,
});

/** Decide one claim-support answer, honouring `params.uncoveredIs`. */
function decideClaim(answer: ChoiceAnswer, thresholds: Thresholds, uncoveredIs: "review" | "fail") {
  const d = decideThreeWay(answer, thresholds, {
    acceptable: CLAIM_OUTCOME.supported,
    unacceptable: CLAIM_OUTCOME.contradicted,
    insufficient: CLAIM_OUTCOME.notCovered,
  });
  const notCovered = answer.probabilities[CLAIM_OUTCOME.notCovered] ?? 0;
  const contradicted = answer.probabilities[CLAIM_OUTCOME.contradicted] ?? 0;
  let status = d.status;
  let reason = d.reason;
  let rule: string | undefined;
  if (uncoveredIs === "fail" && status === "review" && notCovered >= thresholds.fail) {
    status = "fail";
    rule = "params.uncoveredIs=fail";
    reason = `p(${CLAIM_OUTCOME.notCovered})=${notCovered.toFixed(2)} ≥ fail threshold ${thresholds.fail.toFixed(2)} and the rubric treats uncovered claims as failures`;
  } else if (status === "review" && d.outcome === CLAIM_OUTCOME.notCovered) {
    reason = `${d.reason}. The references do not cover the claim: this is insufficient evidence, not a contradiction.`;
  }
  const scores = {
    acceptable: answer.probabilities[CLAIM_OUTCOME.supported] ?? 0,
    unacceptable: uncoveredIs === "fail" ? contradicted + notCovered : contradicted,
  };
  return { status, outcome: d.outcome, reason, rule, scores };
}

function planClaimSupport(rubric: Rubric, b: Base, thresholds: Thresholds, output: string): CheckPlan {
  const uncoveredIs = rubric.params.uncoveredIs ?? "review";
  const preamble =
    UNTRUSTED_PREAMBLE + `Compare only against the field ${STATE_FIELDS.references}. Do not use outside knowledge. Criterion: ${rubric.criterion} `;

  if (rubric.params.granularity === "sentence") {
    const sentences = splitSentences(output, rubric.params.maxSentences !== undefined ? { maxSentences: rubric.params.maxSentences } : {});
    if (sentences.length === 0) {
      return { kind: "decided", result: { ...b, status: "skipped", reason: "the response contains no sentences to check", rule: "params.granularity=sentence" } };
    }
    const questions: Record<string, ChoiceQuestionSpec> = {};
    const readerSets = new Map<string, ReturnType<typeof readersFor>>();
    for (const sn of sentences) {
      const key = `${rubric.id}.${sn.id}`;
      const primary: ChoiceQuestionSpec = {
        instructions: preamble + `Consider only this sentence from ${STATE_FIELDS.output}: "${sn.text}"`,
        options: CLAIM_OPTIONS(rubric),
      };
      const alt =
        UNTRUSTED_PREAMBLE +
        `Independent second reading. Treat this sentence as a claim: "${sn.text}". Search ${STATE_FIELDS.references} for a passage that establishes it. ` +
        `If a passage establishes it choose ${CLAIM_OUTCOME.supported}; if a passage says otherwise choose ${CLAIM_OUTCOME.contradicted}; if no passage addresses it choose ${CLAIM_OUTCOME.notCovered}. ` +
        `Criterion: ${rubric.criterion}`;
      const r = readersFor(rubric, key, primary, alt, (a) => decideClaim(a, thresholds, uncoveredIs).status);
      readerSets.set(key, r);
      Object.assign(questions, r.questions);
    }
    return {
      kind: "pending",
      questions,
      decide: (answers) => {
        const parts: CheckPart[] = [];
        const kept: Record<string, ChoiceAnswer> = {};
        let minAcceptable = 1;
        let maxUnacceptable = 0;
        let disagreements = 0;
        for (const sn of sentences) {
          const key = `${rubric.id}.${sn.id}`;
          const combined = readerSets.get(key)!.combine(answers);
          Object.assign(kept, combined.kept);
          const answer = combined.answer;
          const d = decideClaim(answer, thresholds, uncoveredIs);
          if (combined.disagreement) {
            d.status = "review";
            d.reason = `${combined.disagreement}; averaged ${d.reason}`;
            disagreements += 1;
          }
          minAcceptable = Math.min(minAcceptable, d.scores.acceptable);
          maxUnacceptable = Math.max(maxUnacceptable, d.scores.unacceptable);
          parts.push({ id: sn.id, text: sn.text, start: sn.start, end: sn.end, status: d.status, outcome: d.outcome, reason: d.reason, questionKey: key, scores: d.scores });
        }
        const failed = parts.filter((p) => p.status === "fail");
        const reviews = parts.filter((p) => p.status === "review");
        const status = failed.length > 0 ? "fail" : reviews.length > 0 ? "review" : "pass";
        const list = (ps: CheckPart[]) => ps.map((p) => p.id).join(", ");
        const reason =
          status === "fail"
            ? `${failed.length} of ${parts.length} sentence(s) unsupported (${list(failed)})${reviews.length ? `; ${reviews.length} undecided (${list(reviews)})` : ""}`
            : status === "review"
              ? `${reviews.length} of ${parts.length} sentence(s) could not be decided (${list(reviews)}); none failed`
              : `all ${parts.length} sentence(s) supported by the references`;
        const worst = failed[0] ?? reviews[0] ?? parts[0]!;
        return {
          ...b,
          criterion: preamble.trim(),
          status,
          outcome: worst.outcome,
          reason: disagreements ? `${reason}; ${disagreements} sentence(s) had reader disagreement` : reason,
          rule: `params.granularity=sentence: fail if any sentence fails, review if any is undecided${rubric.params.readers === 2 ? "; params.readers=2: disagreement forces review" : ""}`,
          questionKeys: Object.keys(questions),
          answers: kept,
          scores: { acceptable: minAcceptable, unacceptable: maxUnacceptable },
          parts,
        };
      },
    };
  }

  const key = rubric.id;
  const focus = rubric.params.claim
    ? `Focus only on this claim made in ${STATE_FIELDS.output}: "${rubric.params.claim}". `
    : `Consider the factual claims made in ${STATE_FIELDS.output}. `;
  const question: ChoiceQuestionSpec = { instructions: preamble + focus, options: CLAIM_OPTIONS(rubric) };
  const alt =
    UNTRUSTED_PREAMBLE +
    `Independent second reading. List the factual claims in ${STATE_FIELDS.output} and search ${STATE_FIELDS.references} for a passage that establishes each. ` +
    `Choose ${CLAIM_OUTCOME.supported} only if every claim is established; ${CLAIM_OUTCOME.contradicted} if any passage says otherwise; ${CLAIM_OUTCOME.notCovered} if a claim is addressed by no passage. Criterion: ${rubric.criterion}`;
  const readers = readersFor(rubric, key, question, alt, (a) => decideClaim(a, thresholds, uncoveredIs).status);
  return {
    kind: "pending",
    questions: readers.questions,
    decide: (answers) => {
      const { answer, kept, disagreement } = readers.combine(answers);
      const d = decideClaim(answer, thresholds, uncoveredIs);
      const result: Omit<CheckResult, "caseId"> = {
        ...b,
        criterion: question.instructions,
        status: disagreement ? "review" : d.status,
        outcome: d.outcome,
        reason: disagreement ? `${disagreement}; averaged ${d.reason}` : d.reason,
        questionKeys: Object.keys(readers.questions),
        answers: kept,
        scores: d.scores,
      };
      if (disagreement) result.rule = "params.readers=2: disagreement forces review";
      else if (d.rule) result.rule = d.rule;
      return result;
    },
  };
}

const GROUND_FIELD_NAMES = { context: STATE_FIELDS.references, toolEvents: STATE_FIELDS.toolEvents, input: STATE_FIELDS.input, policy: STATE_FIELDS.policy, messages: STATE_FIELDS.conversation } as const;

/** Deterministic: every number, date, time, amount or duration in the output must appear in the sources. */
function planGroundedValues(rubric: Rubric, evalCase: EvalCase, b: Base): CheckPlan {
  const groundIn = rubric.params.groundIn ?? ["context", "toolEvents", "input", "policy"];
  const kinds = new Set(rubric.params.valueKinds ?? ["money", "percent", "date", "time", "duration"]);
  const sources: string[] = [];
  for (const field of groundIn) {
    if (field === "context") for (const c of evalCase.context ?? []) sources.push(c.content, c.title ?? "");
    if (field === "toolEvents") for (const t of evalCase.toolEvents ?? []) sources.push(JSON.stringify(t.input ?? null), JSON.stringify(t.output ?? null), t.error ?? "");
    if (field === "input") sources.push(evalCase.input);
    if (field === "policy") sources.push(evalCase.policy ?? "");
    if (field === "messages") for (const m of evalCase.messages ?? []) if (m.role !== "assistant") sources.push(m.content);
  }
  const results = groundValues(evalCase.output, sources).filter((r) => kinds.has(r.value.kind));
  const fields = groundIn.map((f) => GROUND_FIELD_NAMES[f]).join(", ");
  if (results.length === 0) {
    return { kind: "decided", result: { ...b, status: "skipped", reason: "the response contains no numbers, dates, times, amounts or durations to ground", rule: "grounded-values (deterministic)" } };
  }
  const parts: CheckPart[] = results.map((r) => ({
    id: r.value.id,
    text: r.value.text,
    start: r.value.start,
    end: r.value.end,
    status: r.grounded ? "pass" : "fail",
    outcome: r.grounded ? "grounded" : "ungrounded",
    reason: r.grounded ? `${r.value.kind} matches a value in ${fields} (${r.matched})` : `${r.value.kind} "${r.value.text}" does not appear in ${fields}`,
    questionKey: "",
  }));
  const failed = parts.filter((p) => p.status === "fail");
  return {
    kind: "decided",
    result: {
      ...b,
      status: failed.length ? "fail" : "pass",
      outcome: failed.length ? "ungrounded" : "grounded",
      reason: failed.length
        ? `${failed.length} of ${parts.length} value(s) not found in the sources: ${failed.map((p) => `${p.id} "${p.text}"`).join(", ")}`
        : `all ${parts.length} value(s) appear in the sources`,
      rule: `grounded-values (deterministic, no judge): values are matched by canonical form against ${fields}`,
      parts,
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
