import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatCompletionsClient,
  ResponsesClient,
  createLLMClient,
  extractResponsesText,
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
  it("POSTs to /chat/completions and returns assistant content", async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: "pong" } }] }));
    const client = new ChatCompletionsClient({
      apiKey: "k", model: "m", baseUrl: "https://example.test/v1", maxTokens: 1234, extraBody: { thinking: { type: "disabled" } },
    });
    await expect(client.chat(messages)).resolves.toBe("pong");
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
  it("POSTs to /responses with input and extracts output_text", async () => {
    fetchMock.mockResolvedValue(okResponse({
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: "hello" }] },
      ],
    }));
    const client = new ResponsesClient({ apiKey: "k", model: "gpt-x", baseUrl: "https://example.test/v1", maxTokens: 2048 });
    await expect(client.chat(messages)).resolves.toBe("hello");
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

describe("createLLMClient", () => {
  it("selects the implementation by protocol", () => {
    expect(createLLMClient({ apiKey: "k" })).toBeInstanceOf(ChatCompletionsClient);
    expect(createLLMClient({ protocol: "responses", apiKey: "k" })).toBeInstanceOf(ResponsesClient);
  });

  it("rejects unknown protocols", () => {
    expect(() => createLLMClient({ protocol: "nope" as never, apiKey: "k" })).toThrow("Unsupported LLM protocol");
  });
});
