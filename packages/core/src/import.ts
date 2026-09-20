/**
 * Import exported traces and conversations from common tools into Jeval `EvalCase` records.
 *
 * Supported sources: OpenAI Chat Completions message logs (`chat`), OpenTelemetry GenAI spans
 * (`otel`), Langfuse traces (`langfuse`), LangWatch traces (`langwatch`) and a dotted-path
 * mapper for anything else (`generic`). See docs/import-formats.md for the shapes each adapter
 * understands and which parts of those shapes were verified against vendor documentation.
 *
 * Runtime-agnostic: no node imports.
 */
import type { JsonValue } from "./json.js";
import { getPath } from "./json.js";
import { parseJsonl } from "./jsonl.js";
import type { ContextItem, EvalCase, Message, ToolEvent } from "./schemas.js";
import { EvalCaseSchema } from "./schemas.js";

export type ImportFormat = "chat" | "otel" | "langfuse" | "langwatch" | "generic";

/** Dotted paths into each source record, used by the `generic` format. */
export interface ImportMap {
  id?: string;
  input?: string;
  output?: string;
  messages?: string;
  policy?: string;
  context?: string;
  toolEvents?: string;
  metadata?: string;
}

export interface ImportOptions {
  format: ImportFormat;
  /** Prefix for generated case ids when the source has none. Default "imported". */
  idPrefix?: string;
  /** For generic: dotted paths into each record. */
  map?: ImportMap;
  /** Static policy text to attach to every case (e.g. the system prompt/policy the app was supposed to follow). */
  policy?: string;
  /** Copy these top-level fields of the source record into metadata (never sent to the judge). */
  metadataFields?: string[];
  /**
   * Infer a tool event's status from its output when the source records no explicit status
   * (default true). When false, events whose source does not state a status are dropped and an
   * issue is recorded rather than inventing one. See docs/import-formats.md for the heuristic.
   */
  toolStatusHeuristic?: boolean;
}

export interface ImportIssue {
  index: number;
  message: string;
}

export interface ImportResult {
  cases: EvalCase[];
  issues: ImportIssue[];
  format: ImportFormat;
  stats: { records: number; imported: number; skipped: number; withToolEvents: number; withMessages: number };
}

/* ------------------------------------------------------------------------------------------------
 * Internal draft model. Every adapter produces a Draft; `finalize` turns it into an EvalCase.
 * ---------------------------------------------------------------------------------------------- */

type Role = Message["role"];
type ToolStatus = ToolEvent["status"];
type Obj = Record<string, unknown>;

interface DraftToolCall {
  id?: string;
  name: string;
  arguments: unknown;
}

interface DraftMessage {
  role: Role;
  content: string;
  name?: string;
  /** Set on tool messages: the call this message answers. */
  toolCallId?: string;
  /** Set on assistant messages that requested tools. */
  toolCalls?: DraftToolCall[];
}

/** Tool activity reported outside the transcript (spans, observations, explicit tool event lists). */
interface DraftTool {
  callId?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  /** Status the source states explicitly. Undefined when the source is silent. */
  status?: ToolStatus;
  error?: string;
}

interface Draft {
  sourceId?: string;
  messages: DraftMessage[];
  tools: DraftTool[];
  context?: ContextItem[];
  policy?: string;
  /** Explicit input/output overrides (generic format). */
  input?: string;
  output?: string;
  /** Extra metadata supplied by the source record itself (generic `map.metadata`). */
  metadata?: Record<string, JsonValue>;
  /** Record that `metadataFields` are read from. */
  source: unknown;
}

/* ------------------------------------------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------------------------------------- */

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** JSON round trip: drops undefined/functions and anything that cannot be serialised. */
function toJson(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : (JSON.parse(text) as JsonValue);
  } catch {
    return undefined;
  }
}

/** Parse a string as JSON when it is JSON, otherwise return it unchanged. Non-strings pass through. */
function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value) ?? "";
}

function findLast<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as T;
    if (test(item)) return item;
  }
  return undefined;
}

/** Sanitise a source id to the EvalCase id grammar. Returns undefined when nothing usable remains. */
function sanitizeId(raw: string): string | undefined {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "");
  if (cleaned === "") return undefined;
  return cleaned.slice(0, 200);
}

function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = `-${n++}`;
    candidate = base.slice(0, 200 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Read a dotted path from a record. Falls back to a literal key lookup (keys may contain dots,
 * e.g. OTel attribute names) and to `attributes.<literal key>` for span records.
 */
function readField(source: unknown, path: string): unknown {
  const direct = getPath(source as JsonValue, path);
  if (direct !== undefined) return direct;
  if (!isObj(source)) return undefined;
  if (path in source) return source[path];
  const attrPrefix = "attributes.";
  if (path.startsWith(attrPrefix) && isObj(source.attributes)) return source.attributes[path.slice(attrPrefix.length)];
  return undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Message normalisation (OpenAI Chat Completions style, OTel GenAI parts, Anthropic blocks)
 * ---------------------------------------------------------------------------------------------- */

function normalizeRole(value: unknown): Role | undefined {
  switch (str(value)?.toLowerCase()) {
    case "system":
    case "developer":
      return "system";
    case "user":
    case "human":
      return "user";
    case "assistant":
    case "ai":
    case "model":
      return "assistant";
    case "tool":
    case "function":
      return "tool";
    default:
      return undefined;
  }
}

/** Text of a message `content` value: strings as-is, content-part arrays joined by their text parts. */
function textOf(content: unknown): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") return String(content);
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
        continue;
      }
      if (!isObj(part)) continue;
      const type = part.type;
      if (type === undefined || type === "text" || type === "input_text" || type === "output_text") {
        const text = str(part.text) ?? str(part.content);
        if (text) parts.push(text);
      }
    }
    return parts.join("\n");
  }
  if (isObj(content)) {
    const text = str(content.text) ?? str(content.content);
    return text ?? JSON.stringify(content);
  }
  return String(content);
}

