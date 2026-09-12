import { describe, expect, it } from "vitest";
import { TestCaseRunner } from "../src/case-runner.js";
import type { BrowserAdapter, CaseAgentProvider, CaseDecision, PhaseRecord, TestCaseDefinition, ToolDescriptor, ToolInvocation, WaitResult } from "../src/types.js";

class CaseAdapter implements BrowserAdapter {
  page = 0; calls: string[] = [];
  async connect() {}
  async disconnect() {}
  async listTools(): Promise<ToolDescriptor[]> { return [{ name: "click" }, { name: "type" }]; }
  async setup(): Promise<undefined> { return undefined; }
  async captureShot(phase: PhaseRecord["phase"]): Promise<PhaseRecord> { this.calls.push(phase); return { phase, startedAt: "", finishedAt: "", raw: { page: this.page }, toolCalls: [] }; }
  async callTool(toolName: string, arguments_: Record<string, unknown>): Promise<ToolInvocation> { this.calls.push(`operate:${toolName}`); this.page += 1; return { toolName, arguments: arguments_, startedAt: "", finishedAt: "", result: { page: this.page } }; }
  async waitForStability(): Promise<WaitResult> { throw new Error("legacy wait must not be used by case runner"); }
}

const testCase: TestCaseDefinition = {
  name: "login", description: "fill and submit", completion: { mode: "state_reached", success: ["home visible"], failure: ["error visible"] },
  timing: { expectedMs: 3_000, timeoutMs: 15_000 }, limits: { maxActions: 5 },
};

class SequenceAgent implements CaseAgentProvider {
  decisions: CaseDecision[] = [
    { kind: "operation", reason: "type", operation: { toolName: "type", arguments: { value: "u" } } },
    { kind: "operation", reason: "click", operation: { toolName: "click", arguments: {} } },
    { kind: "passed", reason: "home visible" },
  ];
  decideCalls = 0;
  async decide() { this.decideCalls += 1; return this.decisions.shift()!; }
}

