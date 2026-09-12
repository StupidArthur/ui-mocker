import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { ChromeDevtoolsMcpAdapter } from "./mcp-adapter.js";
import { JsonlArtifactSink } from "./artifact-store.js";
import { createMiniMaxCaseAgent, createMiniMaxCaseCompiler, createMiniMaxProviders } from "./minimax-provider.js";
import { Session } from "./session.js";
import type { TestCaseDefinition } from "./types.js";

export async function runRepl(): Promise<void> {
  const { thinker, judge } = createMiniMaxProviders();
  const caseAgent = createMiniMaxCaseAgent();
  const caseCompiler = createMiniMaxCaseCompiler();
  const sessionId = process.env.WEBUI_SESSION_ID ?? randomUUID();
  const artifactPath = process.env.WEBUI_ARTIFACT_PATH ?? `artifacts/session-${sessionId}.jsonl`;
  const session = new Session({ adapter: new ChromeDevtoolsMcpAdapter(), thinker, judge, caseAgent, sink: new JsonlArtifactSink(artifactPath), sessionId });
  const rl = createInterface({ input: stdin, output: stdout, terminal: Boolean(process.stdout.isTTY) });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await session.close();
    rl.close();
  };
  process.once("SIGINT", () => { void close(); });

  try {
    await session.start();
    stdout.write(`WebUI step agent connected. session=${session.sessionId}\nArtifact: ${artifactPath}\nType /help for commands.\n`);
    while (!closing) {
      const line = (await rl.question("> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      if (line === "/help") { printHelp(); continue; }
      if (line === "/status") { stdout.write(`session=${session.sessionId} state=${session.status} steps=${session.nextSequence - 1}\n`); continue; }
      if (line.startsWith("/open ")) {
        const url = line.slice(6).trim();
        if (!url) { stdout.write("Usage: /open <url>\n"); continue; }
        const setup = await session.open(url);
        stdout.write(setup.error ? `setup blocked: ${setup.error.message}\n` : `opened ${url}\n`);
        continue;
      }
      if (line.startsWith("/run ")) {
        const path = line.slice(5).trim();
        if (!path) { stdout.write("Usage: /run <case.yaml|case.json>\n"); continue; }
        try {
          const testCase = await loadCase(path);
          stdout.write(`running case: ${testCase.name}\n`);
          const artifact = await session.runCase(testCase);
          stdout.write(`[${artifact.sequence}] ${artifact.status}: ${artifact.reason} actions=${artifact.actionCount} modelCalls=${artifact.modelCallCount}\n`);
        } catch (error) { stdout.write(`case error: ${error instanceof Error ? error.message : String(error)}\n`); }
        continue;
      }
      if (line.startsWith("/")) { stdout.write("Unknown command. Type /help.\n"); continue; }
      try {
        const testCase = await caseCompiler.compile(line);
        stdout.write(`running case: ${testCase.name} mode=${testCase.completion.mode} expected=${testCase.timing.expectedMs}ms timeout=${testCase.timing.timeoutMs}ms\n`);
        const artifact = await session.runCase(testCase);
        stdout.write(`[${artifact.sequence}] ${artifact.status}: ${artifact.reason} actions=${artifact.actionCount} modelCalls=${artifact.modelCallCount}\n`);
      } catch (error) {
        stdout.write(`session error: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } catch (error) {
    if (!closing) {
      stdout.write(`fatal MCP/session error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  } finally {
    await close();
  }
}

function printHelp(): void {
  stdout.write("Commands: /run <case.yaml|json>, /open <url>, /status, /help, /exit. Plain text runs an ad-hoc V2 test case.\n");
}

export function createAdHocCase(description: string): TestCaseDefinition {
  const text = description.trim();
  if (!text) throw new Error("Ad-hoc test case description cannot be empty.");
  return {
    name: text.length > 40 ? `${text.slice(0, 40)}…` : text,
    description: text,
    completion: {
      mode: "operation_succeeded",
      success: ["用户指令中的全部操作均已由 MCP 成功执行"],
      failure: ["页面明确显示操作失败、业务错误或与用户目标相反的结果"],
    },
    timing: { expectedMs: 5_000, timeoutMs: 30_000 },
    limits: { maxActions: 12, maxNoProgress: 4 },
  };
}

export async function loadCase(path: string): Promise<TestCaseDefinition> {
  const source = await readFile(path, "utf8");
  const parsed = path.toLowerCase().endsWith(".json") ? JSON.parse(source) : parseYaml(source);
  return normalizeCase(parsed);
}

function normalizeCase(value: unknown): TestCaseDefinition {
  if (!value || typeof value !== "object") throw new Error("Test case file must contain an object.");
  const item = value as Record<string, any>;
  const duration = (input: unknown): number => {
    if (typeof input === "number") return input;
    if (typeof input !== "string") return NaN;
    const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|毫秒|s|秒|m|min|分钟|h|小时)$/i);
    if (!match) return NaN;
    const scale: Record<string, number> = { ms: 1, 毫秒: 1, s: 1000, 秒: 1000, m: 60000, min: 60000, 分钟: 60000, h: 3600000, 小时: 3600000 };
    return Number(match[1]) * scale[match[2].toLowerCase()];
  };
  const list = (input: unknown): string[] => Array.isArray(input) ? input.map(String) : input == null ? [] : [String(input)];
  return {
    name: String(item.name ?? ""), description: String(item.description ?? ""), startUrl: item.startUrl ?? item.start_url,
    completion: { mode: item.completion?.mode ?? "state_reached", success: list(item.completion?.success), failure: list(item.completion?.failure) },
    timing: { expectedMs: duration(item.timing?.expectedMs ?? item.timing?.expected), timeoutMs: duration(item.timing?.timeoutMs ?? item.timing?.timeout) },
    limits: item.limits,
  };
}

if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) void runRepl();