function toolCallOf(value: unknown): DraftToolCall | undefined {
  if (!isObj(value)) return undefined;
  const fn = isObj(value.function) ? value.function : isObj(value.custom) ? value.custom : value;
  const name = str(fn.name) ?? str(value.name);
  if (!name) return undefined;
  const args = fn.arguments ?? fn.input ?? value.arguments ?? value.args ?? value.input;
  const id = str(value.id) ?? str(value.call_id);
  const call: DraftToolCall = { name, arguments: args };
  if (id) call.id = id;
  return call;
}

/** OTel GenAI message: `{ role, parts: [{type:"text"|"tool_call"|"tool_call_response", ...}] }`. */
function fromOtelParts(role: Role, message: Obj): DraftMessage[] {
  const texts: string[] = [];
  const calls: DraftToolCall[] = [];
  const responses: DraftMessage[] = [];
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (const part of parts) {
    if (!isObj(part)) continue;
    switch (part.type) {
      case "tool_call": {
        const name = str(part.name);
        if (!name) break;
        const call: DraftToolCall = { name, arguments: part.arguments };
        const id = str(part.id);
        if (id) call.id = id;
        calls.push(call);
        break;
      }
      case "tool_call_response": {
        const response: DraftMessage = { role: "tool", content: asText(part.response ?? part.result) };
        const id = str(part.id);
        if (id) response.toolCallId = id;
        const name = str(part.name);
        if (name) response.name = name;
        responses.push(response);
        break;
      }
      default: {
        const text = str(part.content) ?? str(part.text);
        if (text) texts.push(text);
      }
    }
  }
  const main: DraftMessage = { role, content: texts.join("\n") };
  const name = str(message.name);
  if (name) main.name = name;
  if (calls.length > 0) main.toolCalls = calls;
  if (role === "tool" && responses.length > 0 && main.content === "") return responses;
  return [main, ...responses];
}

/** Normalise an OpenAI-style (or OTel parts / Anthropic blocks) message array. Unknown roles are dropped. */
function fromChatMessages(value: unknown): DraftMessage[] {
  if (!Array.isArray(value)) return [];
  const out: DraftMessage[] = [];
  for (const raw of value) {
    if (!isObj(raw)) continue;
    const role = normalizeRole(raw.role);
    if (!role) continue;
    if (Array.isArray(raw.parts)) {
      out.push(...fromOtelParts(role, raw));
      continue;
    }
    const message: DraftMessage = { role, content: textOf(raw.content) };
    const name = str(raw.name);
    if (name) message.name = name;
    const callId = str(raw.tool_call_id) ?? str(raw.toolCallId);
    if (callId) message.toolCallId = callId;

    const calls: DraftToolCall[] = [];
    if (Array.isArray(raw.tool_calls)) {
      for (const tc of raw.tool_calls) {
        const call = toolCallOf(tc);
        if (call) calls.push(call);
      }
    }
    if (isObj(raw.function_call)) {
      const call = toolCallOf(raw.function_call);
      if (call) calls.push(call);
    }
    // Anthropic-style content blocks: tool_use on assistant turns, tool_result inside user turns.
    const results: DraftMessage[] = [];
    if (Array.isArray(raw.content)) {
      for (const block of raw.content) {
        if (!isObj(block)) continue;
        if (block.type === "tool_use") {
          const toolName = str(block.name);
          if (!toolName) continue;
          const call: DraftToolCall = { name: toolName, arguments: block.input };
          const id = str(block.id);
          if (id) call.id = id;
          calls.push(call);
        } else if (block.type === "tool_result") {
          const result: DraftMessage = { role: "tool", content: textOf(block.content) };
          const id = str(block.tool_use_id);
          if (id) result.toolCallId = id;
          results.push(result);
        }
      }
    }
    if (calls.length > 0) message.toolCalls = calls;
    if (!(role === "user" && message.content === "" && results.length > 0)) out.push(message);
    out.push(...results);
  }
  return out;
}

function looksLikeMessages(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((m) => isObj(m) && "role" in m);
  return isObj(value) && (Array.isArray(value.messages) || "role" in value || Array.isArray(value.choices));
}

/**
 * Messages from an arbitrary input/output value: a string becomes one message with `role`, an
 * OpenAI-style array or `{ messages }` / `{ choices }` / `{ role, content }` object is normalised,
 * and anything else is stringified into a single message.
 */
function messagesFromValue(value: unknown, role: "user" | "assistant"): DraftMessage[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      const parsed = parseMaybeJson(trimmed);
      if (parsed !== trimmed && looksLikeMessages(parsed)) return messagesFromValue(parsed, role);
    }
    return trimmed === "" ? [] : [{ role, content: value }];
  }
  if (Array.isArray(value)) {
    if (looksLikeMessages(value)) return fromChatMessages(value);
    if (value.every((v) => typeof v === "string")) return [{ role, content: (value as string[]).join("\n") }];
    return [{ role, content: JSON.stringify(value) }];
  }
  if (isObj(value)) {
    if (Array.isArray(value.messages)) {
      const messages = fromChatMessages(value.messages);
      if (Array.isArray(value.choices)) messages.push(...fromChoices(value.choices));
      return messages;
    }
    if ("role" in value) return fromChatMessages([value]);
    if (Array.isArray(value.choices)) return fromChoices(value.choices);
    if (isObj(value.message) && "role" in value.message) return fromChatMessages([value.message]);
    if (isObj(value.body)) return messagesFromValue(value.body, role);
    const text = str(value.content) ?? str(value.text) ?? str(value.prompt) ?? str(value.question) ?? str(value.query);
    return [{ role, content: text ?? JSON.stringify(value) }];
  }
  return [{ role, content: String(value) }];
}

/** OpenAI Chat Completion `choices`: the first choice's message (or legacy `text`). */
function fromChoices(choices: unknown[]): DraftMessage[] {
  const first = choices[0];
  if (!isObj(first)) return [];
  if (isObj(first.message)) return fromChatMessages([first.message]);
  const text = str(first.text);
  return text !== undefined ? [{ role: "assistant", content: text }] : [];
}

