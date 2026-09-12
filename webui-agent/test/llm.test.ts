import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatCompletionsClient,
  LLMUsageTracker,
  ResponsesClient,
  createLLMClient,
  extractResponsesText,
  resolveLLMConfig,
  toChatFn,
  type ChatMessage,
} from "../src/llm.js";

const fetchMock = vi.fn();
const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatCompletionsClient", () => {
  it("POSTs to /chat/completions, returns content and parses usage", async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    const client = new ChatCompletionsClient({
      apiKey: "k", model: "m", baseUrl: "https://example.test/v1", maxTokens: 1234, extraBody: { thinking: { type: "disabled" } },
    });
    const result = await client.chat(messages);
    expect(result.content).toBe("pong");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "m", messages, temperature: 0, max_tokens: 1234, thinking: { type: "disabled" } });
  });

  it("throws when the response carries no assistant content", async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [] }));
    const client = new ChatCompletionsClient({ apiKey: "k" });
    await expect(client.chat(messages)).rejects.toThrow("no assistant content");
  });

  it("throws on a non-OK HTTP status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" } as unknown as Response);
    const client = new ChatCompletionsClient({ apiKey: "k" });
    await expect(client.chat(messages)).rejects.toThrow("HTTP 401");
  });
});

describe("ResponsesClient", () => {
  it("POSTs to /responses with input and extracts output_text and usage", async () => {
    fetchMock.mockResolvedValue(okResponse({
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: "hello" }] },
      ],
      usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    }));
    const client = new ResponsesClient({ apiKey: "k", model: "gpt-x", baseUrl: "https://example.test/v1", maxTokens: 2048 });
    const result = await client.chat(messages);
    expect(result.content).toBe("hello");
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/responses");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "gpt-x", input: messages, temperature: 0, max_output_tokens: 2048 });
  });

  it("extracts output_text but skips non-message items", () => {
    expect(extractResponsesText([{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: "a" }, { type: "output_text", text: "b" }] }])).toBe("ab");
    expect(extractResponsesText([{ type: "reasoning", summary: [] }])).toBe("");
    expect(extractResponsesText([{ type: "message", text: "plain" }])).toBe("plain");
  });

  it("throws when no message text exists", async () => {
    fetchMock.mockResolvedValue(okResponse({ output: [] }));
    const client = new ResponsesClient({ apiKey: "k" });
    await expect(client.chat(messages)).rejects.toThrow("no assistant text");
  });
});

describe("LLMUsageTracker", () => {
  it("accumulates tokens and call count, ignoring empty records", () => {
    const tracker = new LLMUsageTracker();
    tracker.record({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
    tracker.record({ promptTokens: 4, completionTokens: 5, totalTokens: 9 });
    tracker.record(undefined);
    expect(tracker.snapshot()).toEqual({ calls: 2, promptTokens: 5, completionTokens: 7, totalTokens: 12 });
  });

  it("records usage through toChatFn into a shared tracker", async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: "hi" } }], usage: { total_tokens: 7 } }));
    const tracker = new LLMUsageTracker();
    const chat = toChatFn(new ChatCompletionsClient({ apiKey: "k" }), tracker);
    await expect(chat([{ role: "user", content: "x" }])).resolves.toBe("hi");
    expect(tracker.snapshot()).toEqual({ calls: 1, promptTokens: 0, completionTokens: 0, totalTokens: 7 });
  });
});

describe("createLLMClient", () => {
  it("selects the implementation by protocol", () => {
    expect(createLLMClient({ apiKey: "k" })).toBeInstanceOf(ChatCompletionsClient);
    expect(createLLMClient({ protocol: "responses", apiKey: "k" })).toBeInstanceOf(ResponsesClient);
  });

  it("rejects unknown protocols", () => {
    expect(() => createLLMClient({ protocol: "nope" as never, apiKey: "k" })).toThrow("Unsupported LLM protocol");
  });
});

describe("resolveLLMConfig reasoning effort", () => {
  const key = "LLM_REASONING_EFFORT";
  afterEach(() => {
    delete process.env[key];
  });

  it("maps high to adaptive thinking for chat_completions", () => {
    process.env[key] = "high";
    expect(resolveLLMConfig("k").extraBody).toEqual({ reasoning_split: true, thinking: { type: "adaptive" } });
  });

  it("maps low to disabled thinking for chat_completions", () => {
    process.env[key] = "low";
    expect(resolveLLMConfig("k").extraBody).toEqual({ reasoning_split: true, thinking: { type: "disabled" } });
  });

  it("maps effort to reasoning for responses", () => {
    process.env[key] = "high";
    expect(resolveLLMConfig("k", { protocol: "responses" }).extraBody).toEqual({ reasoning: { effort: "high" } });
  });

  it("defaults chat_completions to disabled thinking without the env var", () => {
    expect(resolveLLMConfig("k").extraBody).toEqual({ reasoning_split: true, thinking: { type: "disabled" } });
  });
});
