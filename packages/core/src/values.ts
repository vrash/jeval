/**
 * Deterministic extraction of concrete values (numbers, money, percentages, dates, times,
 * durations) from text, and grounding of each value against source texts. No judge involved.
 */
export type ValueKind = "number" | "money" | "percent" | "date" | "time" | "duration";

export interface ExtractedValue {
  id: string;
  kind: ValueKind;
  /** Text as it appears in the output. */
  text: string;
  start: number;
  end: number;
  /** Canonical forms; a value is grounded if any canonical form appears in a source. */
  canonical: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};
const DURATION_UNIT_ALTS = "business days?|working days?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?";

function num(s: string): string {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : s;
}
function pad(n: number | string): string {
  return String(n).padStart(2, "0");
}
function timeCanon(h: number, m: number, ampm?: string): string {
  let hh = h;
  if (ampm) {
    const a = ampm.toLowerCase().replace(/\./g, "");
    if (a === "pm" && hh < 12) hh += 12;
    if (a === "am" && hh === 12) hh = 0;
  }
  return `T${pad(hh)}:${pad(m)}`;
}

/** Extract concrete values from `text` with stable ids v1, v2, … in order of appearance. */
export function extractValues(text: string): ExtractedValue[] {
  const found: ExtractedValue[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const add = (kind: ValueKind, m: RegExpExecArray, canonical: string[]) => {
    const s = m.index;
    const e = s + m[0].length;
    if (overlaps(s, e)) return;
    taken.push([s, e]);
    found.push({ id: "", kind, text: m[0], start: s, end: e, canonical });
  };
  let m: RegExpExecArray | null;
  const run = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) fn(m);
  };

  // ISO dates
  run(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => add("date", m, [`D${m[1]}-${m[2]}-${m[3]}`, `D${m[2]}-${m[3]}`]));
  // Month-name dates: "May 20, 2024", "20 May 2024", "May 20th", "20th of May"
  run(/\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?|([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?)\b/g, (m) => {
    const mon = MONTHS[(m[2] ?? m[4] ?? "").toLowerCase()];
    if (!mon) return;
    const day = Number(m[1] ?? m[5]);
    if (!(day >= 1 && day <= 31)) return;
    const year = m[3] ?? m[6];
    const md = `D${pad(mon)}-${pad(day)}`;
    add("date", m, year ? [`D${year}-${md.slice(1)}`, md] : [md]);
  });
  // Numeric dates 20/05/2024 or 05/20/2024 (ambiguous: record both readings)
  run(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g, (m) => {
    const a = Number(m[1]), b = Number(m[2]);
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    const forms: string[] = [];
    if (a <= 12) forms.push(`D${y}-${pad(a)}-${pad(b)}`, `D${pad(a)}-${pad(b)}`);
    if (b <= 12) forms.push(`D${y}-${pad(b)}-${pad(a)}`, `D${pad(b)}-${pad(a)}`);
    if (forms.length) add("date", m, forms);
  });
  // Times: 14:00, 2pm, 2:30 p.m., 10 am
  run(/\b(\d{1,2})(?:[:.](\d{1,2}))?\s*([ap]\.?m\.?)\b|\b(\d{1,2}):(\d{1,2})\b(?!\s*[ap]\.?m)/gi, (m) => {
    if (m[3]) add("time", m, [timeCanon(Number(m[1]), Number(m[2] ?? 0), m[3])]);
    else {
      const h = Number(m[4]), mi = Number(m[5]);
      if (h <= 23 && mi <= 59) add("time", m, [timeCanon(h, mi)]);
    }
  });
  // Money: $1,234.50, €30, 30 USD, £5
  run(/(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b)/gi, (m) => {
    const digits = m[0].replace(/[^\d.,]/g, "");
    add("money", m, [`M${num(digits)}`, `N${num(digits)}`]);
  });
  // Percentages
  run(/\b(\d[\d,]*(?:\.\d+)?)\s?(?:%|percent\b)/gi, (m) => add("percent", m, [`P${num(m[1]!)}`, `N${num(m[1]!)}`]));
  // Durations: 5-7 business days, 30 days, three years, 2 weeks
  run(new RegExp(`\\b(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s*(?:-|–|to)\\s*(\\d[\\d,]*(?:\\.\\d+)?))?[\\s-]*(${DURATION_UNIT_ALTS})\\b`, "gi"), (m) => {
    const unit = m[3]!.toLowerCase().replace(/s$/, "");
    const forms = [`U${num(m[1]!)}${unit.replace(/\s/g, "")}`];
    if (m[2]) forms.push(`U${num(m[2])}${unit.replace(/\s/g, "")}`);
    add("duration", m, forms);
  });
  run(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})(?:[- ](${Object.keys(NUMBER_WORDS).join("|")}))?[\\s-]+(${DURATION_UNIT_ALTS})\\b`, "gi"), (m) => {
    let n = NUMBER_WORDS[m[1]!.toLowerCase()] ?? 0;
    if (m[2]) n += NUMBER_WORDS[m[2]!.toLowerCase()] ?? 0;
    const unit = m[3]!.toLowerCase().replace(/\s/g, "").replace(/s$/, "");
    add("duration", m, [`U${n}${unit}`]);
  });
  // Plain numbers (skip list markers like "1." at line start and years handled above)
  run(/(?<![\w./-])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(st|nd|rd|th)?(?![\w/-])/g, (m) => {
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 1);
    if ((m.index === 0 || before === "\n") && after === ".") return; // list marker
    const digits = m[1]! + (m[2] !== undefined ? `.${m[2]}` : "");
    add("number", m, [`N${num(digits)}`]);
  });
  // Standalone number words count as numbers in sources (and outputs), so "six" grounds "6".
  run(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "gi"), (m) => {
    const n = NUMBER_WORDS[m[1]!.toLowerCase()];
    if (n === undefined || n === 1) return; // "one" is too common as a pronoun
    add("number", m, [`N${n}`]);
  });

  found.sort((a, b) => a.start - b.start);
  return found.map((v, i) => ({ ...v, id: `v${i + 1}` }));
}

/** Canonical forms present in a source text, for membership checks. */
export function sourceCanonicals(text: string): Set<string> {
  const set = new Set<string>();
  for (const v of extractValues(text)) for (const c of v.canonical) set.add(c);
  return set;
}

export interface GroundingResult {
  value: ExtractedValue;
  grounded: boolean;
  /** Which canonical form matched, when grounded. */
  matched?: string;
}

/** Check each output value against the union of canonical forms found in the sources. */
export function groundValues(output: string, sources: readonly string[]): GroundingResult[] {
  const pool = new Set<string>();
  for (const s of sources) for (const c of sourceCanonicals(s)) pool.add(c);
  return extractValues(output).map((value) => {
    const matched = value.canonical.find((c) => pool.has(c));
    return matched ? { value, grounded: true, matched } : { value, grounded: false };
  });
}