/* ------------------------------------------------------------------------------------------------
 * Tool status heuristic
 * ---------------------------------------------------------------------------------------------- */

/** Returns the error text when a tool output looks like an error, else undefined. */
function errorFromOutput(output: JsonValue | undefined): string | undefined {
  if (typeof output === "string") return /^\s*(Error\b|error:)/.test(output) ? output : undefined;
  if (isObj(output)) {
    const error = output.error;
    if (error === undefined || error === null || error === false || error === "") return undefined;
    if (typeof error === "string") return error;
    if (isObj(error) && typeof error.message === "string") return error.message;
    return JSON.stringify(error);
  }
  return undefined;
}

function parseArguments(args: unknown): JsonValue | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args === "string") {
    const trimmed = args.trim();
    if (trimmed === "") return undefined;
    try {
      return JSON.parse(trimmed) as JsonValue;
    } catch {
      return { raw: args };
    }
  }
  return toJson(args);
}

/* ------------------------------------------------------------------------------------------------
 * Finalise a draft into an EvalCase
 * ---------------------------------------------------------------------------------------------- */

interface ToolCandidate {
  name: string;
  callId?: string;
  input?: JsonValue;
  output?: JsonValue;
  status?: ToolStatus;
  error?: string;
  /** Index into draft.messages of the tool message that reports this call. */
  toolMessage?: number;
  merged?: boolean;
}

interface FinalizeContext {
  format: ImportFormat;
  options: ImportOptions;
  usedIds: Set<string>;
  issues: ImportIssue[];
}

function collectToolCandidates(draft: Draft): ToolCandidate[] {
  const candidates: ToolCandidate[] = [];
  const claimed = new Set<number>();
  const messages = draft.messages;

  messages.forEach((message, i) => {
    if (message.role !== "assistant" || !message.toolCalls) return;
    for (const call of message.toolCalls) {
      const candidate: ToolCandidate = { name: call.name };
      if (call.id) candidate.callId = call.id;
      const input = parseArguments(call.arguments);
      if (input !== undefined) candidate.input = input;

      let idx = -1;
      if (call.id) {
        idx = messages.findIndex((m, j) => j > i && m.role === "tool" && m.toolCallId === call.id && !claimed.has(j));
      }
      if (idx < 0) {
        // Positional fallback for logs without call ids: the next unclaimed, unlinked tool message.
        idx = messages.findIndex(
          (m, j) => j > i && m.role === "tool" && !m.toolCallId && !claimed.has(j) && (!m.name || m.name === call.name),
        );
      }
      if (idx >= 0) {
        claimed.add(idx);
        candidate.toolMessage = idx;
        const output = toJson(parseMaybeJson((messages[idx] as DraftMessage).content));
        if (output !== undefined) candidate.output = output;
      }
      candidates.push(candidate);
    }
  });

  for (const tool of draft.tools) {
    let candidate = tool.callId ? candidates.find((c) => c.callId === tool.callId) : undefined;
    if (!candidate) candidate = candidates.find((c) => c.name === tool.name && !c.merged && !c.callId);
    if (!candidate) candidate = candidates.find((c) => c.name === tool.name && !c.merged);
    if (candidate) {
      candidate.merged = true;
      const input = toJson(tool.input);
      if (input !== undefined && candidate.input === undefined) candidate.input = input;
      const output = toJson(tool.output);
      if (output !== undefined && candidate.output === undefined) candidate.output = output;
      if (tool.status) candidate.status = tool.status;
      if (tool.error) candidate.error = tool.error;
      continue;
    }
    const fresh: ToolCandidate = { name: tool.name, merged: true };
    if (tool.callId) fresh.callId = tool.callId;
    const input = toJson(tool.input);
    if (input !== undefined) fresh.input = input;
    const output = toJson(tool.output);
    if (output !== undefined) fresh.output = output;
    if (tool.status) fresh.status = tool.status;
    if (tool.error) fresh.error = tool.error;
    candidates.push(fresh);
  }
  return candidates;
}

function describeError(e: unknown): string {
  if (isObj(e) && Array.isArray(e.issues)) {
    const lines = (e.issues as unknown[]).slice(0, 3).map((issue) => {
      if (!isObj(issue)) return String(issue);
      const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
      return path ? `${path}: ${String(issue.message)}` : String(issue.message);
    });
    return `schema validation failed: ${lines.join("; ")}`;
  }
  return e instanceof Error ? e.message : String(e);
}

