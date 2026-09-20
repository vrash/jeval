export interface Sentence {
  /** Stable id within the text: s1, s2, … */
  id: string;
  text: string;
  /** Character offsets into the original text (end exclusive). */
  start: number;
  end: number;
}

const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "inc", "ltd", "co", "fig", "approx"]);

/**
 * Deterministic sentence splitter for evaluated responses. Splits on sentence punctuation
 * followed by whitespace, on newlines, and on list bullets; keeps offsets so labels and
 * reports can point back into the original text. Fragments shorter than `minChars` are merged
 * into their neighbour. Not a linguistic parser: good enough for claim localisation.
 */
export function splitSentences(text: string, options: { minChars?: number; maxSentences?: number } = {}): Sentence[] {
  const minChars = options.minChars ?? 20;
  const max = options.maxSentences ?? 40;
  const spans: Array<[number, number]> = [];
  let start = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i]!;
    let boundary = false;
    if (ch === "\n") boundary = true;
    else if ((ch === "." || ch === "!" || ch === "?") && i + 1 < n && /\s/.test(text[i + 1]!)) {
      const word = text.slice(Math.max(0, i - 8), i).split(/\s/).pop()?.toLowerCase().replace(/[^a-z.]/g, "") ?? "";
      const isAbbrev = ABBREVIATIONS.has(word) || /^[a-z]$/.test(word) || /\d$/.test(text.slice(i - 1, i)) && /^\d/.test(text.slice(i + 2, i + 3));
      if (!isAbbrev) boundary = true;
    }
    if (boundary) {
      spans.push([start, i + 1]);
      start = i + 1;
    }
  }
  if (start < n) spans.push([start, n]);

  // trim whitespace/bullets and drop empties
  const trimmed: Array<[number, number]> = [];
  for (const [s, e] of spans) {
    let a = s;
    let b = e;
    while (a < b && /[\s\-•*•]/.test(text[a]!)) a++;
    while (b > a && /\s/.test(text[b - 1]!)) b--;
    if (b > a) trimmed.push([a, b]);
  }
  // merge short fragments into the previous sentence
  const merged: Array<[number, number]> = [];
  for (const span of trimmed) {
    const last = merged[merged.length - 1];
    if (last && span[1] - span[0] < minChars) last[1] = span[1];
    else if (last && last[1] - last[0] < minChars) last[1] = span[1];
    else merged.push([span[0], span[1]]);
  }
  // cap the count by merging the tail
  while (merged.length > max) {
    const tail = merged.pop()!;
    merged[merged.length - 1]![1] = tail[1];
  }
  return merged.map(([s, e], i) => ({ id: `s${i + 1}`, text: text.slice(s, e), start: s, end: e }));
}
