import type { JsonValue } from "./json.js";

/**
 * Conversation digest: bounds the judge state so long transcripts fit the provider's limits.
 * Sizes are measured in characters (a documented approximation; tokens ≈ chars / 4).
 */
export interface DigestOptions {
  /** Maximum serialised state size in characters. */
  maxChars: number;
  /** Share of the message budget given to the earliest turns; the rest goes to the latest. Default 0.25. */
  headShare?: number | undefined;
}

export const DEFAULT_DIGEST: DigestOptions = { maxChars: 110_000, headShare: 0.25 };

export interface DigestRecord {
  applied: boolean;
  originalChars: number;
  finalChars: number;
  /** Message ids dropped from the conversation, in order. */
  omittedMessageIds: string[];
  /** State fields whose text was cut, with the number of characters removed. */
  truncated: Array<{ field: string; removedChars: number }>;
}

export const DIGEST_MARKER_ID = "jeval-digest";

/** Cut a string to `max` characters without splitting a surrogate pair. */
export function cutSafe(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // high surrogate would be orphaned
  return text.slice(0, end);
}

function size(value: unknown): number {
  return JSON.stringify(value).length;
}

interface MessageLike {
  id: string;
  role: string;
  content: string;
  [key: string]: JsonValue;
}

/**
 * Keep head and tail messages within `budgetChars`, replacing the omitted middle with one marker.
 * Returns the kept list and the omitted ids.
 */
export function digestMessages(messages: readonly MessageLike[], budgetChars: number, headShare = 0.25): { messages: MessageLike[]; omittedIds: string[] } {
  const total = size(messages);
  if (total <= budgetChars || messages.length <= 2) return { messages: [...messages], omittedIds: [] };
  const headBudget = Math.floor(budgetChars * headShare);
  const tailBudget = budgetChars - headBudget;
  const head: MessageLike[] = [];
  let used = 0;
  for (const m of messages) {
    const s = size(m) + 1;
    if (used + s > headBudget) break;
    head.push(m);
    used += s;
  }
  const tail: MessageLike[] = [];
  used = 0;
  for (let i = messages.length - 1; i >= head.length; i--) {
    const m = messages[i]!;
    const s = size(m) + 1;
    if (used + s > tailBudget) break;
    tail.unshift(m);
    used += s;
  }
  const keptCount = head.length + tail.length;
  if (keptCount >= messages.length) return { messages: [...messages], omittedIds: [] };
  const omitted = messages.slice(head.length, messages.length - tail.length);
  const omittedIds = omitted.map((m) => m.id);
  const marker: MessageLike = {
    id: DIGEST_MARKER_ID,
    role: "system",
    content: `[Jeval digest: ${omitted.length} of ${messages.length} messages omitted here to fit the judge's input limit (ids ${omittedIds.slice(0, 5).join(", ")}${omittedIds.length > 5 ? ", …" : ""}). The omitted turns were not shown to the judge.]`,
  };
  return { messages: [...head, marker, ...tail], omittedIds };
}

/**
 * Apply the digest to a built state object in place-order: first shrink the conversation,
 * then truncate the largest text fields until the whole state fits.
 */
export function applyDigest(state: Record<string, JsonValue>, options: DigestOptions, fieldNames: { conversation: string; references: string; input: string; output: string; policy: string; toolEvents: string }): { state: Record<string, JsonValue>; record: DigestRecord } {
  const originalChars = size(state);
  const record: DigestRecord = { applied: false, originalChars, finalChars: originalChars, omittedMessageIds: [], truncated: [] };
  if (originalChars <= options.maxChars) return { state, record };
  const out: Record<string, JsonValue> = { ...state };
  const headShare = options.headShare ?? 0.25;

  const conversation = out[fieldNames.conversation];
  if (Array.isArray(conversation)) {
    const others = size({ ...out, [fieldNames.conversation]: [] });
    const budget = Math.max(2000, options.maxChars - others);
    const { messages, omittedIds } = digestMessages(conversation as MessageLike[], budget, headShare);
    if (omittedIds.length > 0) {
      out[fieldNames.conversation] = messages as JsonValue[];
      record.omittedMessageIds = omittedIds;
      record.applied = true;
    }
  }

  // Truncate the largest string fields (references, output, input, policy) until it fits.
  const order = [fieldNames.references, fieldNames.output, fieldNames.input, fieldNames.policy, fieldNames.toolEvents];
  let guard = 0;
  while (size(out) > options.maxChars && guard++ < 20) {
    const over = size(out) - options.maxChars;
    let cut = false;
    for (const field of order) {
      const value = out[field];
      if (typeof value === "string" && value.length > 500) {
        const target = Math.max(200, value.length - over - 80);
        const removed = value.length - target;
        out[field] = cutSafe(value, target) + ` […${removed} characters truncated by Jeval digest]`;
        record.truncated.push({ field, removedChars: removed });
        record.applied = true;
        cut = true;
        break;
      }
      if (Array.isArray(value)) {
        // find the largest string `content` inside an array of objects (references / tool events)
        let best: { index: number; key: string; length: number } | null = null;
        value.forEach((entry, index) => {
          if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            for (const [key, v] of Object.entries(entry)) {
              if (typeof v === "string" && v.length > 500 && (!best || v.length > best.length)) best = { index, key, length: v.length };
            }
          }
        });
        if (best) {
          const b: { index: number; key: string; length: number } = best;
          const entry = { ...(value[b.index] as Record<string, JsonValue>) };
          const text = entry[b.key] as string;
          const target = Math.max(200, text.length - over - 80);
          const removed = text.length - target;
          entry[b.key] = cutSafe(text, target) + ` […${removed} characters truncated by Jeval digest]`;
          const copy = [...value];
          copy[b.index] = entry;
          out[field] = copy;
          record.truncated.push({ field: `${field}[${b.index}].${b.key}`, removedChars: removed });
          record.applied = true;
          cut = true;
          break;
        }
      }
    }
    if (!cut) break;
  }
  record.finalChars = size(out);
  return { state: out, record };
}
