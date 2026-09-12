import { describe, expect, it } from "vitest";
import { JudgeDecision, BrowserAdapter, PhaseRecord, StepInput, ToolDescriptor, ToolInvocation, ThinkProvider, WaitConfig, WaitResult } from "../src/types.js";
import { RuleBasedJudgeProvider, ScriptedJudgeProvider, ScriptedThinkProvider } from "../src/providers.js";
import { SingleStepRunner } from "../src/runner.js";

class FakeAdapter implements BrowserAdapter {
  calls: string[] = [];
  operationError = false;
  waitResult: WaitResult = { status: "stable", elapsedMs: 1, polls: 2, observations: [] };
  async connect() { this.calls.push("connect"); }
  async disconnect() { this.calls.push("disconnect"); }
  async listTools(): Promise<ToolDescriptor[]> { this.calls.push("listTools"); return [{ name: "snapshot" }, { name: "click" }]; }
  async setup(startUrl?: string): Promise<PhaseRecord | undefined> { if (!startUrl) return undefined; this.calls.push("setup"); return { phase: "setup", startedAt: "", finishedAt: "", raw: { url: startUrl }, toolCalls: [] }; }
  async captureShot(phase: PhaseRecord["phase"]): Promise<PhaseRecord> { this.calls.push(phase); return { phase, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), raw: { phase, text: "done" }, toolCalls: [] }; }
  async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolInvocation> { this.calls.push(`operate:${toolName}`); return { toolName, arguments: args, startedAt: "", finishedAt: "", ...(this.operationError ? { error: { name: "Error", message: "no" } } : { result: { ok: true } }) }; }
  async waitForStability(_config?: WaitConfig): Promise<WaitResult> { this.calls.push("wait"); return this.waitResult; }
}

const input: StepInput = { step: "click submit", config: { operation: { toolName: "click", arguments: { uid: "1" } } } };

describe("SingleStepRunner", () => {
  it("runs the complete phase order and passes", async () => {
    const adapter = new FakeAdapter();
    const artifact = await new SingleStepRunner(adapter, new ScriptedThinkProvider(input.config?.operation), new RuleBasedJudgeProvider()).run(input);
    expect(artifact.status).toBe("passed");
    expect(artifact.phases.map((phase) => phase.phase)).toEqual(["takeShotBefore", "think", "operate", "takeShotImmediate", "wait", "takeShotSettled", "judge"]);
    expect(adapter.calls.filter((call) => call.startsWith("operate:")).length).toBe(1);
  });

  it("fails when the single operation fails", async () => {
    const adapter = new FakeAdapter(); adapter.operationError = true;
    const artifact = await new SingleStepRunner(adapter, new ScriptedThinkProvider(input.config?.operation), new RuleBasedJudgeProvider()).run(input);
    expect(artifact.status).toBe("failed");
    expect(artifact.phases.find((phase) => phase.phase === "operate")?.error?.message).toBe("no");
  });

  it("blocks on a bounded wait timeout", async () => {
    const adapter = new FakeAdapter(); adapter.waitResult = { status: "timeout", elapsedMs: 10, polls: 3, observations: [], reason: "timeout" };
    const artifact = await new SingleStepRunner(adapter, new ScriptedThinkProvider(input.config?.operation), new RuleBasedJudgeProvider()).run(input);
    expect(artifact.status).toBe("blocked");
  });

  it("supports a pluggable judge", async () => {
    const decision: JudgeDecision = { status: "failed", reason: "scripted" };
    const artifact = await new SingleStepRunner(new FakeAdapter(), new ScriptedThinkProvider(), new ScriptedJudgeProvider(decision)).run({ step: "observe" });
    expect(artifact.status).toBe("failed");
    expect(artifact.reason).toBe("scripted");
  });

});
