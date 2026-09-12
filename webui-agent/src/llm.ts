/** 统一 LLM 调用接口。

把不同协议（Chat Completions / Responses）归一成一个稳定契约：

    messages: ChatMessage[]
    ->  LLMClient.chat(messages)
    ->  Promise<string>（助手回复的纯文本）

上层 Provider（Think / Judge / CaseAgent / CaseCompiler）只依赖该契约，
不感知具体协议或供应商。配置项可通过 `LLM_PROTOCOL` / `LLM_BASE_URL` /
`LLM_MODEL` / `LLM_API_KEY` 等环境变量覆盖，便于切协议而不改业务代码。
*/

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 上层 Provider 统一使用的调用函数签名。 */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export type LLMProtocol = "chat_completions" | "responses";

export interface LLMClientConfig {
  /** 默认 chat_completions。 */
  protocol?: LLMProtocol;
  apiKey: string;
  model?: string;
  /** 供应商 API 根路径（含 /v1）。 */
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /** 透传到请求体的额外字段，如 reasoning / thinking / reasoning_split 等。 */
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** 协议无关的 LLM 客户端契约。 */
export interface LLMClient {
  readonly protocol: LLMProtocol;
  readonly model: string;
  chat(messages: ChatMessage[]): Promise<string>;
}

export const CHAT_COMPLETIONS_DEFAULT_BASE_URL = "https://api.minimaxi.com/v1";
export const RESPONSES_DEFAULT_BASE_URL = "https://api.openai.com/v1";

function buildHeaders(config: LLMClientConfig): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${config.apiKey}`, ...config.headers };
}

/** OpenAI Chat Completions 协议客户端（兼容 MiniMax / DeepSeek 等 OpenAI 兼容端点）。 */
export class ChatCompletionsClient implements LLMClient {
  readonly protocol = "chat_completions" as const;
  readonly model: string;

  constructor(private readonly config: LLMClientConfig) {
    this.model = config.model ?? "MiniMax-M3";
  }

  get baseUrl(): string {
    return this.config.baseUrl ?? CHAT_COMPLETIONS_DEFAULT_BASE_URL;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(this.config),
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.config.temperature ?? 0,
        max_tokens: this.config.maxTokens ?? 4096,
        ...this.config.extraBody,
      }),
    });
    if (!response.ok) throw new Error(`LLM chat_completions failed: HTTP ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) throw new Error("LLM chat_completions returned no assistant content.");
    return content;
  }
}

/** OpenAI Responses 协议客户端。 */
export class ResponsesClient implements LLMClient {
  readonly protocol = "responses" as const;
  readonly model: string;

  constructor(private readonly config: LLMClientConfig) {
    this.model = config.model ?? "gpt-5";
  }

  get baseUrl(): string {
    return this.config.baseUrl ?? RESPONSES_DEFAULT_BASE_URL;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: buildHeaders(this.config),
      body: JSON.stringify({
        model: this.model,
        input: messages,
        temperature: this.config.temperature ?? 0,
        max_output_tokens: this.config.maxTokens ?? 4096,
        ...this.config.extraBody,
      }),
    });
    if (!response.ok) throw new Error(`LLM responses failed: HTTP ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as { output?: unknown };
    const text = extractResponsesText(payload.output);
    if (!text) throw new Error("LLM responses returned no assistant text.");
    return text;
  }
}

/** 从 Responses 协议的 output 数组里提取助手文本（跳过 reasoning 等非 message 项）。 */
export function extractResponsesText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; content?: unknown; text?: unknown };
    if (record.type !== "message") continue;
    if (Array.isArray(record.content)) {
      for (const part of record.content) {
        if (!part || typeof part !== "object") continue;
        const contentPart = part as { type?: unknown; text?: unknown };
        if ((contentPart.type === "output_text" || contentPart.type === "text") && typeof contentPart.text === "string") {
          parts.push(contentPart.text);
        }
      }
    } else if (typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.join("");
}

/** 按协议选择客户端实现。 */
export function createLLMClient(config: LLMClientConfig): LLMClient {
  switch (config.protocol ?? "chat_completions") {
    case "chat_completions":
      return new ChatCompletionsClient(config);
    case "responses":
      return new ResponsesClient(config);
    default:
      throw new Error(`Unsupported LLM protocol: ${String(config.protocol)}`);
  }
}

/** 环境变量解析后的客户端配置。

  优先级：显式环境变量（LLM_PROTOCOL / LLM_BASE_URL / LLM_MODEL / LLM_API_KEY）
  高于调用方传入的 overrides，高于协议默认值。apiKey 必填（可来自环境变量）。
  LLM_REASONING_EFFORT=high|low 控制思考等级：
    chat_completions: high -> thinking.type=adaptive，low -> thinking.type=disabled
    responses:        high/low -> reasoning.effort
*/
export function resolveLLMConfig(apiKey: string, overrides: Partial<LLMClientConfig> = {}): LLMClientConfig {
  const protocol = (process.env.LLM_PROTOCOL as LLMProtocol | undefined) ?? overrides.protocol ?? "chat_completions";
  const reasoningEffort = (process.env.LLM_REASONING_EFFORT ?? "").toLowerCase() as "" | "low" | "high";
  return {
    protocol,
    apiKey: process.env.LLM_API_KEY ?? process.env.MINIMAX_API_KEY ?? process.env.OPENAI_API_KEY ?? apiKey,
    model: process.env.LLM_MODEL ?? overrides.model ?? (protocol === "responses" ? "gpt-5" : "MiniMax-M3"),
    baseUrl: process.env.LLM_BASE_URL ?? overrides.baseUrl ?? (protocol === "responses" ? RESPONSES_DEFAULT_BASE_URL : CHAT_COMPLETIONS_DEFAULT_BASE_URL),
    temperature: overrides.temperature,
    maxTokens: overrides.maxTokens,
    extraBody: overrides.extraBody ?? buildDefaultExtraBody(protocol, reasoningEffort),
    headers: overrides.headers,
  };
}

function buildDefaultExtraBody(protocol: LLMProtocol, effort: "" | "low" | "high"): Record<string, unknown> | undefined {
  if (protocol === "chat_completions") {
    return { reasoning_split: true, thinking: { type: effort === "high" ? "adaptive" : "disabled" } };
  }
  if (protocol === "responses" && effort !== "") {
    return { reasoning: { effort } };
  }
  return undefined;
}

/** 把客户端转成上层 Provider 使用的 ChatFn。 */
export function toChatFn(client: LLMClient): ChatFn {
  return (messages) => client.chat(messages);
}
