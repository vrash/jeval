/** JSON-compatible value. Matches what judge providers accept as state. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Stable stringify with sorted object keys, used for fingerprints and fixtures. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * 64-bit FNV-1a fingerprint rendered as 16 hex characters.
 * Not cryptographic. Used to detect whether two runs used the same dataset or rubric set.
 */
export function fingerprint(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Read a dotted path such as `result.status` from a JSON value. */
export function getPath(value: JsonValue | undefined, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of path.split(".")) {
    if (current === undefined || current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      const idx = Number(segment);
      current = Number.isInteger(idx) ? current[idx] : undefined;
    } else {
      current = current[segment];
    }
  }
  return current;
}