describe("TestCaseRunner", () => {
  it("executes multiple atomic actions until business completion", async () => {
    const adapter = new CaseAdapter(), agent = new SequenceAgent();
    const runner = new TestCaseRunner(adapter, agent);
    const result = await runner.run(testCase, { sessionId: "s", sequence: 1, capabilities: await adapter.listTools() });
    expect(result.status).toBe("passed");
    expect(result.actionCount).toBe(2);
    expect(result.modelCallCount).toBe(3);
    expect(adapter.calls.filter((call) => call.startsWith("operate:"))).toEqual(["operate:type", "operate:click"]);
  });

  it("does not repeatedly call the model while an unchanged long task is observed", async () => {
    const adapter = new CaseAdapter();
    const agent: CaseAgentProvider = {
      async decide() { return { kind: "observe", reason: "training", feedbackMode: "long" }; },
    };
    const scheduler = { async waitForChange() { return { status: "timeout" as const, observations: [] }; } };
    const result = await new TestCaseRunner(adapter, agent, scheduler).run({ ...testCase, timing: { expectedMs: 120_000, timeoutMs: 180_000 } }, { sessionId: "s", sequence: 1, capabilities: await adapter.listTools() });
    expect(result.status).toBe("timeout");
    expect(result.modelCallCount).toBe(1);
    expect(result.actionCount).toBe(0);
  });

  it("keeps snapshot tools out of the model's business-action capabilities", async () => {
    const adapter = new CaseAdapter();
    let visibleTools: string[] = [];
    const agent: CaseAgentProvider = { async decide(context) { visibleTools = context.capabilities.map((tool) => tool.name); return { kind: "passed", reason: "done" }; } };
    const result = await new TestCaseRunner(adapter, agent).run(testCase, { sessionId: "s", sequence: 1, capabilities: [{ name: "take_snapshot" }, { name: "take_screenshot" }, { name: "wait_for" }, { name: "click" }] });
    expect(result.status).toBe("passed");
    expect(visibleTools).toEqual(["click"]);
  });

  it("suppresses a consecutive duplicate operation and observes delayed feedback", async () => {
    const adapter = new CaseAdapter();
    const decisions: CaseDecision[] = [
      { kind: "operation", reason: "submit", operation: { toolName: "click", arguments: { uid: "1" } } },
      { kind: "operation", reason: "submit again", operation: { toolName: "click", arguments: { uid: "1" } } },
      { kind: "passed", reason: "done" },
    ];
    const agent: CaseAgentProvider = { async decide() { return decisions.shift()!; } };
    const changed: PhaseRecord = { phase: "takeShotSettled", startedAt: "", finishedAt: "", raw: { page: "done" }, toolCalls: [] };
    const scheduler = { async waitForChange() { return { status: "changed" as const, observations: [changed] }; } };
    const result = await new TestCaseRunner(adapter, agent, scheduler).run(testCase, { sessionId: "s", sequence: 1, capabilities: [{ name: "click" }] });
    expect(result.status).toBe("passed");
    expect(result.actionCount).toBe(1);
    expect(adapter.calls.filter((call) => call === "operate:click")).toHaveLength(1);
  });

  it("rejects observation for operation_succeeded and replans from the same fresh snapshot", async () => {
    const adapter = new CaseAdapter();
    const decisions: CaseDecision[] = [
      { kind: "observe", reason: "verify form", feedbackMode: "long" },
      { kind: "operation", reason: "click remaining button", operation: { toolName: "click", arguments: { uid: "1" } } },
      { kind: "passed", reason: "all requested operations executed" },
    ];
    const agent: CaseAgentProvider = { async decide() { return decisions.shift()!; } };
    const result = await new TestCaseRunner(adapter, agent).run({ ...testCase, completion: { ...testCase.completion, mode: "operation_succeeded" } }, { sessionId: "s", sequence: 1, capabilities: [{ name: "click" }] });
    expect(result.status).toBe("passed");
    expect(result.actionCount).toBe(1);
    expect(result.iterations[0].observations).toEqual([]);
  });

  it("finishes operation_succeeded in code when every compiled operation ID completes", async () => {
    const adapter = new CaseAdapter();
    let calls = 0;
    const agent: CaseAgentProvider = { async decide() {
      calls += 1;
      return { kind: "operation", reason: "click login", completes: ["submit_login"], operation: { toolName: "click", arguments: { uid: "1" } } };
    } };
    const result = await new TestCaseRunner(adapter, agent).run({
      ...testCase,
      completion: { mode: "operation_succeeded", success: ["all operations done"], failure: [] },
      requiredOperations: [{ id: "submit_login", description: "click login" }],
    }, { sessionId: "s", sequence: 1, capabilities: [{ name: "click" }] });
    expect(result.status).toBe("passed");
    expect(result.completedOperationIds).toEqual(["submit_login"]);
    expect(result.actionCount).toBe(1);
    expect(calls).toBe(1);
  });

  it("allows prerequisite actions with empty completes for state_reached", async () => {
    const adapter = new CaseAdapter();
    const decisions: CaseDecision[] = [
      { kind: "operation", reason: "open submit dialog", operation: { toolName: "click", arguments: { uid: "open" } } },
      { kind: "operation", reason: "submit", completes: ["submit"], operation: { toolName: "click", arguments: { uid: "submit" } } },
      { kind: "passed", reason: "done" },
    ];
    const agent: CaseAgentProvider = { async decide() { return decisions.shift()!; } };
    const result = await new TestCaseRunner(adapter, agent).run({
      ...testCase,
      completion: { mode: "state_reached", success: ["done"], failure: [] },
      requiredOperations: [{ id: "submit", description: "submit" }],
    }, { sessionId: "s", sequence: 1, capabilities: [{ name: "click" }] });
    expect(result.status).toBe("passed");
    expect(result.actionCount).toBe(2);
    expect(result.completedOperationIds).toEqual(["submit"]);
    expect(adapter.calls.filter((call) => call === "operate:click")).toHaveLength(2);
  });

  it("still rejects empty completes for operation_succeeded", async () => {
    const adapter = new CaseAdapter();
    const decisions: CaseDecision[] = [
      { kind: "operation", reason: "prereq", operation: { toolName: "click", arguments: { uid: "open" } } },
      { kind: "operation", reason: "submit", completes: ["submit"], operation: { toolName: "click", arguments: { uid: "submit" } } },
    ];
    const agent: CaseAgentProvider = { async decide() { return decisions.shift()!; } };
    const result = await new TestCaseRunner(adapter, agent).run({
      ...testCase,
      completion: { mode: "operation_succeeded", success: ["all operations done"], failure: [] },
      requiredOperations: [{ id: "submit", description: "submit" }],
    }, { sessionId: "s", sequence: 1, capabilities: [{ name: "click" }] });
    expect(result.status).toBe("passed");
    expect(result.actionCount).toBe(1);
    expect(adapter.calls.filter((call) => call === "operate:click")).toHaveLength(1);
  });

  it("reports MCP operation errors to the next turn and allows an identical retry", async () => {
    class ErroringAdapter implements BrowserAdapter {
      calls: string[] = [];
      private first = true;
      async connect() {}
      async disconnect() {}
      async listTools(): Promise<ToolDescriptor[]> { return [{ name: "upload_file" }]; }
      async setup(): Promise<undefined> { return undefined; }
      async captureShot(phase: PhaseRecord["phase"]): Promise<PhaseRecord> { return { phase, startedAt: "", finishedAt: "", raw: { page: this.first ? 0 : 1 }, toolCalls: [] }; }
      async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolInvocation> {
        this.calls.push(toolName);
        if (this.first) {
          this.first = false;
          return { toolName, arguments: args, startedAt: "", finishedAt: "", error: { name: "McpToolError", message: "Input validation error: filePaths is required" } };
        }
        return { toolName, arguments: args, startedAt: "", finishedAt: "", result: { ok: true } };
      }
      async waitForStability(): Promise<WaitResult> { throw new Error("unused"); }
    }
    const adapter = new ErroringAdapter();
    const histories: string[][] = [];
    const decisions: CaseDecision[] = [
      { kind: "operation", reason: "upload", operation: { toolName: "upload_file", arguments: { filePath: "x" } } },
      { kind: "operation", reason: "retry upload", operation: { toolName: "upload_file", arguments: { filePath: "x" } } },
      { kind: "passed", reason: "done" },
    ];
    const agent: CaseAgentProvider = { async decide(context) { histories.push([...context.history]); return decisions.shift()!; } };
    const result = await new TestCaseRunner(adapter, agent).run(testCase, { sessionId: "s", sequence: 1, capabilities: [{ name: "upload_file" }] });
    expect(result.status).toBe("passed");
    expect(adapter.calls).toEqual(["upload_file", "upload_file"]);
    expect(histories[1].some((entry) => entry.includes("filePaths is required"))).toBe(true);
  });
});
