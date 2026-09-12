import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolRequest, ListToolsRequest } from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { BrowserAdapter, McpConfig, PhaseRecord, ToolDescriptor, ToolInvocation, WaitConfig, WaitResult, serializeError } from "./types.js";

/** The narrow, real MCP SDK surface used by this adapter (the SDK expects request objects). */
export interface McpClientLike {
  connect(transport: StdioClientTransport): Promise<void>;
  close(): Promise<void>;
  listTools(params?: ListToolsRequest["params"]): Promise<{ tools?: ToolDescriptor[] }>;
  callTool(params: CallToolRequest["params"]): Promise<unknown>;
}
export type McpClientFactory = () => McpClientLike;
const now = () => new Date().toISOString();

/** The only module that knows MCP protocol/client details. */
export class ChromeDevtoolsMcpAdapter implements BrowserAdapter {
  private client?: McpClientLike;
  private transport?: StdioClientTransport;
  private tools: ToolDescriptor[] = [];
  private logStream?: WriteStream;

  constructor(private readonly config: McpConfig = {}, private readonly clientFactory: McpClientFactory = () => new Client({ name: "webui-step-agent", version: "0.1.0" }, { capabilities: {} })) {}

  async connect(): Promise<void> {
    const command = this.config.command ?? "npx";
    const args = this.config.args ?? defaultMcpArgs(process.env.WEBUI_HEADLESS === "1");
    const environment = buildMcpEnvironment(this.config.env);
    const inheritStderr = process.env.WEBUI_MCP_STDERR === "inherit";
    this.transport = new StdioClientTransport({ command, args, env: environment, stderr: inheritStderr ? "inherit" : "pipe" });
    if (!inheritStderr) {
      const logPath = resolve(process.env.WEBUI_MCP_LOG_PATH ?? "artifacts/mcp-stderr.log");
      mkdirSync(dirname(logPath), { recursive: true });
      this.logStream = createWriteStream(logPath, { flags: "a", encoding: "utf8" });
      this.transport.stderr?.pipe(this.logStream, { end: false });
    }
    this.client = this.clientFactory();
    await this.client.connect(this.transport);
  }

  async disconnect(): Promise<void> {
    if (this.client) await this.client.close();
    this.logStream?.end();
    this.logStream = undefined;
    this.client = undefined;
    this.transport = undefined;
  }
  async listTools(): Promise<ToolDescriptor[]> {
    if (!this.client) throw new Error("MCP adapter is not connected");
    const response = await this.client.listTools();
    this.tools = (response.tools ?? []).map((tool) => ({ ...tool, name: tool.name }));
    return this.tools;
  }