function finalize(draft: Draft, index: number, ctx: FinalizeContext): EvalCase | undefined {
  const { options, issues } = ctx;
  const heuristic = options.toolStatusHeuristic ?? true;

  const lastUser = findLast(draft.messages, (m) => m.role === "user" && m.content !== "");
  const lastAssistant = findLast(draft.messages, (m) => m.role === "assistant" && m.content !== "");
  const input = draft.input ?? lastUser?.content;
  const output = draft.output ?? lastAssistant?.content;
  if (input === undefined) {
    issues.push({ index, message: "skipped: no user message with text content (input)" });
    return undefined;
  }
  if (output === undefined) {
    issues.push({ index, message: "skipped: no assistant message with text content (output)" });
    return undefined;
  }

  // Tool events
  const toolEvents: ToolEvent[] = [];
  const links = new Map<number, ToolEvent>();
  for (const candidate of collectToolCandidates(draft)) {
    let status = candidate.status;
    let error = candidate.error;
    if (!status) {
      if (!heuristic) {
        issues.push({
          index,
          message: `tool event "${candidate.name}" dropped: the source states no status and toolStatusHeuristic is false`,
        });
        continue;
      }
      const inferred = errorFromOutput(candidate.output);
      status = inferred === undefined ? "success" : "failure";
      if (inferred !== undefined && error === undefined) error = inferred;
    } else if (status === "failure" && error === undefined) {
      error = errorFromOutput(candidate.output);
    }
    const event: ToolEvent = { id: `t${toolEvents.length + 1}`, name: candidate.name.slice(0, 200), status };
    if (candidate.input !== undefined) event.input = candidate.input;
    if (candidate.output !== undefined) event.output = candidate.output;
    if (error) event.error = error.slice(0, 20_000);
    toolEvents.push(event);
    if (candidate.toolMessage !== undefined) links.set(candidate.toolMessage, event);
  }

  const messages: Message[] = draft.messages.map((m, i) => {
    const message: Message = { id: `m${i + 1}`, role: m.role, content: m.content };
    const event = links.get(i);
    const name = m.name ?? event?.name;
    if (name) message.name = name.slice(0, 200);
    if (event) message.toolEventId = event.id;
    return message;
  });

  const firstSystem = draft.messages.find((m) => m.role === "system" && m.content !== "");
  const policy = options.policy ?? draft.policy ?? firstSystem?.content;

  const metadata: Record<string, JsonValue> = { importedFrom: ctx.format };
  if (draft.sourceId !== undefined) metadata.sourceId = draft.sourceId;
  if (draft.metadata) Object.assign(metadata, draft.metadata);
  for (const field of options.metadataFields ?? []) {
    const value = toJson(readField(draft.source, field));
    if (value !== undefined) metadata[field] = value;
  }

  const prefix = sanitizeId(options.idPrefix ?? "imported") ?? "imported";
  const base = (draft.sourceId !== undefined ? sanitizeId(draft.sourceId) : undefined) ?? `${prefix}-${index + 1}`;

  const evalCase: EvalCase = { id: "", input, output, metadata };
  if (messages.length > 0) evalCase.messages = messages;
  if (draft.context && draft.context.length > 0) evalCase.context = draft.context;
  if (policy !== undefined && policy !== "") evalCase.policy = policy;
  if (toolEvents.length > 0) evalCase.toolEvents = toolEvents;

  try {
    // Validate before reserving the id so a rejected record does not consume it.
    const parsed = EvalCaseSchema.parse({ ...evalCase, id: base });
    parsed.id = uniqueId(base, ctx.usedIds);
    return parsed;
  } catch (e) {
    issues.push({ index, message: describeError(e) });
    return undefined;
  }
}

/* ------------------------------------------------------------------------------------------------
 * chat: OpenAI Chat Completions message arrays
 * ---------------------------------------------------------------------------------------------- */

function chatDraft(record: unknown): Draft | string {
  let messages: DraftMessage[];
  let sourceId: string | undefined;
  if (Array.isArray(record)) {
    messages = fromChatMessages(record);
  } else if (isObj(record)) {
    const request = isObj(record.request) ? record.request : undefined;
    const body = request && isObj(request.body) ? request.body : request;
    const list = Array.isArray(record.messages) ? record.messages : body && Array.isArray(body.messages) ? body.messages : undefined;
    if (!list) return "skipped: no messages array";
    messages = fromChatMessages(list);
    if (Array.isArray(record.choices)) messages.push(...fromChoices(record.choices));
    const response = record.response ?? record.completion;
    if (response !== undefined) messages.push(...messagesFromValue(response, "assistant"));
    sourceId =
      str(record.id) ??
      str(record.conversation_id) ??
      str(record.conversationId) ??
      str(record.trace_id) ??
      str(record.traceId) ??
      str(record.custom_id);
  } else {
    return "skipped: record is not an object or array";
  }
  if (messages.length === 0) return "skipped: no recognisable messages";
  const draft: Draft = { messages, tools: [], source: record };
  if (sourceId !== undefined) draft.sourceId = sourceId;
  return draft;
}

/* ------------------------------------------------------------------------------------------------
 * otel: OpenTelemetry GenAI spans
 * ---------------------------------------------------------------------------------------------- */

interface OtelSpan {
  raw: Obj;
  name: string;
  traceId: string;
  parentSpanId?: string;
  attrs: Obj;
  statusCode?: "ok" | "error";
  statusMessage?: string;
  start: number;
}

