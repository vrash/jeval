import { estimateCost, type PricingConfig } from "./evaluate.js";
import { planCheck } from "./rubrics.js";
import type { CostEstimate } from "./results.js";
import type { EvalCase, Rubric, Thresholds } from "./schemas.js";
import { DEFAULT_THRESHOLDS, EvalCaseSchema } from "./schemas.js";
import { buildJudgeState } from "./state.js";
import type { DigestOptions } from "./digest.js";

export interface EstimateOptions {
  thresholds?: Thresholds;
  pricing?: PricingConfig;
  digest?: DigestOptions | false;
  /** Characters per token used for the heuristic. Default 4. */
  charsPerToken?: number;
}

export interface CaseEstimate {
  caseId: string;
  /** Number of questions that would be sent (0 means no request is needed). */
  questions: number;
  stateChars: number;
  questionChars: number;
  estimatedInputTokens: number;
  digested: boolean;
}

export interface RunEstimate {
  /** Heuristic: characters ÷ charsPerToken. Not a tokenizer; verify against measured usage from a small live run. */
  method: string;
  charsPerToken: number;
  caseCount: number;
  requests: number;
  casesWithoutRequest: number;
  estimatedInputTokens: number;
  /** Null when no pricing is configured: unknown, not zero. */
  cost: CostEstimate | null;
  cases: CaseEstimate[];
}

/**
 * Estimate the input volume of a run before sending anything. Builds the same state and
 * questions the run would send and sizes them with a character heuristic.
 */
export function estimateRun(cases: readonly EvalCase[], rubrics: readonly Rubric[], options: EstimateOptions = {}): RunEstimate {
  const charsPerToken = options.charsPerToken ?? 4;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const perCase: CaseEstimate[] = [];
  let requests = 0;
  let totalTokens = 0;
  for (const raw of cases) {
    const evalCase = EvalCaseSchema.parse(raw);
    const { state, evidence } = buildJudgeState(evalCase, options.digest === undefined ? {} : { digest: options.digest });
    let questionChars = 0;
    let questions = 0;
    for (const rubric of rubrics) {
      const plan = planCheck(rubric, evalCase, evidence, thresholds);
      if (plan.kind === "pending") {
        questions += Object.keys(plan.questions).length;
        questionChars += JSON.stringify(plan.questions).length;
      }
    }
    const stateChars = questions > 0 ? JSON.stringify(state).length : 0;
    const tokens = questions > 0 ? Math.ceil((stateChars + questionChars) / charsPerToken) : 0;
    if (questions > 0) requests += 1;
    totalTokens += tokens;
    perCase.push({ caseId: evalCase.id, questions, stateChars, questionChars, estimatedInputTokens: tokens, digested: !!evidence.digest?.applied });
  }
  return {
    method: `characters ÷ ${charsPerToken} over the serialised state and questions of each request`,
    charsPerToken,
    caseCount: cases.length,
    requests,
    casesWithoutRequest: cases.length - requests,
    estimatedInputTokens: totalTokens,
    cost: estimateCost(totalTokens, options.pricing),
    cases: perCase,
  };
}
