import {
  BrowserAdapter,
  JudgeProvider,
  OperationDecision,
  PhaseName,
  PhaseRecord,
  StepArtifact,
  StepInput,
  ToolDescriptor,
  ThinkProvider,
  serializeError,
} from "./types.js";

const ORDER: PhaseName[] = ["takeShotBefore", "think", "operate", "takeShotImmediate", "wait", "takeShotSettled", "judge"];
const now = () => new Date().toISOString();

export class SingleStepRunner {
  constructor(
    private readonly adapter: BrowserAdapter,
    private readonly thinker: ThinkProvider,
    private readonly judge: JudgeProvider,
  ) {}

  async run(input: StepInput, metadata: { sessionId?: string; stepId?: string; sequence?: number; capabilities?: ToolDescriptor[] } = {}): Promise<StepArtifact> {
    const startedAt = now();
    const phases: PhaseRecord[] = [];
    let capabilities: ToolDescriptor[] = [];
    let operationSucceeded = true;
    let waitTimedOut = false;

    try {
      capabilities = metadata.capabilities ?? [];

      const before = await this.adapter.captureShot("takeShotBefore");
      phases.push(before);
      let decision: OperationDecision;
      try {
        const thinkStarted = now();
        decision = await this.thinker.think({ input, before, capabilities });
        phases.push({ phase: "think", startedAt: thinkStarted, finishedAt: now(), raw: decision.raw ?? decision, toolCalls: [] });
      } catch (error) {
        phases.push({ phase: "think", startedAt: now(), finishedAt: now(), toolCalls: [], error: serializeError(error) });
        decision = { kind: "blocked", reason: "Think provider failed." };
      }

      const operateStarted = now();
      if (decision.kind === "operation" && decision.operation) {
        const invocation = await this.adapter.callTool(decision.operation.toolName, decision.operation.arguments ?? {});
        operationSucceeded = !invocation.error;
        phases.push({ phase: "operate", startedAt: operateStarted, finishedAt: now(), raw: invocation.result, toolCalls: [invocation], error: invocation.error, evidence: [{ kind: "tool", value: invocation.result, sourcePhase: "operate" }] });
      } else {
        phases.push({ phase: "operate", startedAt: operateStarted, finishedAt: now(), raw: decision, toolCalls: [], error: decision.kind === "blocked" ? serializeError(new Error(decision.reason)) : undefined });
        operationSucceeded = decision.kind !== "blocked";
      }

      phases.push(await this.adapter.captureShot("takeShotImmediate"));
      const waitStarted = now();
      const wait = await this.adapter.waitForStability(input.config?.wait);
      waitTimedOut = wait.status === "timeout";
      phases.push({ phase: "wait", startedAt: waitStarted, finishedAt: now(), raw: wait, toolCalls: [...(wait.toolCalls ?? []), ...wait.observations.flatMap((observation) => observation.toolCalls)], error: wait.status === "error" ? serializeError(new Error(wait.reason ?? "Wait failed")) : undefined });
      phases.push(await this.adapter.captureShot("takeShotSettled"));

      const judgeStarted = now();
      const judgment = await this.judge.judge({ input, phases, operationSucceeded, waitTimedOut });
      phases.push({ phase: "judge", startedAt: judgeStarted, finishedAt: now(), raw: judgment, toolCalls: [], evidence: judgment.evidence });
      const status = waitTimedOut ? "blocked" : judgment.status;
      return { version: "0.2", recordType: "step", sessionId: metadata.sessionId ?? "standalone", stepId: metadata.stepId ?? `step-${Date.now()}`, sequence: metadata.sequence ?? 1, input, status, startedAt, finishedAt: now(), phases, capabilities, reason: waitTimedOut ? "The stability wait timed out." : judgment.reason };
    } catch (error) {
      phases.push({ phase: nextMissingPhase(phases), startedAt: now(), finishedAt: now(), toolCalls: [], error: serializeError(error) });
      return { version: "0.2", recordType: "step", sessionId: metadata.sessionId ?? "standalone", stepId: metadata.stepId ?? `step-${Date.now()}`, sequence: metadata.sequence ?? 1, input, status: "blocked", startedAt, finishedAt: now(), phases, capabilities, reason: serializeError(error).message };
    }
  }
}

function nextMissingPhase(phases: PhaseRecord[]): PhaseName {
  return ORDER.find((phase) => !phases.some((record) => record.phase === phase)) ?? "judge";
}
