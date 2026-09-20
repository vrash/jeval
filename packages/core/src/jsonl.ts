import { EvalCaseSchema, LabelRecordSchema, type EvalCase, type LabelRecord } from "./schemas.js";

export interface JsonlIssue {
  line: number;
  message: string;
}

export function parseJsonl<T>(text: string, parseLine: (value: unknown, line: number) => T): { records: T[]; issues: JsonlIssue[] } {
  const records: T[] = [];
  const issues: JsonlIssue[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#")) return;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch (e) {
      issues.push({ line, message: `invalid JSON: ${(e as Error).message}` });
      return;
    }
    try {
      records.push(parseLine(value, line));
    } catch (e) {
      issues.push({ line, message: (e as Error).message });
    }
  });
  return { records, issues };
}

export function parseCasesJsonl(text: string): { cases: EvalCase[]; issues: JsonlIssue[] } {
  const { records, issues } = parseJsonl(text, (v) => EvalCaseSchema.parse(v));
  return { cases: records, issues };
}

export function parseLabelsJsonl(text: string): { labels: LabelRecord[]; issues: JsonlIssue[] } {
  const { records, issues } = parseJsonl(text, (v) => LabelRecordSchema.parse(v));
  return { labels: records, issues };
}

export function toJsonl(records: readonly unknown[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

/** Strip harness-only fields so a dataset can be shared without expected labels. */
export function stripExpected(cases: readonly EvalCase[]): EvalCase[] {
  return cases.map(({ expected: _expected, ...rest }) => rest);
}
