import { describe, expect, it } from "vitest";
import { detectImportFormat, importJsonl, importRecords } from "../import.js";
import type { ImportResult } from "../import.js";
import { EvalCaseSchema } from "../schemas.js";

/* ---------------------------------------------------------------- fixtures */

const chatConversation = {
  id: "conv_2024-05-01/abc def",
  messages: [
    { role: "system", content: "You are a support agent. Never promise refunds without checking the order." },
    { role: "user", content: "Where is my order 4411?" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup_order", arguments: '{"orderId":"4411"}' } }],
    },
    { role: "tool", tool_call_id: "call_1", content: '{"status":"shipped","eta":"2024-05-03"}' },
    { role: "assistant", content: "Order 4411 shipped and should arrive on 2024-05-03." },
  ],
};

const chatWithFailures = {
  id: "conv-fail",
  messages: [
    { role: "user", content: "Cancel order 9 and refund it" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "c1", type: "function", function: { name: "cancel_order", arguments: '{"orderId":9}' } },
        { id: "c2", type: "function", function: { name: "refund", arguments: "not json at all" } },
        { id: "c3", type: "function", function: { name: "notify", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: '{"error":"order already shipped"}' },
    { role: "tool", tool_call_id: "c2", content: "Error: refund service unavailable" },
    { role: "tool", tool_call_id: "c3", content: "ok" },
    { role: "assistant", content: "I could not cancel the order because it already shipped." },
  ],
};

const otelChatSpans = [
  {
    traceId: "trace-aaa",
    spanId: "s1",
    parentSpanId: "",
    name: "invoke_agent support",
    startTimeUnixNano: "1000",
    attributes: { "gen_ai.operation.name": "invoke_agent", "user.id": "u-9" },
  },
  {
    traceId: "trace-aaa",
    spanId: "s2",
    parentSpanId: "s1",
    name: "chat gpt-4o",
    startTimeUnixNano: "2000",
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.system_instructions": "Answer briefly.",
      "gen_ai.input.messages": JSON.stringify([{ role: "user", parts: [{ type: "text", content: "Weather in Paris?" }] }]),
      "gen_ai.output.messages": JSON.stringify([
        { role: "assistant", parts: [{ type: "tool_call", id: "call_w", name: "get_weather", arguments: { location: "Paris" } }], finish_reason: "tool_call" },
      ]),
    },
  },
  {
    traceId: "trace-aaa",
    spanId: "s3",
    parentSpanId: "s1",
    name: "execute_tool get_weather",
    startTimeUnixNano: "3000",
    status: { code: "STATUS_CODE_ERROR", message: "upstream timeout" },
    attributes: [
      { key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } },
      { key: "gen_ai.tool.name", value: { stringValue: "get_weather" } },
      { key: "gen_ai.tool.call.id", value: { stringValue: "call_w" } },
      { key: "gen_ai.tool.call.arguments", value: { stringValue: '{"location":"Paris"}' } },
    ],
  },
  {
    traceId: "trace-aaa",
    spanId: "s4",
    parentSpanId: "s1",
    name: "chat gpt-4o",
    startTimeUnixNano: "4000",
    attributes: [
      { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
      {
        key: "gen_ai.input.messages",
        value: {
          stringValue: JSON.stringify([
            { role: "user", parts: [{ type: "text", content: "Weather in Paris?" }] },
            { role: "assistant", parts: [{ type: "tool_call", id: "call_w", name: "get_weather", arguments: { location: "Paris" } }] },
            { role: "tool", parts: [{ type: "tool_call_response", id: "call_w", response: "timeout" }] },
          ]),
        },
      },
      {
        key: "gen_ai.output.messages",
        value: { stringValue: JSON.stringify([{ role: "assistant", parts: [{ type: "text", content: "Sorry, the weather service timed out." }] }]) },
      },
    ],
  },
  // A second, unrelated trace using the older indexed attribute form.
  {
    traceId: "trace-bbb",
    spanId: "t1",
    name: "openai.chat",
    attributes: {
      "gen_ai.prompt.0.role": "system",
      "gen_ai.prompt.0.content": "Be terse.",
      "gen_ai.prompt.1.role": "user",
      "gen_ai.prompt.1.content": "Ping",
      "gen_ai.completion.0.role": "assistant",
      "gen_ai.completion.0.content": "Pong",
    },
  },
];

