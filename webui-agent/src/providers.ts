import {
  ExpectedResult,
  JudgeContext,
  JudgeDecision,
  JudgeProvider,
  OperationDecision,
  StepInput,
  ThinkContext,
  ThinkProvider,
} from "./types.js";

/** Deterministic provider reserved for unit tests; the product CLI uses MiniMax. */
export class RuleBasedThinkProvider implements ThinkProvider {
  async think(context: ThinkContext): Promise<OperationDecision> {
    const configured = context.input.config?.operation;
    if (configured) {
      return { kind: "operation", operation: configured, reason: "Using the explicitly configured operation." };
    }

    const url = extractUrl(context.input.step);
    if (url && findTool(context, ["navigate_page", "navigate", "open_url"])) {
      return {
        kind: "operation",
        operation: { toolName: findTool(context, ["navigate_page", "navigate", "open_url"])!, arguments: { url } },
        reason: "The step contains a URL and a navigation capability is available.",
      };
    }

    return {
      kind: "none",
      reason: "No safe deterministic operation was configured for this step; observation-only mode.",
    };
  }
}

export class RuleBasedJudgeProvider implements JudgeProvider {
  async judge(context: JudgeContext): Promise<JudgeDecision> {
    const expected = context.input.config?.expected;
    if (context.waitTimedOut) return { status: "blocked", reason: "The page did not become stable before the bounded wait timeout." };
    if (!context.operationSucceeded && expected?.operationSucceeded !== false) {
      return { status: "failed", reason: "The operation returned an error." };
    }
    if (expected?.operationSucceeded === false && context.operationSucceeded) {
      return { status: "failed", reason: "The operation succeeded but failure was expected." };
    }

    const settled = context.phases.find((phase) => phase.phase === "takeShotSettled");
    const text = expected?.text;
    if (text && !JSON.stringify(settled?.raw ?? "").includes(text)) {
      return { status: "failed", reason: `Expected text was not found: ${text}` };
    }
    if (expected?.urlIncludes && !JSON.stringify(settled?.raw ?? "").includes(expected.urlIncludes)) {
      return { status: "failed", reason: `Expected URL fragment was not found: ${expected.urlIncludes}` };
    }
    return { status: "passed", reason: "All deterministic checks passed." };
  }
}

function extractUrl(step: string): string | undefined {
  return step.match(/https?:\/\/[^\s)]+/i)?.[0];
}

function findTool(context: ThinkContext, names: string[]): string | undefined {
  const available = new Set(context.capabilities.map((tool) => tool.name));
  return names.find((name) => available.has(name));
}

export class ScriptedThinkProvider implements ThinkProvider {
  constructor(private readonly operation?: StepInput["config"] extends infer T ? T extends { operation?: infer O } ? O : never : never) {}
  async think(): Promise<OperationDecision> {
    return this.operation
      ? { kind: "operation", operation: this.operation, reason: "Scripted operation." }
      : { kind: "none", reason: "Scripted observation-only step." };
  }
}

export class ScriptedJudgeProvider implements JudgeProvider {
  constructor(private readonly decision: JudgeDecision) {}
  async judge(): Promise<JudgeDecision> { return this.decision; }
}