function decodeAnyValue(value: unknown): unknown {
  if (!isObj(value)) return value;
  if ("stringValue" in value) return value.stringValue;
  if ("intValue" in value) return Number(value.intValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("boolValue" in value) return value.boolValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("arrayValue" in value) {
    const inner = isObj(value.arrayValue) && Array.isArray(value.arrayValue.values) ? value.arrayValue.values : [];
    return inner.map(decodeAnyValue);
  }
  if ("kvlistValue" in value) {
    const inner = isObj(value.kvlistValue) && Array.isArray(value.kvlistValue.values) ? value.kvlistValue.values : [];
    return decodeAttributes(inner);
  }
  return value;
}

/** Accept both a plain attribute map and OTLP's `[{ key, value: { stringValue } }]` list. */
function decodeAttributes(value: unknown): Obj {
  if (Array.isArray(value)) {
    const out: Obj = {};
    for (const kv of value) {
      if (isObj(kv) && typeof kv.key === "string") out[kv.key] = decodeAnyValue(kv.value);
    }
    return out;
  }
  if (isObj(value)) {
    const out: Obj = {};
    for (const [key, v] of Object.entries(value)) out[key] = decodeAnyValue(v);
    return out;
  }
  return {};
}

function spanStart(raw: Obj): number {
  const nanos = raw.startTimeUnixNano ?? raw.start_time_unix_nano;
  if (typeof nanos === "number") return nanos;
  if (typeof nanos === "string" && nanos !== "") return Number(nanos);
  const start = raw.startTime ?? raw.start_time;
  if (Array.isArray(start) && typeof start[0] === "number") return start[0] * 1e9 + (typeof start[1] === "number" ? start[1] : 0);
  if (typeof start === "number") return start * 1e6;
  if (typeof start === "string") return Date.parse(start) * 1e6;
  return Number.NaN;
}

function byStart<T extends { start: number }>(a: T, b: T): number {
  if (Number.isNaN(a.start) || Number.isNaN(b.start)) return 0;
  return a.start - b.start;
}

function toOtelSpan(value: unknown): OtelSpan | undefined {
  if (!isObj(value)) return undefined;
  const context = isObj(value.spanContext) ? value.spanContext : undefined;
  const traceId = str(value.traceId) ?? str(value.trace_id) ?? (context ? str(context.traceId) : undefined);
  if (!traceId) return undefined;
  const span: OtelSpan = {
    raw: value,
    name: str(value.name) ?? "",
    traceId,
    attrs: decodeAttributes(value.attributes),
    start: spanStart(value),
  };
  const parent = str(value.parentSpanId) ?? str(value.parent_span_id) ?? str(value.parentId);
  if (parent) span.parentSpanId = parent;
  if (isObj(value.status)) {
    const code = value.status.code;
    if (code === 2 || (typeof code === "string" && /error/i.test(code))) span.statusCode = "error";
    else if (code === 1 || (typeof code === "string" && /^(status_code_)?ok$/i.test(code))) span.statusCode = "ok";
    const message = str(value.status.message);
    if (message) span.statusMessage = message;
  }
  return span;
}

/** Expand OTLP file-exporter envelopes (`resourceSpans[].scopeSpans[].spans[]`) into span records. */
function flattenOtel(records: readonly unknown[]): Array<{ index: number; value: unknown }> {
  const out: Array<{ index: number; value: unknown }> = [];
  records.forEach((record, index) => {
    if (isObj(record) && Array.isArray(record.resourceSpans)) {
      for (const rs of record.resourceSpans) {
        if (!isObj(rs)) continue;
        const scopes = Array.isArray(rs.scopeSpans) ? rs.scopeSpans : Array.isArray(rs.instrumentationLibrarySpans) ? rs.instrumentationLibrarySpans : [];
        for (const scope of scopes) {
          if (!isObj(scope) || !Array.isArray(scope.spans)) continue;
          for (const span of scope.spans) out.push({ index, value: span });
        }
      }
      return;
    }
    out.push({ index, value: record });
  });
  return out;
}

const LLM_OPERATIONS = new Set(["chat", "text_completion", "generate_content", "completion"]);
const MESSAGE_ATTRS = ["gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.prompt", "gen_ai.completion"];

function isLlmSpan(span: OtelSpan): boolean {
  const op = str(span.attrs["gen_ai.operation.name"]);
  if (op && LLM_OPERATIONS.has(op)) return true;
  if (MESSAGE_ATTRS.some((key) => span.attrs[key] !== undefined)) return true;
  return Object.keys(span.attrs).some((key) => key.startsWith("gen_ai.prompt.") || key.startsWith("gen_ai.completion."));
}

function isToolSpan(span: OtelSpan): boolean {
  const op = str(span.attrs["gen_ai.operation.name"]);
  if (op === "execute_tool") return true;
  if (isLlmSpan(span)) return false;
  return typeof span.attrs["gen_ai.tool.name"] === "string" || span.name.startsWith("execute_tool ");
}

/** Set a dotted path on a nested object/array structure (used to rebuild indexed attributes). */
function setPath(target: Obj, segments: string[], value: unknown): void {
  let current: Obj | unknown[] = target;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string;
    const last = i === segments.length - 1;
    const next = segments[i + 1];
    const key: string | number = Array.isArray(current) ? Number(segment) : segment;
    if (last) {
      (current as Record<string | number, unknown>)[key] = value;
      return;
    }
    let child = (current as Record<string | number, unknown>)[key];
    if (!isObj(child) && !Array.isArray(child)) {
      child = next !== undefined && /^\d+$/.test(next) ? [] : {};
      (current as Record<string | number, unknown>)[key] = child;
    }
    current = child as Obj | unknown[];
  }
}

/** Rebuild `gen_ai.prompt.N.role` / `gen_ai.completion.N.tool_calls.0.name` style attributes into message objects. */
function indexedMessages(attrs: Obj, prefix: string): unknown[] {
  const pattern = new RegExp(`^${prefix.replace(/\./g, "\\.")}\\.(\\d+)\\.(.+)$`);
  const byIndex = new Map<number, Obj>();
  for (const [key, value] of Object.entries(attrs)) {
    const match = pattern.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    let message = byIndex.get(index);
    if (!message) {
      message = {};
      byIndex.set(index, message);
    }
    setPath(message, (match[2] as string).split("."), value);
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, message]) => message);
}

function otelLlmMessages(span: OtelSpan): { input: DraftMessage[]; output: DraftMessage[] } {
  const attrs = span.attrs;
  let input = messagesFromValue(parseMaybeJson(attrs["gen_ai.input.messages"]), "user");
  if (input.length === 0) input = messagesFromValue(parseMaybeJson(attrs["gen_ai.prompt"]), "user");
  if (input.length === 0) input = fromChatMessages(indexedMessages(attrs, "gen_ai.prompt"));
  let output = messagesFromValue(parseMaybeJson(attrs["gen_ai.output.messages"]), "assistant");
  if (output.length === 0) output = messagesFromValue(parseMaybeJson(attrs["gen_ai.completion"]), "assistant");
  if (output.length === 0) output = fromChatMessages(indexedMessages(attrs, "gen_ai.completion"));

  const instructions = parseMaybeJson(attrs["gen_ai.system_instructions"]);
  if (instructions !== undefined && !input.some((m) => m.role === "system")) {
    const content = typeof instructions === "string" ? instructions : textOf(instructions);
    if (content) input.unshift({ role: "system", content });
  }
  return { input, output };
}

