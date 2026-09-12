export type StepStatus = "passed" | "failed" | "blocked";
export type TestCaseStatus = StepStatus | "timeout";

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
}

export interface CaseEvaluationContext extends CaseModelContext {
  decision: CaseDecision;
  operation?: ToolInvocation;
}

export interface CaseAgentProvider {
  decide(context: CaseModelContext): Promise<CaseDecision>;
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
  iterations: CaseIteration[];
}

export type ArtifactRecord = StepArtifact | SetupArtifact | TestCaseArtifact;

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: "UnknownError", message: String(error) };
}
