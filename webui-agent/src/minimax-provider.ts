import type {
  CaseAgentProvider,
  CaseCompilerProvider,
  CaseDecision,
  CaseModelContext,
  JudgeContext,
  JudgeDecision,
  JudgeProvider,
  OperationDecision,
  ThinkContext,
  ThinkProvider,
} from "./types.js";

const API_URL = "https://api.minimaxi.com/v1/chat/completions";
const MODEL = "MiniMax-M3";
const DEFAULT_API_KEY = "sk-cp-aXV4X8TlWZeR3E1hpIaPtjEFnafrpbEi_IMlm6NhSY_0-CQHOV5WupxDkg4LV2JXfB3sO_AoGodPCkQ6irIC7PuIoxC29MVKqG70AYz_hQ1VIjNDgSpCvOo";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export class MiniMaxChatClient {
  constructor(private readonly apiKey: string) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0,
        max_tokens: 4096,
        reasoning_split: true,
        thinking: { type: "disabled" },
      }),
    });
    if (!response.ok) throw new Error(`MiniMax request failed: HTTP ${response.status} ${await response.text()}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("MiniMax returned no assistant content.");
    return content;
  }
}

export class MiniMaxThinkProvider implements ThinkProvider {
  constructor(private readonly chat: ChatFn) {}

  async think(context: ThinkContext): Promise<OperationDecision> {
    const response = await this.chat([
      { role: "system", content: THINK_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ step: context.input.step, pageBefore: context.before.raw, tools: context.capabilities }) },
    ]);
    const parsed = parseJson<OperationDecision>(response);
    validateThinkDecision(parsed, context);
    return { ...parsed, raw: { model: MODEL, response } };
  }
}

export class MiniMaxJudgeProvider implements JudgeProvider {
  constructor(private readonly chat: ChatFn) {}

  async judge(context: JudgeContext): Promise<JudgeDecision> {
    const response = await this.chat([
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ step: context.input.step, expected: context.input.config?.expected, operationSucceeded: context.operationSucceeded, waitTimedOut: context.waitTimedOut, phases: context.phases }) },
    ]);
    const parsed = parseJson<JudgeDecision>(response);
    if (!(["passed", "failed", "blocked"] as const).includes(parsed.status)) throw new Error("MiniMax judge returned an invalid status.");
    if (typeof parsed.reason !== "string" || !parsed.reason) throw new Error("MiniMax judge returned no reason.");
    return { ...parsed, raw: { model: MODEL, response } };
  }
}

export class MiniMaxCaseAgentProvider implements CaseAgentProvider {
  constructor(private readonly chat: ChatFn) {}

  async decide(context: CaseModelContext): Promise<CaseDecision> {
    const response = await this.chat([
      { role: "system", content: CASE_DECIDE_PROMPT },
      { role: "user", content: JSON.stringify(compactCaseContext(context)) },
    ]);
    const decision = parseJson<CaseDecision>(response);
    if (!(["operation", "observe", "passed", "failed", "blocked"] as const).includes(decision.kind)) throw new Error("MiniMax case decision returned an invalid kind.");
    if (!decision.reason) throw new Error("MiniMax case decision returned no reason.");
    if (decision.kind === "operation") {
      if (!decision.operation) throw new Error("MiniMax case decision returned no operation.");
      if (!context.capabilities.some((tool) => tool.name === decision.operation?.toolName)) throw new Error(`MiniMax selected an unavailable tool: ${decision.operation.toolName}`);
    }
    return { ...decision, raw: { model: MODEL, response } };
  }
}

export class MiniMaxCaseCompilerProvider implements CaseCompilerProvider {
  constructor(private readonly chat: ChatFn) {}

  async compile(description: string): Promise<import("./types.js").TestCaseDefinition> {
    const response = await this.chat([
      { role: "system", content: CASE_COMPILE_PROMPT },
      { role: "user", content: description },
    ]);
    const result = parseJson<import("./types.js").TestCaseDefinition>(response);
    if (!result.name) result.name = description.slice(0, 40);
    result.description = description;
    if (!(["operation_succeeded", "state_reached"] as const).includes(result.completion?.mode)) throw new Error("MiniMax case compiler returned an invalid completion mode.");
    if (!Array.isArray(result.completion.success) || result.completion.success.length === 0) throw new Error("MiniMax case compiler returned no success condition.");
    if (!Array.isArray(result.completion.failure)) result.completion.failure = [];
    if (!(result.timing?.expectedMs > 0) || !(result.timing?.timeoutMs >= result.timing.expectedMs)) throw new Error("MiniMax case compiler returned invalid timing.");
    result.limits = { maxActions: result.limits?.maxActions ?? 12, maxNoProgress: result.limits?.maxNoProgress ?? 4 };
    if (result.completion.mode === "operation_succeeded" && (!Array.isArray(result.requiredOperations) || result.requiredOperations.length === 0)) throw new Error("Operation-only case requires requiredOperations.");
    if (result.requiredOperations) {
      const ids = result.requiredOperations.map((item) => item.id);
      if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("MiniMax case compiler returned invalid operation IDs.");
    }
    return result;
  }
}

export function createMiniMaxProviders(apiKey = process.env.MINIMAX_API_KEY ?? DEFAULT_API_KEY): { thinker: ThinkProvider; judge: JudgeProvider } {
  const client = new MiniMaxChatClient(apiKey);
  const chat = client.chat.bind(client);
  return { thinker: new MiniMaxThinkProvider(chat), judge: new MiniMaxJudgeProvider(chat) };
}

export function createMiniMaxCaseAgent(apiKey = process.env.MINIMAX_API_KEY ?? DEFAULT_API_KEY): CaseAgentProvider {
  const client = new MiniMaxChatClient(apiKey);
  return new MiniMaxCaseAgentProvider(client.chat.bind(client));
}

export function createMiniMaxCaseCompiler(apiKey = process.env.MINIMAX_API_KEY ?? DEFAULT_API_KEY): CaseCompilerProvider {
  const client = new MiniMaxChatClient(apiKey);
  return new MiniMaxCaseCompilerProvider(client.chat.bind(client));
}

const THINK_SYSTEM_PROMPT = `You operate one Web UI test step using discovered MCP tools.
Return JSON only, with one of these shapes:
{"kind":"operation","reason":"...","operation":{"toolName":"exact discovered name","arguments":{}}}
{"kind":"none","reason":"..."}
{"kind":"blocked","reason":"..."}
Choose at most one tool call. Never invent a tool name or argument outside its inputSchema. Use the DOM snapshot identifiers when available.`;

const JUDGE_SYSTEM_PROMPT = `Judge one Web UI test step from raw recorded evidence.
Return JSON only: {"status":"passed|failed|blocked","reason":"concise evidence-based reason"}.
passed means the requested outcome is visibly established. failed means evidence contradicts it or the operation failed. blocked means evidence is insufficient or execution could not complete. Do not assume facts absent from evidence.`;

const CASE_DECIDE_PROMPT = `You drive one business-level Web UI test case over multiple controlled turns.
Return JSON only using one shape:
{"kind":"operation","reason":"...","completes":["required_operation_id"],"operation":{"toolName":"exact discovered MCP tool","arguments":{}}}
{"kind":"observe","reason":"...","feedbackMode":"short|long"}
{"kind":"passed","reason":"explicit success evidence"}
{"kind":"failed","reason":"explicit failure evidence"}
{"kind":"blocked","reason":"..."}
First obey completion.mode and the structured pendingOperations list. The currentPage field always contains the latest fresh DOM snapshot. When choosing an operation, completes must contain the exact IDs from pendingOperations that this single MCP call will complete; one batch tool may complete multiple IDs. Never repeat IDs in completedOperationIds. For operation_succeeded, execute pending operations until none remain; do not wait for or invent an additional UI state, and NEVER return observe. For state_reached, finish required operations, then check completion.success/failure and observe only while the requested state is pending. Return failed only when current evidence explicitly satisfies a listed failure condition. Not yet successful is NOT failure. Do not observe merely to confirm a synchronous action again. Never invent tools, schema fields, or operation IDs. Use feedbackMode=long only for genuinely long jobs, considering expectedMs.`;

const CASE_COMPILE_PROMPT = `Compile one natural-language Web UI instruction into a stable test case contract. Return JSON only:
{"name":"...","description":"...","requiredOperations":[{"id":"stable_snake_case_id","description":"one requested operation"}],"completion":{"mode":"operation_succeeded|state_reached","success":["..."],"failure":["..."]},"timing":{"expectedMs":5000,"timeoutMs":30000},"limits":{"maxActions":12,"maxNoProgress":4}}
Always decompose every explicitly requested UI operation into requiredOperations with stable unique IDs. Combine closely related field inputs only if one batch fill_form call can perform them; keep submit/click as a separate operation. Choose operation_succeeded when the user only asks to perform operations and does not request checking, waiting for, or reaching a resulting state. Choose state_reached only when the user explicitly asks to wait/check/verify/until/appear/navigate/complete, or names a desired business result. Describe that exact requested state in success. Infer short realistic timing; use long timing only for genuinely long jobs. Do not add a page-state requirement to an operation-only instruction.`;

function compactCaseContext(context: CaseModelContext): Record<string, unknown> {
  return {
    testCase: context.testCase,
    currentPage: compactBrowserEvidence(context.current.raw),
    currentError: context.current.error,
    tools: context.capabilities,
    recentHistory: context.history,
    actionCount: context.actionCount,
    elapsedMs: context.elapsedMs,
    remainingMs: context.remainingMs,
    completedOperationIds: context.completedOperationIds,
    pendingOperations: context.pendingOperations,
  };
}

function compactBrowserEvidence(value: unknown): unknown {
  const source = JSON.stringify(value)
    .replace(/data:image\/[^"]+/gi, "[data-image omitted]")
    .replace(/StaticText \\\"[^\\\"]{1200,}\\\"/g, "StaticText \\\"[oversized text omitted]\\\"");
  const limit = 50_000;
  const compacted = source.length > limit ? `${source.slice(0, limit)}...[browser evidence truncated]` : source;
  try { return JSON.parse(compacted); } catch { return compacted; }
}

function validateThinkDecision(decision: OperationDecision, context: ThinkContext): void {
  if (!(["operation", "none", "blocked"] as const).includes(decision.kind)) throw new Error("MiniMax think returned an invalid kind.");
  if (typeof decision.reason !== "string" || !decision.reason) throw new Error("MiniMax think returned no reason.");
  if (decision.kind !== "operation") return;
  if (!decision.operation || typeof decision.operation.toolName !== "string") throw new Error("MiniMax think returned no operation.");
  if (!context.capabilities.some((tool) => tool.name === decision.operation?.toolName)) throw new Error(`MiniMax selected an unavailable tool: ${decision.operation.toolName}`);
  if (decision.operation.arguments !== undefined && (typeof decision.operation.arguments !== "object" || Array.isArray(decision.operation.arguments))) throw new Error("MiniMax operation arguments must be an object.");
}

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned) as T; }
  catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { /* report below */ }
    }
    throw new Error(`MiniMax returned invalid JSON: ${cleaned.slice(0, 300)}`);
  }
}
