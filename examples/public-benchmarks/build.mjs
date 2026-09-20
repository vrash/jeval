// Converts public datasets into jeval datasets + label files. Deterministic sampling (seeded).
// Sources (all MIT): RAGTruth (ParticleMedia/RAGTruth), HaluEval (RUCAIBox/HaluEval), tau-bench (sierra-research/tau-bench).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function sample(arr, n, rand) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
mkdirSync("data", { recursive: true });

// ---------- RAGTruth: human span-level hallucination labels ----------
const src = new Map();
for (const l of readFileSync("raw/ragtruth/dataset/source_info.jsonl", "utf8").split("\n")) if (l.trim()) { const d = JSON.parse(l); src.set(d.source_id, d); }
const responses = readFileSync("raw/ragtruth/dataset/response.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.quality === "good");

function ragCase(r) {
  const s = src.get(r.source_id);
  let input, context;
  if (s.task_type === "QA") {
    input = s.source_info.question;
    const parts = String(s.source_info.passages).split(/\n\n(?=passage \d+:)/).map((p) => p.trim()).filter(Boolean);
    context = parts.map((p, i) => ({ id: `p${i + 1}`, content: p.slice(0, 20000) }));
  } else if (s.task_type === "Summary") {
    input = "Summarize the following article.";
    context = [{ id: "article", title: "Source article", content: String(s.source_info).slice(0, 60000) }];
  } else {
    input = "Write a description of this business based only on the structured data.";
    context = [{ id: "record", title: "Structured data", content: JSON.stringify(s.source_info, null, 1).slice(0, 60000) }];
  }
  const halluc = r.labels.length > 0;
  return {
    id: `ragtruth-${r.id}`,
    input,
    output: r.response,
    context,
    metadata: { source: "RAGTruth", task: s.task_type, split: r.split, model: r.model, labelTypes: [...new Set(r.labels.map((x) => x.label_type))] },
    expected: { "claim-support": { status: halluc ? "fail" : "pass", source: "human", note: halluc ? `RAGTruth: ${r.labels.length} annotated span(s): ${[...new Set(r.labels.map((x) => x.label_type))].join(", ")}` : "RAGTruth: no annotated hallucination" } },
  };
}
const byKey = {};
for (const r of responses) { const s = src.get(r.source_id); const k = `${s.task_type}|${r.split}|${r.labels.length ? "h" : "c"}`; (byKey[k] ??= []).push(r); }
const rand = rng(20260920);
const tuning = [], holdout = [];
for (const task of ["QA", "Summary", "Data2txt"]) {
  for (const kind of ["h", "c"]) {
    tuning.push(...sample(byKey[`${task}|train|${kind}`], 20, rand));   // 120 tuning cases, balanced
    holdout.push(...sample(byKey[`${task}|test|${kind}`], 50, rand));   // 300 holdout cases, balanced
  }
}
const ragTuning = tuning.map(ragCase), ragHoldout = holdout.map(ragCase);
writeFileSync("data/ragtruth.tuning.jsonl", jsonl(ragTuning));
writeFileSync("data/ragtruth.holdout.jsonl", jsonl(ragHoldout));
const labels = (cases) => cases.flatMap((c) => Object.entries(c.expected).map(([rubricId, e]) => ({ caseId: c.id, rubricId, expected: e.status, source: e.source, reviewer: e.source === "human" ? "RAGTruth annotators" : undefined, note: e.note })));
writeFileSync("data/ragtruth.tuning.labels.jsonl", jsonl(labels(ragTuning)));
writeFileSync("data/ragtruth.holdout.labels.jsonl", jsonl(labels(ragHoldout)));

// ---------- HaluEval QA: paired right / hallucinated answers with the supporting knowledge (labels are generated+filtered, not human) ----------
const qa = readFileSync("raw/halueval/data/qa_data.json", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const qaPick = sample(qa, 100, rng(7));
const halu = qaPick.flatMap((d, i) => [
  { id: `halueval-qa-${i}-right`, input: d.question, output: d.right_answer, context: [{ id: "k", title: "Knowledge", content: d.knowledge }], metadata: { source: "HaluEval", task: "QA", pair: i }, expected: { "claim-support": { status: "pass", source: "imported", note: "HaluEval right_answer" } } },
  { id: `halueval-qa-${i}-halluc`, input: d.question, output: d.hallucinated_answer, context: [{ id: "k", title: "Knowledge", content: d.knowledge }], metadata: { source: "HaluEval", task: "QA", pair: i }, expected: { "claim-support": { status: "fail", source: "imported", note: "HaluEval hallucinated_answer (model-generated, filtered)" } } },
]);
writeFileSync("data/halueval.holdout.jsonl", jsonl(halu));
writeFileSync("data/halueval.holdout.labels.jsonl", jsonl(labels(halu).map((l) => ({ ...l, reviewer: undefined }))));

// ---------- tau-bench: real agent trajectories with policy + tool calls (no per-check human labels) ----------
const trajRows = [];
for (const [file, domain] of [["gpt-4o-airline.json", "airline"], ["gpt-4o-retail.json", "retail"]]) {
  const all = JSON.parse(readFileSync(`raw/taubench/historical_trajectories/${file}`, "utf8"));
  for (const t of sample(all, 50, rng(domain === "airline" ? 11 : 13))) {
    trajRows.push({ id: `taubench-${domain}-${t.task_id}-t${t.trial}`, domain, reward: t.reward, messages: t.traj });
  }
}
writeFileSync("data/taubench.chat.jsonl", jsonl(trajRows));

console.log(JSON.stringify({ ragtruthTuning: ragTuning.length, ragtruthHoldout: ragHoldout.length, halueval: halu.length, taubenchTrajectories: trajRows.length }));

// ---------- RAGTruth sentence-level labels (span overlap → sentence label), for the sentence-granularity rubric ----------
import { splitSentences } from "@jeval/core";
function sentenceLabels(cases, rawById) {
  const out = [];
  for (const c of cases) {
    const r = rawById.get(c.id);
    const sentences = splitSentences(c.output);
    for (const sn of sentences) {
      const hit = r.labels.some((l) => l.start < sn.end && l.end > sn.start);
      out.push({ caseId: c.id, rubricId: `claim-support#${sn.id}`, expected: hit ? "fail" : "pass", source: "human", reviewer: "RAGTruth annotators", note: hit ? "overlaps an annotated hallucination span" : "no annotated span in this sentence" });
    }
  }
  return out;
}
const rawById = new Map(responses.map((r) => [`ragtruth-${r.id}`, r]));
writeFileSync("data/ragtruth.holdout.sentence-labels.jsonl", jsonl([...labels(ragHoldout), ...sentenceLabels(ragHoldout, rawById)]));
writeFileSync("data/ragtruth.tuning.sentence-labels.jsonl", jsonl([...labels(ragTuning), ...sentenceLabels(ragTuning, rawById)]));
console.log(JSON.stringify({ sentenceLabelsHoldout: sentenceLabels(ragHoldout, rawById).length, sentenceLabelsTuning: sentenceLabels(ragTuning, rawById).length }));