function otelDraft(group: { traceId: string; spans: OtelSpan[] }): Draft | string {
  const spans = [...group.spans].sort(byStart);
  const llmSpans = spans.filter(isLlmSpan);
  if (llmSpans.length === 0) return `skipped: trace ${group.traceId} has no LLM span (gen_ai.* message attributes)`;

  // The span with the fullest input history is the final call of an agent loop; later spans win ties.
  let best: { input: DraftMessage[]; output: DraftMessage[] } | undefined;
  for (const span of llmSpans) {
    const candidate = otelLlmMessages(span);
    if (!best || candidate.input.length >= best.input.length) best = candidate;
  }
  const messages = [...(best?.input ?? []), ...(best?.output ?? [])];

  const tools: DraftTool[] = [];
  for (const span of spans.filter(isToolSpan)) {
    const attrs = span.attrs;
    const name = str(attrs["gen_ai.tool.name"]) ?? span.name.replace(/^execute_tool\s+/, "");
    if (!name) continue;
    const tool: DraftTool = { name };
    const callId = str(attrs["gen_ai.tool.call.id"]);
    if (callId) tool.callId = callId;
    const input = parseMaybeJson(attrs["gen_ai.tool.call.arguments"]);
    if (input !== undefined) tool.input = input;
    const output = parseMaybeJson(attrs["gen_ai.tool.call.result"]);
    if (output !== undefined) tool.output = output;
    const errorType = str(attrs["error.type"]);
    if (span.statusCode === "error" || errorType) tool.status = "failure";
    else if (span.statusCode === "ok") tool.status = "success";
    const error = span.statusMessage ?? errorType;
    if (error) tool.error = error;
    tools.push(tool);
  }

  const root = spans.find((s) => !s.parentSpanId) ?? (spans[0] as OtelSpan);
  return {
    sourceId: group.traceId,
    messages,
    tools,
    source: { ...root.raw, attributes: root.attrs },
  };
}

/* ------------------------------------------------------------------------------------------------
 * langfuse: trace with observations
 * ---------------------------------------------------------------------------------------------- */

function observationStart(o: Obj): string {
  return str(o.startTime) ?? str(o.start_time) ?? "";
}

function langfuseDraft(record: unknown): Draft | string {
  if (!isObj(record)) return "skipped: record is not an object";
  const observations = (Array.isArray(record.observations) ? record.observations : []).filter(isObj);
  observations.sort((a, b) => observationStart(a).localeCompare(observationStart(b)));

  const generations = observations.filter((o) => str(o.type)?.toUpperCase() === "GENERATION");
  let best: { input: DraftMessage[]; output: DraftMessage[] } | undefined;
  for (const generation of generations) {
    const candidate = { input: messagesFromValue(generation.input, "user"), output: messagesFromValue(generation.output, "assistant") };
    if (!best || candidate.input.length >= best.input.length) best = candidate;
  }
  let messages = [...(best?.input ?? []), ...(best?.output ?? [])];
  const complete = (list: DraftMessage[]): boolean =>
    list.some((m) => m.role === "user" && m.content !== "") && list.some((m) => m.role === "assistant" && m.content !== "");
  if (!complete(messages)) {
    const traceLevel = [...messagesFromValue(record.input, "user"), ...messagesFromValue(record.output, "assistant")];
    if (complete(traceLevel) || messages.length === 0) messages = traceLevel;
  }

  const knownToolNames = new Set<string>();
  for (const m of messages) for (const call of m.toolCalls ?? []) knownToolNames.add(call.name);

  const tools: DraftTool[] = [];
  for (const o of observations) {
    const type = str(o.type)?.toUpperCase();
    const name = str(o.name);
    if (!name) continue;
    const isTool = type === "TOOL" || (type === "SPAN" && knownToolNames.has(name));
    if (!isTool) continue;
    const tool: DraftTool = { name };
    const meta = isObj(o.metadata) ? o.metadata : {};
    const input = o.input;
    const callId =
      str(meta.tool_call_id) ?? str(meta.toolCallId) ?? (isObj(input) ? (str(input.tool_call_id) ?? str(input.toolCallId)) : undefined);
    if (callId) tool.callId = callId;
    if (input !== undefined && input !== null) tool.input = input;
    if (o.output !== undefined && o.output !== null) tool.output = o.output;
    const level = str(o.level)?.toUpperCase();
    if (level === "ERROR") tool.status = "failure";
    else if (level) tool.status = "success";
    const statusMessage = str(o.statusMessage) ?? str(o.status_message);
    if (statusMessage && tool.status === "failure") tool.error = statusMessage;
    tools.push(tool);
  }

  const draft: Draft = { messages, tools, source: record };
  const sourceId = str(record.id) ?? str(record.traceId) ?? str(record.trace_id);
  if (sourceId !== undefined) draft.sourceId = sourceId;
  return draft;
}

/* ------------------------------------------------------------------------------------------------
 * langwatch: trace with spans
 * ---------------------------------------------------------------------------------------------- */

function unwrapTyped(value: unknown): unknown {
  if (isObj(value) && typeof value.type === "string" && "value" in value) return value.value;
  return value;
}

function langwatchStart(span: Obj): number {
  const timestamps = isObj(span.timestamps) ? span.timestamps : {};
  const started = timestamps.started_at ?? timestamps.startedAt;
  return typeof started === "number" ? started : Number.NaN;
}

function langwatchStatus(error: unknown): { status?: ToolStatus; error?: string } {
  if (error === null) return { status: "success" };
  if (error === undefined) return {};
  if (typeof error === "string") return error === "" ? {} : { status: "failure", error };
  if (isObj(error)) {
    if (error.has_error === false) return { status: "success" };
    const message = str(error.message) ?? JSON.stringify(error);
    return message ? { status: "failure", error: message } : { status: "failure" };
  }
  return {};
}

