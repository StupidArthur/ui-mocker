import { describe, expect, it } from "vitest";
import { MiniMaxCaseAgentProvider, MiniMaxCaseCompilerProvider, MiniMaxJudgeProvider, MiniMaxThinkProvider } from "../src/minimax-provider.js";

describe("MiniMax providers", () => {
  it("turns a model decision into exactly one discovered operation", async () => {
    const provider = new MiniMaxThinkProvider(async () => JSON.stringify({ kind: "operation", reason: "button found", operation: { toolName: "click", arguments: { uid: "7" } } }));
    const result = await provider.think({
      input: { step: "点击登录" },
      before: { phase: "takeShotBefore", startedAt: "", finishedAt: "", raw: { text: "登录" }, toolCalls: [] },
      capabilities: [{ name: "click", inputSchema: { type: "object" } }],
    });
    expect(result.operation).toEqual({ toolName: "click", arguments: { uid: "7" } });
  });

  it("rejects an invented MCP tool", async () => {
    const provider = new MiniMaxThinkProvider(async () => JSON.stringify({ kind: "operation", reason: "x", operation: { toolName: "invented", arguments: {} } }));
    await expect(provider.think({ input: { step: "x" }, before: { phase: "takeShotBefore", startedAt: "", finishedAt: "", toolCalls: [] }, capabilities: [{ name: "click" }] })).rejects.toThrow("unavailable tool");
  });

  it("parses a fenced judge response", async () => {
    const provider = new MiniMaxJudgeProvider(async () => '```json\n{"status":"passed","reason":"目标已出现"}\n```');
    const result = await provider.judge({ input: { step: "检查目标" }, phases: [], operationSucceeded: true, waitTimedOut: false });
    expect(result.status).toBe("passed");
  });

  it("uses one case-model decision for a terminal result", async () => {
    let calls = 0;
    const provider = new MiniMaxCaseAgentProvider(async () => { calls += 1; return '{"kind":"passed","reason":"首页已显示"}'; });
    const result = await provider.decide({
      testCase: { name: "登录", description: "登录", completion: { mode: "state_reached", success: ["首页"], failure: ["错误"] }, timing: { expectedMs: 3000, timeoutMs: 15000 } },
      current: { phase: "takeShotBefore", startedAt: "", finishedAt: "", raw: { text: "首页" }, toolCalls: [] },
      capabilities: [], history: [], actionCount: 0, elapsedMs: 10, remainingMs: 14990, completedOperationIds: [], pendingOperations: [],
    });
    expect(result.kind).toBe("passed");
    expect(calls).toBe(1);
  });

  it("extracts case JSON surrounded by model commentary", async () => {
    const provider = new MiniMaxCaseAgentProvider(async () => '分析如下：\n{"kind":"observe","reason":"等待训练状态","feedbackMode":"long"}\n以上。');
    const result = await provider.decide({
      testCase: { name: "训练", description: "训练", completion: { mode: "state_reached", success: ["完成"], failure: ["失败"] }, timing: { expectedMs: 120000, timeoutMs: 180000 } },
      current: { phase: "takeShotBefore", startedAt: "", finishedAt: "", raw: {}, toolCalls: [] }, capabilities: [], history: [], actionCount: 0, elapsedMs: 0, remainingMs: 180000, completedOperationIds: [], pendingOperations: [],
    });
    expect(result.kind).toBe("observe");
  });

  it("compiles an operation-only instruction with operation_succeeded mode", async () => {
    const provider = new MiniMaxCaseCompilerProvider(async () => JSON.stringify({
      name: "点击专家模式", description: "ignored",
      requiredOperations: [{ id: "click_expert_mode", description: "点击专家模式" }],
      completion: { mode: "operation_succeeded", success: ["点击成功"], failure: [] },
      timing: { expectedMs: 1000, timeoutMs: 5000 }, limits: { maxActions: 3, maxNoProgress: 1 },
    }));
    const result = await provider.compile("点击专家模式选择按钮");
    expect(result.completion.mode).toBe("operation_succeeded");
    expect(result.description).toBe("点击专家模式选择按钮");
  });
});