  async setup(startUrl?: string): Promise<PhaseRecord | undefined> {
    if (!startUrl) return undefined;
    const startedAt = now();
    const toolName = this.config.navigationTool ?? this.findTool(["navigate_page", "navigate", "open_url"]);
    if (!toolName) return { phase: "setup", startedAt, finishedAt: now(), toolCalls: [], error: serializeError(new Error("No navigation capability was discovered for startUrl setup.")) };
    const invocation = await this.callTool(toolName, { url: startUrl });
    return { phase: "setup", startedAt, finishedAt: now(), raw: invocation.result, toolCalls: [invocation], error: invocation.error, evidence: [{ kind: "tool", value: invocation.result, sourcePhase: "setup" }] };
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolInvocation> {
    if (!this.client) throw new Error("MCP adapter is not connected");
    const startedAt = now();
    try {
      const result = await this.client.callTool({ name: toolName, arguments: args });
      const error = mcpToolResultError(result);
      return { toolName, arguments: args, startedAt, finishedAt: now(), result, error };
    } catch (error) { return { toolName, arguments: args, startedAt, finishedAt: now(), error: serializeError(error) }; }
  }

  async captureShot(phase: "takeShotBefore" | "takeShotImmediate" | "takeShotSettled"): Promise<PhaseRecord> {
    const startedAt = now();
    const snapshotTool = this.config.snapshotTool ?? this.findTool(["take_snapshot", "snapshot", "get_snapshot"]);
    const screenshotTool = this.config.screenshotTool;
    const toolCalls: ToolInvocation[] = [];
    const raw: { snapshot?: unknown; screenshot?: unknown } = {};
    if (snapshotTool) { const invocation = await this.callTool(snapshotTool, {}); toolCalls.push(invocation); raw.snapshot = invocation.result; }
    else if (!screenshotTool) return { phase, startedAt, finishedAt: now(), toolCalls: [], error: serializeError(new Error("No DOM snapshot capability was discovered. Configure snapshotTool or screenshotTool.")) };
    if (screenshotTool && screenshotTool !== snapshotTool) { const invocation = await this.callTool(screenshotTool, {}); toolCalls.push(invocation); raw.screenshot = invocation.result; }
    const errors = toolCalls.filter((call) => call.error).map((call) => call.error!);
    return { phase, startedAt, finishedAt: now(), raw, toolCalls, error: errors[0], evidence: [...(raw.snapshot === undefined ? [] : [{ kind: "dom" as const, value: raw.snapshot, sourcePhase: phase }]), ...(raw.screenshot === undefined ? [] : [{ kind: "screenshot" as const, value: raw.screenshot, sourcePhase: phase }])] };
  }

  async waitForStability(config: WaitConfig = {}): Promise<WaitResult> {
    const timeoutMs = config.timeoutMs ?? 10_000, pollIntervalMs = config.pollIntervalMs ?? 300, stablePolls = config.stablePolls ?? 2;
    const started = Date.now(), observations: PhaseRecord[] = [], toolCalls: ToolInvocation[] = [];
    let previousFingerprint: string | undefined, consecutive = 0, polls = 0;
    const waitTool = this.config.waitTool ? this.tools.find((tool) => tool.name === this.config.waitTool) : undefined;
    if (waitTool && acceptsEmptyObject(waitTool.inputSchema)) {
      const invocation = await this.callTool(waitTool.name, {}); toolCalls.push(invocation);
      if (!invocation.error) return { status: "stable", elapsedMs: Date.now() - started, polls: 1, observations, toolCalls };
    }
    while (Date.now() - started <= timeoutMs) {
      polls += 1;
      const observation = await this.captureShot("takeShotSettled"); observations.push(observation);
      const fingerprint = canonicalSerialize(observation.raw);
      consecutive = fingerprint === previousFingerprint ? consecutive + 1 : 1; previousFingerprint = fingerprint;
      if (consecutive >= stablePolls) return { status: "stable", elapsedMs: Date.now() - started, polls, observations, toolCalls };
      const remaining = Math.max(0, timeoutMs - (Date.now() - started));
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
    }
    return { status: "timeout", elapsedMs: Date.now() - started, polls, observations, toolCalls, reason: "Stability timeout." };
  }

  private findTool(names: string[]): string | undefined { return names.find((name) => this.tools.some((tool) => tool.name === name)); }
}

export function defaultMcpArgs(headless = false): string[] {
  const args = ["-y", "chrome-devtools-mcp@latest", "--isolated"];
  if (headless) args.push("--headless");
  return args;
}

function mcpToolResultError(result: unknown): ReturnType<typeof serializeError> | undefined {
  if (!result || typeof result !== "object" || !(result as { isError?: unknown }).isError) return undefined;
  const content = (result as { content?: unknown }).content;
  const text = Array.isArray(content)
    ? content.map((item) => item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : undefined).filter(Boolean).join(" ")
    : "";
  return { name: "McpToolError", message: text || "MCP tool returned isError=true." };
}

/** Build a writable default for npx while preserving explicit user configuration. */
export function buildMcpEnvironment(overrides: Record<string, string> = {}, baseEnvironment: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnvironment)) if (value !== undefined) environment[key] = value;
  if (!Object.prototype.hasOwnProperty.call(environment, "NPM_CONFIG_CACHE")) environment.NPM_CONFIG_CACHE = resolve(process.cwd(), ".npm-cache");
  Object.assign(environment, overrides);
  return environment;
}

function acceptsEmptyObject(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const value = schema as { type?: unknown; required?: unknown };
  return (value.type === "object" || value.type === undefined) && (!Array.isArray(value.required) || value.required.length === 0);
}

/** Stable serialization that sorts object keys recursively and preserves array order. */
export function canonicalSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) { const result = `[${value.map((item) => canonicalSerialize(item, seen)).join(",")}]`; seen.delete(value); return result; }
  const object = value as Record<string, unknown>;
  const result = `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalSerialize(object[key], seen)}`).join(",")}}`;
  seen.delete(value); return result;
}
