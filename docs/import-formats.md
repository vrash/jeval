# Importing real conversations and traces

`@jeval/core` ships an importer (`packages/core/src/import.ts`) that converts exported traces and
conversations from common tools into jeval `EvalCase` records, so last week's real traffic can be
evaluated with one command (`jeval capture`).

```ts
import { importJsonl, importRecords, detectImportFormat } from "@jeval/core";

const { cases, issues, stats } = importJsonl(text, { format: "chat", policy: "..." });
```

## API

```ts
type ImportFormat = "chat" | "otel" | "langfuse" | "langwatch" | "generic";

interface ImportOptions {
  format: ImportFormat;
  idPrefix?: string;            // default "imported"; used when the source has no id
  map?: ImportMap;              // generic only: dotted paths (id, input, output, messages, policy, context, toolEvents, metadata)
  policy?: string;              // static policy text for every case; overrides the first system message
  metadataFields?: string[];    // dotted paths copied from the source record into metadata
  toolStatusHeuristic?: boolean // default true; see "Tool status"
}

interface ImportResult {
  cases: EvalCase[];
  issues: { index: number; message: string }[];
  format: ImportFormat;
  stats: { records: number; imported: number; skipped: number; withToolEvents: number; withMessages: number };
}

function importRecords(records: readonly unknown[], options: ImportOptions): ImportResult;
function importJsonl(text: string, options: ImportOptions): ImportResult;   // JSONL or a single JSON array
function detectImportFormat(records: readonly unknown[]): ImportFormat | null;
```

The importer never throws on a bad record: it records an issue (with the zero-based record index, or
the zero-based line number for unparseable JSONL lines) and continues. Every case is validated with
`EvalCaseSchema` before it is returned.

## Rules shared by all formats

- **Messages** get stable ids `m1..mN` and roles `system` / `user` / `assistant` / `tool`. Role
  aliases are folded: `developer` → system, `human` → user, `ai`/`model` → assistant, `function` → tool.
  Messages with any other role are dropped.
- **input** is the content of the last user message with non-empty text; **output** is the content of
  the last assistant message with non-empty text (an assistant turn that only carries tool calls is
  skipped over). If either is missing the record is skipped with an issue.
- **Content arrays** (OpenAI content parts, OTel `parts`) are reduced to their text parts joined by
  newlines. Images, audio and files are ignored.
- **System messages** stay in `messages`; when `options.policy` is not given, the first non-empty
  system message becomes `policy`.
- **Tool calls** on an assistant message become `ToolEvent`s with ids `t1..tK`, `name`, `input`
  (parsed JSON arguments, or `{ "raw": "<string>" }` when the arguments are not JSON). The matching
  `role: "tool"` message (by `tool_call_id`; otherwise the next unlinked tool message after the call)
  supplies `output` (parsed JSON, or the raw string) and is linked via `toolEventId`. The tool
  message's `name` is filled in from the event when the source omitted it.
- **metadata** is `{ importedFrom: <format>, sourceId?: <original id>, ...metadataFields }`. Nothing
  else from the source is copied, so message content never lands in metadata unless a
  `metadataFields` path points at it. For OTel, `metadataFields` are read from the trace's root span
  and `attributes.<name>` resolves attribute names that contain dots (e.g. `attributes.user.id`).
- **Case ids** use the source trace/conversation id when present, sanitised to
  `^[A-Za-z0-9][A-Za-z0-9._:-]*$` (runs of invalid characters become `-`, leading invalid characters
  are dropped, max 200 chars). Otherwise `${idPrefix}-${index + 1}`. Collisions get `-2`, `-3`, …

### Tool status

`ToolEvent.status` is what exact checks read, so the importer is deliberate about where it comes from:

1. **Explicit** status from the source wins: OTel span status `ERROR` (or an `error.type` attribute)
   → `failure`, span status `OK` → `success`; Langfuse `level: "ERROR"` → `failure`, any other
   present `level` → `success`; LangWatch `error` object/string → `failure`, `error: null` or
   `has_error: false` → `success`; generic tool entries with `status`, `ok`, `success` or `error`.
2. Otherwise, with `toolStatusHeuristic: true` (default) the output is inspected: an object with a
   non-empty `error` key, or a string starting with `Error` or `error:`, means `failure` (and the
   error text is copied to `error`); anything else means `success`.
3. With `toolStatusHeuristic: false` an event without an explicit status is **dropped** and an issue
   is recorded. Its tool message stays in the transcript, unlinked. Plain OpenAI chat logs carry no
   explicit status, so this setting drops all of their tool events.

## Formats

### `chat` — OpenAI Chat Completions message arrays

Accepted record shapes: a bare message array; `{ id?, messages }`; `{ messages, choices }`;
`{ request: { messages } | { body: { messages } }, response: <chat completion object | message | string> }`
(OpenAI batch output style). The first choice's message is appended as the final assistant turn.
The source id is read from `id`, `conversation_id`, `conversationId`, `trace_id`, `traceId` or `custom_id`.

