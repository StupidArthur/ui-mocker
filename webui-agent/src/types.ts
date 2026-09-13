export type StepStatus = "passed" | "failed" | "blocked";
export type TestCaseStatus = StepStatus | "timeout";

import type { LLMUsageTotals } from "./llm.js";

export type PhaseName =
  | "setup"
  | "takeShotBefore"
  | "think"
  | "operate"
  | "takeShotImmediate"
  | "wait"
  | "takeShotSettled"
  | "judge";

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
  [key: string]: unknown;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface ToolInvocation {
  toolName: string;
  arguments: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  result?: unknown;
  error?: SerializedError;
}

export interface PhaseRecord {
  phase: PhaseName;
  startedAt: string;
  finishedAt: string;
  raw?: unknown;
  toolCalls: ToolInvocation[];
  error?: SerializedError;
  evidence?: Evidence[];
}

export interface Evidence {
  kind: "screenshot" | "dom" | "console" | "network" | "tool" | "text";
  value: unknown;
  sourcePhase?: PhaseName;
}

export interface StepInput {
  step: string;
  config?: RunnerConfig;
}

export interface RunnerConfig {
  mcp?: McpConfig;
  operation?: ScriptedOperation;
  expected?: ExpectedResult;
  wait?: WaitConfig;
}

export interface McpConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  snapshotTool?: string;
  screenshotTool?: string;
  waitTool?: string;
  navigationTool?: string;
}

export interface ScriptedOperation {
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface ExpectedResult {
  text?: string;
  urlIncludes?: string;
  operationSucceeded?: boolean;
}

export interface WaitConfig {
  timeoutMs?: number;
  pollIntervalMs?: number;
  stablePolls?: number;
}

export interface OperationDecision {
  kind: "operation" | "none" | "blocked";
  operation?: ScriptedOperation;
  reason: string;
  raw?: unknown;
}

export interface ThinkContext {
  input: StepInput;
  before: PhaseRecord;
  capabilities: ToolDescriptor[];
}

export interface JudgeContext {
  input: StepInput;
  phases: PhaseRecord[];
  operationSucceeded: boolean;
  waitTimedOut: boolean;
}

export interface JudgeDecision {
  status: StepStatus;
  reason: string;
  evidence?: Evidence[];
  raw?: unknown;
}

export interface ThinkProvider {
  think(context: ThinkContext): Promise<OperationDecision>;
}

export interface JudgeProvider {
  judge(context: JudgeContext): Promise<JudgeDecision>;
}

export interface WaitResult {
  status: "stable" | "timeout" | "error";
  elapsedMs: number;
  polls: number;
  observations: PhaseRecord[];
  reason?: string;
  toolCalls?: ToolInvocation[];
}

export interface BrowserAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<ToolDescriptor[]>;
  /** Fixture/setup navigation; it is not the tested business operation. */
  setup(startUrl?: string): Promise<PhaseRecord | undefined>;
  captureShot(phase: "takeShotBefore" | "takeShotImmediate" | "takeShotSettled"): Promise<PhaseRecord>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<ToolInvocation>;
  waitForStability(config?: WaitConfig): Promise<WaitResult>;
}

export interface StepArtifact {
  version: "0.2";
  recordType: "step";
  sessionId: string;
  stepId: string;
  sequence: number;
  input: StepInput;
  status: StepStatus;
  startedAt: string;
  finishedAt: string;
  phases: PhaseRecord[];
  capabilities: ToolDescriptor[];
  reason: string;
}

export interface SetupArtifact {
  version: "0.2";
  recordType: "setup";
  sessionId: string;
  setupId: string;
  sequence: number;
  url: string;
  startedAt: string;
  finishedAt: string;
  phase?: PhaseRecord;
  error?: SerializedError;
}

export interface TestCaseDefinition {
  name: string;
  description: string;
  startUrl?: string;
  completion: {
    mode: "operation_succeeded" | "state_reached";
    success: string[];
    failure: string[];
  };
  timing: {
    expectedMs: number;
    timeoutMs: number;
  };
  requiredOperations?: Array<{
    id: string;
    description: string;
  }>;
  limits?: {
    maxActions?: number;
    maxNoProgress?: number;
  };
}

