import { describe, expect, it } from "vitest";
import { ChromeDevtoolsMcpAdapter, McpClientLike, buildMcpEnvironment, canonicalSerialize, defaultMcpArgs } from "../src/mcp-adapter.js";

class FakeClient implements McpClientLike {
  requests: unknown[] = [];
  toolError = false;
  async connect() {}
  async close() {}
  async listTools() { return { tools: [
    { name: "take_snapshot", inputSchema: { type: "object", properties: {} } },
    { name: "wait_for", inputSchema: { type: "object", required: ["timeout"] } },
    { name: "navigate_page", inputSchema: { type: "object", required: ["url"] } },
  ] }; }
  async callTool(params: unknown) {
    this.requests.push(params);
    return this.toolError ? { isError: true, content: [{ type: "text", text: "profile conflict" }] } : { content: [{ type: "text", text: "ok" }] };
  }
}

describe("ChromeDevtoolsMcpAdapter", () => {
  it("keeps visible isolated Chrome by default and adds headless only when requested", () => {
    expect(defaultMcpArgs()).toEqual(["-y", "chrome-devtools-mcp@1.7.0", "--isolated"]);
    expect(defaultMcpArgs(true)).toEqual(["-y", "chrome-devtools-mcp@1.7.0", "--isolated", "--headless"]);
  });

  it("uses a project-local npm cache unless explicitly overridden", () => {
    const environment = buildMcpEnvironment({ NPM_CONFIG_CACHE: "custom-cache" });
    expect(environment.NPM_CONFIG_CACHE).toBe("custom-cache");
    expect(buildMcpEnvironment({}, { NPM_CONFIG_CACHE: "existing-cache" }).NPM_CONFIG_CACHE).toBe("existing-cache");
    const defaultEnvironment = buildMcpEnvironment({}, {});
    expect(defaultEnvironment.NPM_CONFIG_CACHE).toContain(".npm-cache");
  });

  it("uses the MCP tools/call request object shape and records setup", async () => {
    const fake = new FakeClient();
    const adapter = new ChromeDevtoolsMcpAdapter({}, () => fake);
    await adapter.connect();
    await adapter.listTools();
    const setup = await adapter.setup("https://example.test");
    await adapter.callTool("click", { uid: "1" });
    expect(fake.requests).toEqual([
      { name: "navigate_page", arguments: { url: "https://example.test" } },
      { name: "click", arguments: { uid: "1" } },
    ]);
    expect(setup?.phase).toBe("setup");
    await adapter.disconnect();
  });

  it("treats an MCP isError result as a failed setup while preserving raw result", async () => {
    const fake = new FakeClient();
    fake.toolError = true;
    const adapter = new ChromeDevtoolsMcpAdapter({}, () => fake);
    await adapter.connect();
    await adapter.listTools();
    const setup = await adapter.setup("https://example.test");
    expect(setup?.error?.name).toBe("McpToolError");
    expect(setup?.error?.message).toBe("profile conflict");
    expect((setup?.raw as { isError?: boolean }).isError).toBe(true);
    expect(setup?.toolCalls[0].result).toEqual(expect.objectContaining({ isError: true }));
    await adapter.disconnect();
  });

  it("does not call a wait tool when its discovered schema has required inputs", async () => {
    const fake = new FakeClient();
    const adapter = new ChromeDevtoolsMcpAdapter({ waitTool: "wait_for" }, () => fake);
    await adapter.connect();
    await adapter.listTools();
    const result = await adapter.waitForStability({ timeoutMs: 100, pollIntervalMs: 1, stablePolls: 2 });
    expect(result.status).toBe("stable");
    expect(fake.requests.every((request) => (request as { name: string }).name === "take_snapshot")).toBe(true);
    await adapter.disconnect();
  });

  it("keeps DOM snapshot semantics and canonicalizes nested object keys", async () => {
    const fake = new FakeClient();
    const adapter = new ChromeDevtoolsMcpAdapter({ screenshotTool: "take_snapshot" }, () => fake);
    await adapter.connect();
    await adapter.listTools();
    const shot = await adapter.captureShot("takeShotBefore");
    expect(shot.evidence?.[0].kind).toBe("dom");
    expect(canonicalSerialize({ b: { z: 1, a: 2 }, a: 3 })).toBe('{"a":3,"b":{"a":2,"z":1}}');
    await adapter.disconnect();
  });

  it("normalizes snapshot-style uid values like uid=5 to 5 before calling MCP", async () => {
    const fake = new FakeClient();
    const adapter = new ChromeDevtoolsMcpAdapter({}, () => fake);
    await adapter.connect();
    await adapter.listTools();
    await adapter.callTool("click", { uid: "uid=5" });
    await adapter.callTool("fill_form", { elements: [{ uid: "uid=9", value: "x" }] });
    const calls = fake.requests as Array<{ name: string; arguments: Record<string, unknown> }>;
    expect(calls[0].arguments.uid).toBe("5");
    expect((calls[1].arguments.elements as Array<{ uid: string }>)[0].uid).toBe("9");
    await adapter.disconnect();
  });
});
