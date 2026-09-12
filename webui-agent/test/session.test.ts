import { describe, expect, it } from "vitest";
import { MemoryArtifactSink } from "../src/session.js";
import { Session } from "../src/session.js";
import { sanitizeForArtifact } from "../src/artifact-store.js";
import { ScriptedThinkProvider, RuleBasedJudgeProvider } from "../src/providers.js";
import { BrowserAdapter, PhaseRecord, ToolDescriptor, ToolInvocation, WaitConfig, WaitResult } from "../src/types.js";

class SessionFakeAdapter implements BrowserAdapter {
  connects = 0; disconnects = 0; lists = 0; calls: string[] = []; page = "initial"; failNext = false;
  async connect() { this.connects += 1; }
  async disconnect() { this.disconnects += 1; }
  async listTools(): Promise<ToolDescriptor[]> { this.lists += 1; return [{ name: "click" }, { name: "snapshot" }]; }
  async setup(url?: string): Promise<PhaseRecord | undefined> { if (!url) return undefined; this.page = url; this.calls.push("setup"); return { phase: "setup", startedAt: "", finishedAt: "", raw: { url }, toolCalls: [] }; }
  async captureShot(phase: PhaseRecord["phase"]): Promise<PhaseRecord> { this.calls.push(phase); return { phase, startedAt: "", finishedAt: "", raw: { page: this.page }, toolCalls: [] }; }
  async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolInvocation> {
    this.calls.push(`operate:${toolName}`);
    if (this.failNext) { this.failNext = false; return { toolName, arguments: args, startedAt: "", finishedAt: "", error: { name: "Error", message: "temporary" } }; }
    this.page = `${this.page}->${toolName}`;
    return { toolName, arguments: args, startedAt: "", finishedAt: "", result: { page: this.page } };
  }
  async waitForStability(_config?: WaitConfig): Promise<WaitResult> { this.calls.push("wait"); return { status: "stable", elapsedMs: 0, polls: 1, observations: [] }; }
}

describe("Session", () => {
  it("redacts credentials before artifact persistence", () => {
    expect(sanitizeForArtifact({ authorization: "Bearer secret", nested: { apiKey: "sk-secret" } })).toEqual({ authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]" } });
  });

  it("connects once, preserves page state across steps, and writes records", async () => {
    const adapter = new SessionFakeAdapter();
    const sink = new MemoryArtifactSink();
    const session = new Session({ adapter, thinker: new ScriptedThinkProvider({ toolName: "click" }), judge: new RuleBasedJudgeProvider(), sink, sessionId: "session-test" });
    await session.start();
    await session.open("https://example.test");
    const first = await session.runStep("click once");
    const second = await session.runStep("click twice");
    expect(adapter.connects).toBe(1);
    expect(adapter.lists).toBe(1);
    expect(adapter.disconnects).toBe(0);
    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(second.phases.find((phase) => phase.phase === "takeShotBefore")?.raw).toEqual({ page: "https://example.test->click" });
    expect(sink.records.map((record) => record.recordType)).toEqual(["setup", "step", "step"]);
    await session.close(); await session.close();
    expect(adapter.disconnects).toBe(1);
  });

  it("keeps the session usable after a failed step", async () => {
    const adapter = new SessionFakeAdapter(); adapter.failNext = true;
    const session = new Session({ adapter, thinker: new ScriptedThinkProvider({ toolName: "click" }), judge: new RuleBasedJudgeProvider() });
    await session.start();
    const failed = await session.runStep("temporary failure");
    const passed = await session.runStep("retry");
    expect(failed.status).toBe("failed");
    expect(passed.status).toBe("passed");
    expect(session.status).toBe("connected");
    await session.close();
  });
});