Verified against the OpenAI API reference (https://developers.openai.com/api/docs/api-reference/chat/create,
the redirect target of https://platform.openai.com/docs/api-reference/chat/create):

- system/developer, user, assistant and tool messages; `content` is a string or an array of parts
  (`{ type: "text", text }` plus image/audio/file parts).
- assistant `tool_calls[]` = `{ id, type: "function" | "custom", function: { name, arguments } | custom: { name, input } }`;
  `arguments` is a JSON string. Deprecated `function_call: { name, arguments }` is also handled.
- tool messages: `{ role: "tool", content: string | text parts, tool_call_id }`.

The function-calling guide (https://developers.openai.com/api/docs/guides/function-calling) now
documents the Responses API primarily; its Chat Completions field names were not restated there, so
the reference above is the source of truth used. Anthropic-style `tool_use` / `tool_result` content
blocks are also recognised; this is a convenience beyond the spec, not a verified export format.

### `otel` — OpenTelemetry GenAI spans

Input: JSONL of span objects (one per line) with `name`, `traceId`, `spanId`, `parentSpanId`,
`attributes`, `status`, `startTimeUnixNano`. `attributes` may be a plain map or OTLP's
`[{ key, value: { stringValue | intValue | boolValue | doubleValue | arrayValue | kvlistValue } }]`
list. OTLP file-exporter envelopes (`{ resourceSpans: [{ scopeSpans: [{ spans: [...] }] }] }`) are
expanded, and the Node SDK console-exporter aliases (`id`, `parentId`, `startTime: [sec, nanos]`) are
accepted. Spans are grouped by `traceId`; each trace becomes one case with `sourceId = traceId`.

- **LLM spans** are those with `gen_ai.operation.name` in `chat`, `text_completion`,
  `generate_content`, `completion`, or carrying any message attribute. Messages come from the LLM
  span whose `gen_ai.input.messages` is longest (the final call of an agent loop carries the full
  history; later spans win ties): its input messages followed by its output messages.
  `gen_ai.system_instructions` is prepended as a system message when the input has none.
- **Tool spans** are those with `gen_ai.operation.name === "execute_tool"`, or a `gen_ai.tool.name`
  attribute / `execute_tool <name>` span name on a non-LLM span. They yield tool events with
  `input` from `gen_ai.tool.call.arguments`, `output` from `gen_ai.tool.call.result`, and are merged
  with the transcript's tool call of the same `gen_ai.tool.call.id` (or, failing that, the same name).
  Status: span status `ERROR` or `error.type` → failure, `OK` → success, unset → heuristic.
- Message attributes that are JSON strings are parsed.

Verified against the GenAI semantic conventions, which have moved to
https://github.com/open-telemetry/semantic-conventions-genai (the opentelemetry.io pages under
`/docs/specs/semconv/gen-ai/` are now redirect stubs). From `docs/gen-ai/gen-ai-spans.md`,
`gen-ai-events.md` and `non-normative/examples-llm-calls.md` in that repo:

- `gen_ai.operation.name` values (`chat`, `generate_content`, `text_completion`, `execute_tool`),
  `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.conversation.id`, span names
  `{operation} {model}` and `execute_tool {tool name}`.
- `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.system_instructions` (opt-in) as
  arrays of `{ role, parts }` where parts are `{ type: "text", content }`,
  `{ type: "tool_call", id, name, arguments }` and `{ type: "tool_call_response", id, response }`;
  output messages also carry `finish_reason`.
- Execute-tool span attributes `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.type`,
  `gen_ai.tool.description`, `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` and
  `error.type`; span status follows the general "recording errors" rules (status `ERROR` on failure).
- The event form is `gen_ai.client.inference.operation.details` carrying the same three attributes.

**Guessed (not documented in the current spec):** the older `gen_ai.prompt` / `gen_ai.completion`
attributes and the indexed `gen_ai.prompt.N.role|content` / `gen_ai.completion.N.content|tool_calls.M.name|arguments|id`
attributes emitted by pre-1.0 instrumentations (e.g. OpenLLMetry). The current repo no longer
describes these, so support is based on the widely deployed convention rather than a spec; both
JSON-string and indexed forms are accepted, and plain-string `gen_ai.prompt` is treated as one user
message. OTLP JSON status codes are accepted as `1`/`2` or `STATUS_CODE_OK`/`STATUS_CODE_ERROR`.

### `langfuse` — trace export with observations

Input: trace records as returned by `GET /api/public/traces/{traceId}` (or the UI/blob export):
`{ id, name, input, output, metadata, sessionId, userId, tags, observations: [...] }`. `input` and
`output` may be strings, OpenAI-style message arrays, `{ messages }`, `{ role, content }` objects,
or arbitrary JSON (stringified into a single message).

- Messages come from the `GENERATION` observation with the longest input (later wins ties): its
  input then its output. When no generation yields both a user and an assistant turn, trace-level
  `input`/`output` are used instead.
- `TOOL` observations always become tool events; `SPAN` observations do when their `name` matches a
  tool call name in the transcript. `input`/`output` are copied as JSON. Events are linked to
  transcript tool calls via `metadata.tool_call_id` / `input.tool_call_id`, or by name.
- `level: "ERROR"` → failure (with `statusMessage` as the error); any other `level` → success; no
  `level` → heuristic.

Verified against https://api.reference.langfuse.com/ (trace fields `id, name, input, output,
metadata, sessionId, userId, tags, observations[]`; observation fields `id, traceId, type, name,
input, output, level, statusMessage, parentObservationId, model, startTime, endTime`; `type` enum
`GENERATION, SPAN, EVENT, TOOL, AGENT, CHAIN, RETRIEVER, EMBEDDING, GUARDRAIL, EVALUATOR`; `level`
enum `DEBUG, DEFAULT, WARNING, ERROR`) and https://langfuse.com/docs/query-traces (fetching
observations per `trace_id`, hierarchy via `parent_observation_id`, blob-storage export).

**Guessed:** where a TOOL observation stores the tool-call id (checked in `metadata.tool_call_id`,
`metadata.toolCallId`, `input.tool_call_id`); Langfuse does not standardise this. Whether
`GET /api/public/traces` (list) returns full observation objects or only ids: string entries in
`observations` are ignored, so both work, but list-endpoint records fall back to trace-level
input/output.

### `langwatch` — trace with spans

Input: `{ trace_id, spans: [...], metadata?, input?, output? }` (the shape sent to `POST /api/collector`).
Span `input`/`output` are typed values `{ type: "chat_messages" | "text" | "json" | "raw" | "list", value }`;
plain values are also accepted.

- `type: "llm"` spans supply messages from `input.value` / `output.value` (longest input wins,
  later ties win), with trace-level `input`/`output` as fallback.
- `type: "tool"` spans become tool events named after the span, with unwrapped `input`/`output`.
  `error` present (object or string) → failure with `error.message`; `error: null` or
  `has_error: false` → success; `error` absent → heuristic.
- `type: "rag"` spans' `contexts[]` (`{ document_id, chunk_id, content }`) become `context` items.

Verified against https://langwatch.ai/docs/integration/rest-api (collector body example with
`trace_id`, `spans[]`, llm span `input: { type: "chat_messages", value: [...] }`, `output` with
`function_call` / `tool_calls`, `timestamps` in epoch milliseconds) and the SDK type definitions at
https://github.com/langwatch/langwatch/blob/main/sdks/python/src/langwatch/domain/__init__.py
(`SpanTypes` = `span, llm, chain, tool, agent, guardrail, evaluation, rag, workflow, component,
module, server, client, producer, consumer, task, unknown`; `TypedValue*` with `type`/`value`;
`ChatMessage` with `role, content, function_call, tool_calls, tool_call_id, name`; `ErrorCapture`
with `message` and `stacktrace`; `BaseSpan` fields `type, name, span_id, parent_id, trace_id,
input, output, error, timestamps, metrics, params`; `RAGSpan.contexts`).

**Guessed:** the response shape of the trace-details REST endpoint
(https://langwatch.ai/docs/api-reference/traces/get-trace-details returned 404 while writing this);
the importer assumes exported traces use the same span shape as the collector body. `has_error` on
`ErrorCapture` and the `RAGChunk` field names (`document_id`, `chunk_id`, `content`) come from the
SDK source rather than the REST docs. A tool span's `input.tool_call_id` is only a best-effort link
to transcript tool calls; by default tool spans are matched to calls by name.

### `generic` — dotted paths

`map` gives dotted paths (`a.b.0.c`) into each record; defaults are `id, input, output, messages,
policy, context, toolEvents, metadata`. `messages` may point at an OpenAI-style array (then
input/output derive from it unless `input`/`output` paths are also set, which take precedence);
`context` at an array of strings or `{ id?, title?, content }`; `toolEvents` at an array of
`{ name, status?, input?, output?, error?, id? }` (status may also be given as `ok`, `success`,
`error`, `failed`); `metadata` at an object merged into the case metadata. A record with only
`input`/`output` gets a two-message transcript.

## `detectImportFormat`

Best-effort sniffing over the first 25 records: `resourceSpans` / `traceId`+`spanId` / span-like
`attributes` → `otel`; `trace_id` + `spans[]` → `langwatch`; `observations[]` or Langfuse-only
keys (`sessionId`, `userId`, `tags`, …) → `langfuse`; a message array, `messages[]`, `choices[]` or
`request.messages` → `chat`; `input` + `output` → `generic`; otherwise `null`. The majority vote wins.

## Known limitations

- A trace with several independent LLM calls (e.g. a classifier followed by the main call) is
  reduced to the call with the longest input; the other calls' outputs are not represented.
- Only text is imported. Images, audio, files and reasoning parts are dropped.
- Records exceeding the schema limits (200k characters per message, 500 messages/tool events) are
  skipped with a `schema validation failed` issue rather than truncated.