const langfuseTrace = {
  id: "lf-trace-1",
  name: "support-chat",
  sessionId: "sess-1",
  userId: "user-42",
  tags: ["prod"],
  input: "Book me a table for two tonight",
  output: "Done, table for two at 7pm.",
  metadata: { env: "prod" },
  observations: [
    {
      id: "obs-gen",
      type: "GENERATION",
      name: "openai-chat",
      startTime: "2024-05-01T10:00:00.000Z",
      level: "DEFAULT",
      input: [
        { role: "system", content: "You are a booking bot." },
        { role: "user", content: "Book me a table for two tonight" },
      ],
      output: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_b", type: "function", function: { name: "book_table", arguments: '{"party":2,"time":"19:00"}' } }],
      },
    },
    {
      id: "obs-tool",
      type: "TOOL",
      name: "book_table",
      startTime: "2024-05-01T10:00:01.000Z",
      level: "ERROR",
      statusMessage: "restaurant closed",
      input: { party: 2, time: "19:00", tool_call_id: "call_b" },
      output: { error: "closed" },
    },
    {
      id: "obs-gen2",
      type: "GENERATION",
      name: "openai-chat",
      startTime: "2024-05-01T10:00:02.000Z",
      input: [
        { role: "system", content: "You are a booking bot." },
        { role: "user", content: "Book me a table for two tonight" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_b", type: "function", function: { name: "book_table", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_b", content: '{"error":"closed"}' },
      ],
      output: { role: "assistant", content: "Done, table for two at 7pm." },
    },
  ],
};

const langwatchTrace = {
  trace_id: "lw-trace-1",
  metadata: { user_id: "u1", labels: ["beta"] },
  spans: [
    {
      type: "rag",
      span_id: "r1",
      name: "retrieve",
      timestamps: { started_at: 1000, finished_at: 1100 },
      contexts: [
        { document_id: "doc-1", chunk_id: "c1", content: "Refunds are processed within 5 business days." },
        { document_id: "doc-1", chunk_id: "c2", content: "Cancellations are free within 24 hours." },
      ],
    },
    {
      type: "llm",
      span_id: "l1",
      vendor: "openai",
      model: "gpt-4o",
      timestamps: { started_at: 1200, finished_at: 1300 },
      input: {
        type: "chat_messages",
        value: [
          { role: "system", content: "Only answer from the provided documents." },
          { role: "user", content: "How long do refunds take?" },
        ],
      },
      output: {
        type: "chat_messages",
        value: [{ role: "assistant", content: "Refunds take up to 5 business days.", function_call: null, tool_calls: [] }],
      },
    },
    {
      type: "tool",
      span_id: "t1",
      name: "check_refund_status",
      timestamps: { started_at: 1400, finished_at: 1500 },
      input: { type: "json", value: { orderId: 7 } },
      output: { type: "text", value: "pending" },
      error: { has_error: true, message: "gateway 502", stacktrace: ["at call"] },
    },
    {
      type: "tool",
      span_id: "t2",
      name: "log_event",
      timestamps: { started_at: 1600, finished_at: 1700 },
      input: { type: "json", value: { kind: "refund_query" } },
      output: { type: "json", value: { ok: true } },
      error: null,
    },
  ],
};

const genericRecord = {
  data: {
    key: "row 1",
    question: "What is the capital of France?",
    answer: "Paris.",
    rules: "Answer with one word.",
    docs: ["Paris is the capital of France.", { id: "geo/2", title: "Geography", content: "France is in Europe." }],
    tools: [{ name: "search", status: "success", input: { q: "capital of France" }, output: ["Paris"] }],
    extra: { team: "geo" },
  },
  secret: "do-not-copy",
};

