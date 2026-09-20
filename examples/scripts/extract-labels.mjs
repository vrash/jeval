#!/usr/bin/env node
// Extract the `expected` labels embedded in the example datasets into separate LabelRecord JSONL
// files, so the labels used by `jeval benchmark` always match the datasets exactly.
//
//   node scripts/extract-labels.mjs
//
// Equivalent to `jeval labels <dataset> --out <labels>` for each split, without needing the CLI built.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const splits = [
  { dataset: "data/dataset.tuning.jsonl", labels: "data/labels.tuning.jsonl" },
  { dataset: "data/dataset.holdout.jsonl", labels: "data/labels.holdout.jsonl" },
];

for (const { dataset, labels } of splits) {
  const lines = readFileSync(resolve(root, dataset), "utf8").split(/\r?\n/);
  const records = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("//")) return;
    let c;
    try {
      c = JSON.parse(line);
    } catch (e) {
      throw new Error(`${dataset}:${i + 1}: invalid JSON: ${e.message}`);
    }
    if (typeof c.id !== "string") throw new Error(`${dataset}:${i + 1}: case has no id`);
    for (const [rubricId, label] of Object.entries(c.expected ?? {})) {
      const record = { caseId: c.id, rubricId, expected: label.status, source: label.source ?? "synthetic" };
      if (label.reviewer) record.reviewer = label.reviewer;
      if (label.note) record.note = label.note;
      records.push(record);
    }
  });
  writeFileSync(resolve(root, labels), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`wrote ${records.length} labels to ${labels}`);
}