export interface CaseCompilerProvider {
  compile(description: string): Promise<TestCaseDefinition>;
}

export type FeedbackMode = "short" | "long";

export interface CaseDecision {
  kind: "operation" | "observe" | StepStatus;
  reason: string;
  operation?: ScriptedOperation;
  completes?: string[];
  feedbackMode?: FeedbackMode;
  raw?: unknown;
}

export interface CaseEvaluation {
  status: "continue" | StepStatus;
  reason: string;
  next?: "act" | "wait";
  feedbackMode?: FeedbackMode;
  raw?: unknown;
}

export interface CaseModelContext {
  testCase: TestCaseDefinition;
  current: PhaseRecord;
  capabilities: ToolDescriptor[];
  history: string[];
  actionCount: number;
  elapsedMs: number;
  remainingMs: number;
  completedOperationIds: string[];
  pendingOperations: Array<{ id: string; description: string }>;
  /** 结构化“上一跳发生了什么”，比自然语言 history 更省模型推理。 */
  lastTransition?: CaseLastTransition;
  /** 连续未变化的观察次数。 */
  consecutiveNoChangeObservations?: number;
}

export interface CaseLastTransition {
  kind: "operation" | "observe";
  toolName?: string;
  /** operation 是否成功（无 MCP 错误）。 */
  succeeded?: boolean;
  /** operation 后页面指纹是否变化。 */
  pageChanged?: boolean;
  /** observe 期间页面是否变化。 */
  changed?: boolean;
}

export interface CaseEvaluationContext extends CaseModelContext {
  decision: CaseDecision;
  operation?: ToolInvocation;
}

export interface CaseAgentProvider {
  decide(context: CaseModelContext): Promise<CaseDecision>;
}

export interface CaseVerificationContext {
  testCase: TestCaseDefinition;
  /** 当前最新、未经过滤的页面 snapshot。 */
  current: PhaseRecord;
}

export interface CaseVerification {
  passed: boolean;
  reason: string;
  raw?: unknown;
}

/** 终态验证器：只在 Agent 提议 passed 时调用一次，只看 completion + 当前 snapshot。 */
export interface CaseVerifierProvider {
  verify(context: CaseVerificationContext): Promise<CaseVerification>;
}

export interface CaseIteration {
  index: number;
  startedAt: string;
  before: PhaseRecord;
  decision: CaseDecision;
  operation?: ToolInvocation;
  immediate?: PhaseRecord;
  observations: PhaseRecord[];
  finishedAt: string;
}

export interface TestCaseArtifact {
  version: "0.3";
  recordType: "case";
  sessionId: string;
  caseId: string;
  sequence: number;
  testCase: TestCaseDefinition;
  status: TestCaseStatus;
  reason: string;
  startedAt: string;
  finishedAt: string;
  actionCount: number;
  modelCallCount: number;
  completedOperationIds: string[];
  /** 本用例累计的 LLM token 消耗（如有配置 tracker）。 */
  usage?: LLMUsageTotals;
  /** state_reached + verifier 时的实验指标。 */
  metrics?: {
    /** verifier 首次判定成功所在的 iteration 序号（terminalLag 用它计算）。 */
    firstSuccessIteration?: number;
    /** 同一快照连续 observe 的最大次数。 */
    sameSnapshotObserveCount?: number;
    /** passed 由哪条路径捕获。 */
    rescue?: "agent" | "observe" | "final";
    /** verifier 实际调用次数（缓存命中不计）。 */
    verificationCount?: number;
    /** 模型返回无法解析/非法决策的次数。 */
    malformedModelResponseCount?: number;
    /** MCP 工具调用报错次数。 */
    mcpErrorCount?: number;
    /** 被抑制的重复操作次数。 */
    duplicateOperationCount?: number;
  };
  iterations: CaseIteration[];
}

export type ArtifactRecord = StepArtifact | SetupArtifact | TestCaseArtifact;

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: "UnknownError", message: String(error) };
}