const allCases = (r: ImportResult) => r.cases;

/* ------------------------------------------------------------------- tests */

describe("importRecords: chat", () => {
  it("builds messages, links tool calls to tool messages and derives input/output/policy", () => {
    const r = importRecords([chatConversation], { format: "chat" });
    expect(r.issues).toEqual([]);
    expect(r.stats).toEqual({ records: 1, imported: 1, skipped: 0, withToolEvents: 1, withMessages: 1 });
    const c = r.cases[0]!;
    expect(c.id).toBe("conv_2024-05-01-abc-def");
    expect(c.input).toBe("Where is my order 4411?");
    expect(c.output).toBe("Order 4411 shipped and should arrive on 2024-05-03.");
    expect(c.policy).toContain("Never promise refunds");
    expect(c.messages!.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(c.messages!.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(c.toolEvents).toEqual([
      { id: "t1", name: "lookup_order", status: "success", input: { orderId: "4411" }, output: { status: "shipped", eta: "2024-05-03" } },
    ]);
    expect(c.messages![3]).toMatchObject({ role: "tool", toolEventId: "t1", name: "lookup_order" });
    expect(c.metadata).toEqual({ importedFrom: "chat", sourceId: "conv_2024-05-01/abc def" });
  });

  it("marks tool events as failures when the output looks like an error and keeps raw non-JSON arguments", () => {
    const r = importRecords([chatWithFailures], { format: "chat" });
    const events = r.cases[0]!.toolEvents!;
    expect(events.map((e) => [e.name, e.status])).toEqual([
      ["cancel_order", "failure"],
      ["refund", "failure"],
      ["notify", "success"],
    ]);
    expect(events[0]!.error).toBe("order already shipped");
    expect(events[1]!.input).toEqual({ raw: "not json at all" });
    expect(events[1]!.error).toBe("Error: refund service unavailable");
    expect(events[2]!.output).toBe("ok");
  });

  it("drops tool events without an explicit status when toolStatusHeuristic is false", () => {
    const r = importRecords([chatWithFailures], { format: "chat", toolStatusHeuristic: false });
    expect(r.cases).toHaveLength(1);
    expect(r.cases[0]!.toolEvents).toBeUndefined();
    expect(r.issues).toHaveLength(3);
    expect(r.issues[0]!.message).toMatch(/cancel_order.*toolStatusHeuristic/);
    // the tool messages stay in the transcript but are no longer linked
    expect(r.cases[0]!.messages!.filter((m) => m.role === "tool").every((m) => m.toolEventId === undefined)).toBe(true);
  });

  it("skips records with no user or no assistant text and records an issue", () => {
    const r = importRecords(
      [
        { messages: [{ role: "user", content: "hello?" }] },
        { messages: [{ role: "assistant", content: "hi" }] },
        "not a record",
      ],
      { format: "chat" },
    );
    expect(r.cases).toEqual([]);
    expect(r.stats.skipped).toBe(3);
    expect(r.issues.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(r.issues[0]!.message).toMatch(/no assistant message/);
    expect(r.issues[1]!.message).toMatch(/no user message/);
  });

  it("joins text parts of content arrays and accepts a bare message array or request/response pair", () => {
    const bare = [
      { role: "user", content: [{ type: "text", text: "Line one" }, { type: "image_url", image_url: { url: "x" } }, { type: "text", text: "Line two" }] },
      { role: "assistant", content: [{ type: "text", text: "Got it." }] },
    ];
    const pair = {
      request: { messages: [{ role: "user", content: "2+2?" }] },
      response: { choices: [{ index: 0, message: { role: "assistant", content: "4" }, finish_reason: "stop" }] },
    };
    const r = importRecords([bare, pair], { format: "chat", idPrefix: "wk" });
    expect(r.cases.map((c) => c.id)).toEqual(["wk-1", "wk-2"]);
    expect(r.cases[0]!.input).toBe("Line one\nLine two");
    expect(r.cases[0]!.output).toBe("Got it.");
    expect(r.cases[1]!.output).toBe("4");
  });

  it("sanitises source ids and de-duplicates collisions", () => {
    const rec = (id: string) => ({ id, messages: [{ role: "user", content: "q" }, { role: "assistant", content: "a" }] });
    const r = importRecords([rec("a b/c"), rec("a-b-c"), rec("a-b-c"), rec("!!!"), rec("")], { format: "chat" });
    expect(r.cases.map((c) => c.id)).toEqual(["a-b-c", "a-b-c-2", "a-b-c-3", "imported-4", "imported-5"]);
  });
});

describe("importRecords: otel", () => {
  it("groups spans by traceId, reads both attribute encodings and takes tool status from the span status", () => {
    const r = importRecords(otelChatSpans, { format: "otel", metadataFields: ["attributes.user.id"] });
    expect(r.issues).toEqual([]);
    expect(r.cases).toHaveLength(2);
    const first = r.cases[0]!;
    expect(first.id).toBe("trace-aaa");
    expect(first.input).toBe("Weather in Paris?");
    expect(first.output).toBe("Sorry, the weather service timed out.");
    expect(first.messages!.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(first.toolEvents).toEqual([
      { id: "t1", name: "get_weather", status: "failure", input: { location: "Paris" }, output: "timeout", error: "upstream timeout" },
    ]);
    expect(first.messages![2]).toMatchObject({ role: "tool", toolEventId: "t1" });
    expect(first.metadata).toEqual({ importedFrom: "otel", sourceId: "trace-aaa", "attributes.user.id": "u-9" });

    const second = r.cases[1]!;
    expect(second.id).toBe("trace-bbb");
    expect(second.policy).toBe("Be terse.");
    expect(second.input).toBe("Ping");
    expect(second.output).toBe("Pong");
  });

  it("accepts OTLP file-exporter envelopes and gen_ai.system_instructions", () => {
    const envelope = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "0af7651916cd43dd8448eb211c80319c",
                  spanId: "b7ad6b7169203331",
                  name: "chat gpt-4o-mini",
                  status: { code: 1 },
                  attributes: [
                    { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
                    { key: "gen_ai.system_instructions", value: { stringValue: JSON.stringify([{ type: "text", content: "Be polite." }]) } },
                    { key: "gen_ai.input.messages", value: { stringValue: JSON.stringify([{ role: "user", parts: [{ type: "text", content: "Hi" }] }]) } },
                    { key: "gen_ai.output.messages", value: { stringValue: JSON.stringify([{ role: "assistant", parts: [{ type: "text", content: "Hello!" }] }]) } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const r = importRecords([envelope, { notASpan: true }], { format: "otel" });
    expect(r.cases).toHaveLength(1);
    expect(r.cases[0]!.policy).toBe("Be polite.");
    expect(r.cases[0]!.messages![0]).toMatchObject({ role: "system", content: "Be polite." });
    expect(r.issues).toEqual([{ index: 1, message: "skipped: not an OTel span (no traceId)" }]);
  });
});

describe("importRecords: langfuse", () => {
  it("prefers the fullest GENERATION observation, links TOOL observations and maps level ERROR to failure", () => {
    const r = importRecords([langfuseTrace], { format: "langfuse", metadataFields: ["sessionId", "metadata.env"] });
    expect(r.issues).toEqual([]);
    const c = r.cases[0]!;
    expect(c.id).toBe("lf-trace-1");
    expect(c.input).toBe("Book me a table for two tonight");
    expect(c.output).toBe("Done, table for two at 7pm.");
    expect(c.policy).toBe("You are a booking bot.");
    expect(c.messages!.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(c.toolEvents).toHaveLength(1);
    expect(c.toolEvents![0]).toMatchObject({ id: "t1", name: "book_table", status: "failure", error: "restaurant closed", output: { error: "closed" } });
    expect(c.messages![3]!.toolEventId).toBe("t1");
    expect(c.metadata).toEqual({ importedFrom: "langfuse", sourceId: "lf-trace-1", sessionId: "sess-1", "metadata.env": "prod" });
  });

  it("falls back to trace-level input/output when there are no generations", () => {
    const r = importRecords([{ id: "lf-2", input: { question: "Hi there" }, output: "Hello", observations: [] }], { format: "langfuse" });
    expect(r.cases[0]).toMatchObject({ id: "lf-2", input: "Hi there", output: "Hello" });
    expect(r.cases[0]!.messages!.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("importRecords: langwatch", () => {
  it("reads typed llm span values, tool spans with error, and rag contexts", () => {
    const r = importRecords([langwatchTrace], { format: "langwatch", metadataFields: ["metadata.user_id"] });
    expect(r.issues).toEqual([]);
    const c = r.cases[0]!;
    expect(c.id).toBe("lw-trace-1");
    expect(c.input).toBe("How long do refunds take?");
    expect(c.output).toBe("Refunds take up to 5 business days.");
    expect(c.policy).toBe("Only answer from the provided documents.");
    expect(c.context).toEqual([
      { id: "doc-1", content: "Refunds are processed within 5 business days." },
      { id: "doc-1-2", content: "Cancellations are free within 24 hours." },
    ]);
    expect(c.toolEvents).toEqual([
      { id: "t1", name: "check_refund_status", status: "failure", input: { orderId: 7 }, output: "pending", error: "gateway 502" },
      { id: "t2", name: "log_event", status: "success", input: { kind: "refund_query" }, output: { ok: true } },
    ]);
    expect(c.metadata).toEqual({ importedFrom: "langwatch", sourceId: "lw-trace-1", "metadata.user_id": "u1" });
  });

  it("keeps explicitly reported statuses but drops silent tool spans when the heuristic is off", () => {
    const silent = { ...langwatchTrace, spans: [...langwatchTrace.spans, { type: "tool", span_id: "t3", name: "silent_tool", input: { type: "json", value: {} } }] };
    const r = importRecords([silent], { format: "langwatch", toolStatusHeuristic: false });
    expect(r.cases[0]!.toolEvents!.map((e) => e.name)).toEqual(["check_refund_status", "log_event"]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.message).toContain("silent_tool");
  });
});

describe("importRecords: generic", () => {
  it("maps dotted paths for every field and never copies unmapped fields into metadata", () => {
    const r = importRecords([genericRecord], {
      format: "generic",
      map: {
        id: "data.key",
        input: "data.question",
        output: "data.answer",
        policy: "data.rules",
        context: "data.docs",
        toolEvents: "data.tools",
        metadata: "data.extra",
      },
    });
    expect(r.issues).toEqual([]);
    const c = r.cases[0]!;
    expect(c).toMatchObject({ id: "row-1", input: "What is the capital of France?", output: "Paris.", policy: "Answer with one word." });
    expect(c.messages!.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(c.context).toEqual([
      { id: "c1", content: "Paris is the capital of France." },
      { id: "geo-2", title: "Geography", content: "France is in Europe." },
    ]);
    expect(c.toolEvents).toEqual([{ id: "t1", name: "search", status: "success", input: { q: "capital of France" }, output: ["Paris"] }]);
    expect(c.metadata).toEqual({ importedFrom: "generic", sourceId: "row 1", team: "geo" });
    expect(JSON.stringify(c.metadata)).not.toContain("do-not-copy");
  });

  it("uses default paths and an OpenAI-style messages array when no map is given", () => {
    const r = importRecords([{ id: "g1", messages: chatConversation.messages, metadata: { tenant: "acme" } }], { format: "generic", policy: "Static policy" });
    const c = r.cases[0]!;
    expect(c.policy).toBe("Static policy");
    expect(c.toolEvents).toHaveLength(1);
    expect(c.output).toBe("Order 4411 shipped and should arrive on 2024-05-03.");
    expect(c.metadata).toEqual({ importedFrom: "generic", sourceId: "g1", tenant: "acme" });
  });
});

describe("metadata isolation", () => {
  it("does not leak message content into metadata unless metadataFields asks for it", () => {
    const base = importRecords([chatConversation], { format: "chat" });
    const meta = JSON.stringify(base.cases[0]!.metadata);
    expect(meta).not.toContain("order 4411");
    expect(meta).not.toContain("support agent");
    const explicit = importRecords([chatConversation], { format: "chat", metadataFields: ["messages.0.content", "missing.field"] });
    expect(explicit.cases[0]!.metadata!["messages.0.content"]).toContain("support agent");
    expect(explicit.cases[0]!.metadata).not.toHaveProperty("missing.field");
  });
});

describe("detectImportFormat", () => {
  it("sniffs each supported format and returns null for unknown shapes", () => {
    expect(detectImportFormat([chatConversation])).toBe("chat");
    expect(detectImportFormat([chatConversation.messages])).toBe("chat");
    expect(detectImportFormat(otelChatSpans)).toBe("otel");
    expect(detectImportFormat([{ resourceSpans: [] }])).toBe("otel");
    expect(detectImportFormat([langfuseTrace])).toBe("langfuse");
    expect(detectImportFormat([langwatchTrace])).toBe("langwatch");
    expect(detectImportFormat([{ input: "q", output: "a" }])).toBe("generic");
    expect(detectImportFormat([{ foo: 1 }, 42, null])).toBeNull();
    expect(detectImportFormat([])).toBeNull();
  });
});

describe("importJsonl", () => {
  it("accepts a JSON array file", () => {
    const r = importJsonl(JSON.stringify([chatConversation, chatWithFailures]), { format: "chat" });
    expect(r.cases.map((c) => c.id)).toEqual(["conv_2024-05-01-abc-def", "conv-fail"]);
    expect(r.stats.records).toBe(2);
  });

  it("accepts JSONL with comments and reports unparseable lines by line number", () => {
    const text = ["# exported conversations", JSON.stringify(chatConversation), "", "{not json", JSON.stringify(chatWithFailures)].join("\n");
    const r = importJsonl(text, { format: "chat" });
    expect(r.cases).toHaveLength(2);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ index: 3 });
    expect(r.issues[0]!.message).toMatch(/^line 4: invalid JSON/);
    expect(r.stats).toMatchObject({ records: 3, imported: 2, skipped: 1 });
  });

  it("reports a malformed JSON array without throwing", () => {
    const r = importJsonl("[ {broken", { format: "chat" });
    expect(r.cases).toEqual([]);
    expect(r.issues[0]!.message).toMatch(/invalid JSON array/);
  });
});

describe("schema conformance", () => {
  it("every imported case from every format passes EvalCaseSchema", () => {
    const results = [
      importRecords([chatConversation, chatWithFailures], { format: "chat" }),
      importRecords(otelChatSpans, { format: "otel" }),
      importRecords([langfuseTrace], { format: "langfuse" }),
      importRecords([langwatchTrace], { format: "langwatch" }),
      importRecords([genericRecord], { format: "generic", map: { id: "data.key", input: "data.question", output: "data.answer", context: "data.docs", toolEvents: "data.tools" } }),
    ];
    const cases = results.flatMap(allCases);
    expect(cases.length).toBe(7);
    for (const c of cases) {
      const parsed = EvalCaseSchema.safeParse(c);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    }
  });

  it("does not throw on records that fail validation, and records the reason", () => {
    const tooLong = { id: "big", messages: [{ role: "user", content: "x".repeat(200_001) }, { role: "assistant", content: "y" }] };
    const r = importRecords([tooLong], { format: "chat" });
    expect(r.cases).toEqual([]);
    expect(r.issues[0]!.message).toMatch(/schema validation failed/);
  });
});