function contextFromRagChunks(chunks: unknown[], used: Set<string>): ContextItem[] {
  const items: ContextItem[] = [];
  for (const chunk of chunks) {
    const content = isObj(chunk) ? textOf(chunk.content ?? chunk.text ?? chunk.page_content) : textOf(chunk);
    if (!content) continue;
    const rawId = isObj(chunk) ? (str(chunk.document_id) ?? str(chunk.chunk_id) ?? str(chunk.id)) : undefined;
    const base = (rawId !== undefined ? sanitizeId(rawId) : undefined) ?? `c${used.size + 1}`;
    const item: ContextItem = { id: uniqueId(base, used), content };
    const title = isObj(chunk) ? str(chunk.title) : undefined;
    if (title) item.title = title.slice(0, 500);
    items.push(item);
  }
  return items;
}

function langwatchDraft(record: unknown): Draft | string {
  if (!isObj(record)) return "skipped: record is not an object";
  const spans = (Array.isArray(record.spans) ? record.spans : [])
    .filter(isObj)
    .map((span) => ({ span, start: langwatchStart(span) }))
    .sort(byStart)
    .map(({ span }) => span);

  let best: { input: DraftMessage[]; output: DraftMessage[] } | undefined;
  for (const span of spans) {
    if (span.type !== "llm") continue;
    const candidate = {
      input: messagesFromValue(unwrapTyped(span.input), "user"),
      output: messagesFromValue(unwrapTyped(span.output), "assistant"),
    };
    if (!best || candidate.input.length >= best.input.length) best = candidate;
  }
  let messages = [...(best?.input ?? []), ...(best?.output ?? [])];
  if (!messages.some((m) => m.role === "user") || !messages.some((m) => m.role === "assistant")) {
    const traceLevel = [
      ...messagesFromValue(unwrapTyped(record.input), "user"),
      ...messagesFromValue(unwrapTyped(record.output), "assistant"),
    ];
    if (traceLevel.length > 0 && messages.length === 0) messages = traceLevel;
    else if (traceLevel.some((m) => m.role === "user") && traceLevel.some((m) => m.role === "assistant")) messages = traceLevel;
  }

  const tools: DraftTool[] = [];
  const contextIds = new Set<string>();
  const context: ContextItem[] = [];
  for (const span of spans) {
    if (span.type === "rag" && Array.isArray(span.contexts)) {
      context.push(...contextFromRagChunks(span.contexts, contextIds));
      continue;
    }
    if (span.type !== "tool") continue;
    const name = str(span.name);
    if (!name) continue;
    const tool: DraftTool = { name };
    const input = unwrapTyped(span.input);
    if (input !== undefined && input !== null) tool.input = input;
    const output = unwrapTyped(span.output);
    if (output !== undefined && output !== null) tool.output = output;
    const callId = isObj(input) ? (str(input.tool_call_id) ?? str(input.toolCallId)) : undefined;
    if (callId) tool.callId = callId;
    const status = langwatchStatus(span.error);
    if (status.status) tool.status = status.status;
    if (status.error) tool.error = status.error;
    tools.push(tool);
  }

  const draft: Draft = { messages, tools, source: record };
  if (context.length > 0) draft.context = context;
  const sourceId = str(record.trace_id) ?? str(record.traceId) ?? str(record.id);
  if (sourceId !== undefined) draft.sourceId = sourceId;
  return draft;
}

/* ------------------------------------------------------------------------------------------------
 * generic: dotted-path mapping
 * ---------------------------------------------------------------------------------------------- */

const DEFAULT_MAP: Required<ImportMap> = {
  id: "id",
  input: "input",
  output: "output",
  messages: "messages",
  policy: "policy",
  context: "context",
  toolEvents: "toolEvents",
  metadata: "metadata",
};

function contextFromValue(value: unknown): ContextItem[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const items: ContextItem[] = [];
  value.forEach((entry, i) => {
    const content = isObj(entry) ? textOf(entry.content ?? entry.text ?? entry.page_content) : textOf(entry);
    if (!content) return;
    const rawId = isObj(entry) ? str(entry.id) : undefined;
    const base = (rawId !== undefined ? sanitizeId(rawId) : undefined) ?? `c${i + 1}`;
    const item: ContextItem = { id: uniqueId(base, used), content };
    const title = isObj(entry) ? str(entry.title) : undefined;
    if (title) item.title = title.slice(0, 500);
    items.push(item);
  });
  return items;
}

function toolsFromValue(value: unknown): DraftTool[] {
  if (!Array.isArray(value)) return [];
  const tools: DraftTool[] = [];
  for (const entry of value) {
    if (!isObj(entry)) continue;
    const fn = isObj(entry.function) ? entry.function : undefined;
    const name = str(entry.name) ?? str(entry.tool) ?? (fn ? str(fn.name) : undefined);
    if (!name) continue;
    const tool: DraftTool = { name };
    const callId = str(entry.toolCallId) ?? str(entry.tool_call_id) ?? str(entry.callId) ?? str(entry.id);
    if (callId) tool.callId = callId;
    const input = entry.input ?? entry.arguments ?? entry.args ?? (fn ? fn.arguments : undefined);
    if (input !== undefined) tool.input = typeof input === "string" ? parseArguments(input) : input;
    const output = entry.output ?? entry.result;
    if (output !== undefined) tool.output = parseMaybeJson(output);
    if (entry.status === "success" || entry.status === "failure") tool.status = entry.status;
    else if (entry.status === "error" || entry.status === "failed" || entry.ok === false || entry.success === false) tool.status = "failure";
    else if (entry.status === "ok" || entry.ok === true || entry.success === true) tool.status = "success";
    const error = str(entry.error) ?? (isObj(entry.error) ? str(entry.error.message) : undefined);
    if (error) {
      tool.error = error;
      if (!tool.status) tool.status = "failure";
    }
    tools.push(tool);
  }
  return tools;
}

function genericDraft(record: unknown, options: ImportOptions): Draft | string {
  if (!isObj(record) && !Array.isArray(record)) return "skipped: record is not an object";
  const map = { ...DEFAULT_MAP, ...(options.map ?? {}) };
  const read = (path: string): unknown => readField(record, path);

  const messages = fromChatMessages(read(map.messages));
  const inputValue = read(map.input);
  const outputValue = read(map.output);
  const input = inputValue === undefined || inputValue === null ? undefined : textOf(inputValue);
  const output = outputValue === undefined || outputValue === null ? undefined : textOf(outputValue);
  if (messages.length === 0) {
    if (input !== undefined) messages.push({ role: "user", content: input });
    if (output !== undefined) messages.push({ role: "assistant", content: output });
  }

  const draft: Draft = { messages, tools: toolsFromValue(read(map.toolEvents)), source: record };
  if (input !== undefined && input !== "") draft.input = input;
  if (output !== undefined && output !== "") draft.output = output;
  const id = str(read(map.id));
  if (id !== undefined) draft.sourceId = id;
  const policy = str(read(map.policy));
  if (policy) draft.policy = policy;
  const context = contextFromValue(read(map.context));
  if (context.length > 0) draft.context = context;
  const metadata = toJson(read(map.metadata));
  if (isObj(metadata)) draft.metadata = metadata as Record<string, JsonValue>;
  return draft;
}

/* ------------------------------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------------------------------- */

export function importRecords(records: readonly unknown[], options: ImportOptions): ImportResult {
  const issues: ImportIssue[] = [];
  const cases: EvalCase[] = [];
  const ctx: FinalizeContext = { format: options.format, options, usedIds: new Set(), issues };
  let skipped = 0;

  const handle = (index: number, draft: Draft | string): void => {
    if (typeof draft === "string") {
      issues.push({ index, message: draft });
      skipped += 1;
      return;
    }
    const evalCase = finalize(draft, index, ctx);
    if (evalCase) cases.push(evalCase);
    else skipped += 1;
  };

  const guarded = (index: number, build: () => Draft | string): void => {
    let draft: Draft | string;
    try {
      draft = build();
    } catch (e) {
      draft = `skipped: ${describeError(e)}`;
    }
    handle(index, draft);
  };

  if (options.format === "otel") {
    const groups = new Map<string, { index: number; traceId: string; spans: OtelSpan[] }>();
    for (const { index, value } of flattenOtel(records)) {
      const span = toOtelSpan(value);
      if (!span) {
        issues.push({ index, message: "skipped: not an OTel span (no traceId)" });
        skipped += 1;
        continue;
      }
      let group = groups.get(span.traceId);
      if (!group) {
        group = { index, traceId: span.traceId, spans: [] };
        groups.set(span.traceId, group);
      }
      group.spans.push(span);
    }
    for (const group of groups.values()) guarded(group.index, () => otelDraft(group));
  } else {
    const adapter = ADAPTERS[options.format];
    records.forEach((record, index) => guarded(index, () => adapter(record, options)));
  }

  return {
    cases,
    issues,
    format: options.format,
    stats: {
      records: records.length,
      imported: cases.length,
      skipped,
      withToolEvents: cases.filter((c) => (c.toolEvents?.length ?? 0) > 0).length,
      withMessages: cases.filter((c) => (c.messages?.length ?? 0) > 0).length,
    },
  };
}

const ADAPTERS: Record<Exclude<ImportFormat, "otel">, (record: unknown, options: ImportOptions) => Draft | string> = {
  chat: chatDraft,
  langfuse: langfuseDraft,
  langwatch: langwatchDraft,
  generic: genericDraft,
};

/**
 * Import from JSONL text (one record per line; blank lines and `#`/`//` comments are ignored, as in
 * `parseJsonl`) or from a single JSON array file. Issues from unparseable lines use the zero-based
 * line number as their `index`.
 */
export function importJsonl(text: string, options: ImportOptions): ImportResult {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      const result = importRecords([], options);
      result.issues.push({ index: 0, message: `invalid JSON array: ${(e as Error).message}` });
      result.stats.records = 1;
      result.stats.skipped = 1;
      return result;
    }
    if (Array.isArray(parsed)) return importRecords(parsed, options);
  }
  const { records, issues } = parseJsonl<unknown>(text, (value) => value);
  const result = importRecords(records, options);
  const parseIssues = issues.map((issue) => ({ index: issue.line - 1, message: `line ${issue.line}: ${issue.message}` }));
  result.issues.unshift(...parseIssues);
  result.stats.records += parseIssues.length;
  result.stats.skipped += parseIssues.length;
  return result;
}

/** Best-effort format sniffing over the first records. Returns null when nothing matches. */
export function detectImportFormat(records: readonly unknown[]): ImportFormat | null {
  const votes = new Map<ImportFormat, number>();
  const vote = (format: ImportFormat): void => {
    votes.set(format, (votes.get(format) ?? 0) + 1);
  };

  for (const record of records.slice(0, 25)) {
    if (Array.isArray(record)) {
      if (looksLikeMessages(record)) vote("chat");
      continue;
    }
    if (!isObj(record)) continue;
    const hasAttrs = isObj(record.attributes) || Array.isArray(record.attributes);
    if (Array.isArray(record.resourceSpans) || ("traceId" in record && "spanId" in record) || (hasAttrs && "name" in record && ("traceId" in record || "trace_id" in record))) {
      vote("otel");
    } else if (("trace_id" in record || "traceId" in record) && Array.isArray(record.spans)) {
      vote("langwatch");
    } else if (Array.isArray(record.observations) || ("id" in record && ["sessionId", "userId", "tags", "htmlPath", "latency", "totalCost"].some((k) => k in record))) {
      vote("langfuse");
    } else if (
      Array.isArray(record.messages) ||
      Array.isArray(record.choices) ||
      (isObj(record.request) && (Array.isArray(record.request.messages) || (isObj(record.request.body) && Array.isArray(record.request.body.messages))))
    ) {
      vote("chat");
    } else if (record.input !== undefined && record.output !== undefined) {
      vote("generic");
    }
  }

  let best: ImportFormat | null = null;
  let bestVotes = 0;
  for (const [format, count] of votes) {
    if (count > bestVotes) {
      best = format;
      bestVotes = count;
    }
  }
  return best;
}
