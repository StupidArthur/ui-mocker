import { randomUUID } from "node:crypto";
import { ObservationScheduler } from "./observation-scheduler.js";
import { canonicalSerialize } from "./mcp-adapter.js";
import type { BrowserAdapter, CaseAgentProvider, CaseIteration, CaseLastTransition, CaseModelContext, CaseVerification, CaseVerifierProvider, TestCaseArtifact, TestCaseDefinition, ToolDescriptor } from "./types.js";

const now = () => new Date().toISOString();

export interface CaseObservationScheduler {
  waitForChange(previous: unknown, mode: "short" | "long", deadlineMs: number): Promise<{ status: "changed" | "checkpoint" | "timeout"; observations: import("./types.js").PhaseRecord[] }>;
}

/** 同一快照连续 observe 允许的纠正次数上限（超出即 blocked，不再让 maxNoProgress 承担全部职责）。 */
const MAX_SAME_SNAPSHOT_OBSERVES = 1;

export class TestCaseRunner {
  constructor(
    private readonly adapter: BrowserAdapter,
    private readonly agent: CaseAgentProvider,
    private readonly scheduler: CaseObservationScheduler = new ObservationScheduler(adapter),
    private readonly verifier?: CaseVerifierProvider,
  ) {}

  async run(testCase: TestCaseDefinition, metadata: { sessionId: string; sequence: number; capabilities: ToolDescriptor[]; caseId?: string }): Promise<TestCaseArtifact> {
    validateCase(testCase);
    const stateReached = testCase.completion.mode === "state_reached";
    const startedAt = now(), startedMs = Date.now(), deadline = startedMs + testCase.timing.timeoutMs;
    const iterations: CaseIteration[] = [], history: string[] = [];
    const actionCapabilities = metadata.capabilities.filter((tool) => !isObservationTool(tool.name));
    const maxActions = testCase.limits?.maxActions ?? 20, maxNoProgress = testCase.limits?.maxNoProgress ?? 8;
    const requiredOperations = testCase.requiredOperations ?? [];
    const requiredIds = new Set(requiredOperations.map((item) => item.id));
    const completedIds = new Set<string>();
    let actionCount = 0, modelCallCount = 0, noProgress = 0;
    let lastOperationFingerprint: string | undefined;
    let lastObserveFingerprint: string | undefined;
    let sameSnapshotObserveCount = 0, maxSameSnapshotObserveCount = 0;
    let lastVerifiedFingerprint: string | undefined;
    let lastVerification: CaseVerification | undefined;
    let lastTransition: CaseLastTransition | undefined;
    let consecutiveNoChangeObservations = 0;
    let firstSuccessIteration: number | undefined;
    let rescue: "agent" | "observe" | "final" | undefined;

    // 独立终态验证：同一 snapshot 只调用一次 verifier（指纹缓存），只看 completion + 当前快照。
    const verifyCurrent = async (): Promise<CaseVerification | undefined> => {
      if (!this.verifier || !stateReached) return undefined;
      if (current.error) return undefined;
      const fingerprint = canonicalSerialize(current.raw);
      if (lastVerifiedFingerprint !== undefined && fingerprint === lastVerifiedFingerprint && lastVerification) return lastVerification;
      modelCallCount += 1;
      let verification: CaseVerification;
      try {
        verification = await this.verifier.verify({ testCase, current });
      } catch (error) {
        verification = { passed: false, reason: `Verifier call failed: ${message(error)}` };
      }
      lastVerifiedFingerprint = fingerprint;
      lastVerification = verification;
      if (verification.passed && firstSuccessIteration === undefined) firstSuccessIteration = iterations.length;
      return verification;
    };

    const build = (status: TestCaseArtifact["status"], reason: string): TestCaseArtifact => {
      const metrics = stateReached
        ? { firstSuccessIteration, sameSnapshotObserveCount: maxSameSnapshotObserveCount, rescue }
        : undefined;
      return {
        version: "0.3", recordType: "case", sessionId: metadata.sessionId, caseId: metadata.caseId ?? randomUUID(), sequence: metadata.sequence,
        testCase, status, reason, startedAt, finishedAt: now(), actionCount, modelCallCount, completedOperationIds: [...completedIds], iterations, metrics,
      };
    };

    // 异常退出前的 final-state rescue：状态非 passed 且当前快照从未被 verifier 判定成功时，补验一次。
    const finish = async (status: TestCaseArtifact["status"], reason: string): Promise<TestCaseArtifact> => {
      if (status !== "passed" && stateReached && this.verifier) {
        const verified = await verifyCurrent();
        if (verified?.passed) {
          rescue = "final";
          return build("passed", verified.reason);
        }
      }
      return build(status, reason);
    };

    let current = await this.adapter.captureShot("takeShotBefore");
    if (current.error) return finish("blocked", current.error.message);

    while (Date.now() < deadline) {
      if (!stateReached && requiredIds.size > 0 && completedIds.size === requiredIds.size) return finish("passed", "All required operations completed successfully.");
      const base = context(testCase, current, actionCapabilities, history, actionCount, startedMs, deadline, completedIds, lastTransition, consecutiveNoChangeObservations);
      let decision;
      try { modelCallCount += 1; decision = await this.agent.decide(base); }
      catch (error) { return finish("blocked", `Case decision failed: ${message(error)}`); }
      const iteration: CaseIteration = { index: iterations.length + 1, startedAt: now(), before: current, decision, observations: [], finishedAt: now() };
      iterations.push(iteration);

      if (decision.kind === "passed" || decision.kind === "failed" || decision.kind === "blocked") {
        if (decision.kind === "passed" && stateReached && this.verifier) {
          const verified = await verifyCurrent();
          iteration.finishedAt = now();
          if (verified?.passed) {
            rescue = "agent";
            return finish("passed", verified.reason || decision.reason);
          }
          history.push(`final-state verification rejected passed: ${verified?.reason ?? "no verifier result"}`);
          if (history.length > 10) history.shift();
          noProgress += 1;
          if (noProgress > maxNoProgress) return finish("blocked", `Terminal verification repeatedly rejected passed (${maxNoProgress} times).`);
          continue;
        }
        iteration.finishedAt = now();
        return finish(decision.kind, decision.reason);
      }

      if (decision.kind === "observe") {
        if (!stateReached) {
          history.push("contract correction: the current DOM snapshot is already fresh; observation is forbidden for operation_succeeded. Choose the next remaining operation, or passed if every requested operation has executed.");
          if (history.length > 10) history.shift();
          noProgress += 1;
          iteration.finishedAt = now();
          if (noProgress > maxNoProgress) return finish("blocked", `Model repeatedly requested observation for an operation-only case (${maxNoProgress} corrections).`);
          continue;
        }
        // state_reached：进入观察前先验证终态，避免 low 模型误入 observe 循环。
        const verified = await verifyCurrent();
        if (verified?.passed) {
          rescue = "observe";
          iteration.finishedAt = now();
          return finish("passed", verified.reason);
        }
        // 对同一快照的重复 observe：不再真的等待，直接给出 contract correction。
        const fingerprint = canonicalSerialize(current.raw);
        if (fingerprint === lastObserveFingerprint) {
          sameSnapshotObserveCount += 1;
          maxSameSnapshotObserveCount = Math.max(maxSameSnapshotObserveCount, sameSnapshotObserveCount);
          iteration.finishedAt = now();
          if (sameSnapshotObserveCount > MAX_SAME_SNAPSHOT_OBSERVES) {
            return finish("blocked", `Repeated observation of the same unchanged snapshot (${sameSnapshotObserveCount} times).`);
          }
          history.push("contract correction: the previous observation produced no page change. Do not wait again for the same missing control. Re-evaluate completion.success against CURRENT page, or choose a different executable action.");
          if (history.length > 10) history.shift();
          noProgress += 1;
          consecutiveNoChangeObservations += 1;
          lastTransition = { kind: "observe", changed: false };
          if (noProgress > maxNoProgress) return finish("blocked", `No meaningful progress after ${maxNoProgress} observation cycles.`);
          continue;
        }
        lastObserveFingerprint = fingerprint;
        sameSnapshotObserveCount = 0;
        const observed = await this.scheduler.waitForChange(current.raw, decision.feedbackMode ?? inferMode(testCase), deadline);
        iteration.observations.push(...observed.observations);
        iteration.finishedAt = now();
        if (observed.status === "timeout") return finish("timeout", `Case exceeded timeout (${testCase.timing.timeoutMs}ms).`);
        noProgress += 1;
        if (noProgress > maxNoProgress) return finish("blocked", `No meaningful progress after ${maxNoProgress} observation cycles.`);
        const changed = observed.status === "changed";
        current = observed.observations.at(-1) ?? current;
        consecutiveNoChangeObservations = changed ? 0 : consecutiveNoChangeObservations + 1;
        lastTransition = { kind: "observe", changed };
        history.push(changed ? `observed page change after: ${decision.reason}` : `observation checkpoint with no page change after: ${decision.reason}`);
        if (history.length > 10) history.shift();
        continue;
      }

      if (decision.kind === "operation") {
        if (!decision.operation) return finish("blocked", "The model selected operation without tool details.");
        if (actionCount >= maxActions) return finish("blocked", `Maximum action count reached (${maxActions}).`);
        if (!actionCapabilities.some((tool) => tool.name === decision.operation?.toolName)) return finish("blocked", `Unavailable or observation-only MCP tool: ${decision.operation.toolName}`);
        const completes = decision.completes ?? [];
        // 只有 operation_succeeded 才把模型自报的 completes 视为权威：要求至少消费一个 pending ID。
        // state_reached 下 requiredOperations 只是任务提示，completes 完全忽略（不登记、不校验）。
        const trackingCompletes = !stateReached;
        if (trackingCompletes && requiredIds.size > 0 && (completes.length === 0 || completes.some((id) => !requiredIds.has(id) || completedIds.has(id)))) {
          history.push(`contract correction: operation.completes must contain only pending IDs. Pending: ${requiredOperations.filter((item) => !completedIds.has(item.id)).map((item) => item.id).join(", ")}`);
          if (history.length > 10) history.shift();
          noProgress += 1;
          iteration.finishedAt = now();
          if (noProgress > maxNoProgress) return finish("blocked", "Model repeatedly returned invalid required operation IDs.");
          continue;
        }
        const operationFingerprint = canonicalSerialize(decision.operation);
        if (operationFingerprint === lastOperationFingerprint) {
          history.push(`suppressed duplicate action ${decision.operation.toolName}; observing for delayed feedback`);
          const observed = await this.scheduler.waitForChange(current.raw, decision.feedbackMode ?? inferMode(testCase), deadline);
          iteration.observations.push(...observed.observations);
          iteration.finishedAt = now();
          if (observed.status === "timeout") return finish("timeout", `Case exceeded timeout (${testCase.timing.timeoutMs}ms).`);
          current = observed.observations.at(-1) ?? current;
          noProgress += 1;
          if (noProgress > maxNoProgress) return finish("blocked", `No meaningful progress after ${maxNoProgress} observation cycles.`);
          if (observed.status === "changed") lastOperationFingerprint = undefined;
          lastObserveFingerprint = undefined;
          sameSnapshotObserveCount = 0;
          lastTransition = { kind: "observe", changed: observed.status === "changed" };
          consecutiveNoChangeObservations = observed.status === "changed" ? 0 : consecutiveNoChangeObservations + 1;
          continue;
        }
        iteration.operation = await this.adapter.callTool(decision.operation.toolName, decision.operation.arguments ?? {});
        actionCount += 1;
        if (iteration.operation.error) {
          // 让下一轮模型看到真实 MCP 错误（如参数 schema 校验失败），并允许它用相同参数重试。
          lastOperationFingerprint = undefined;
          history.push(`tool ${decision.operation.toolName} failed: ${iteration.operation.error.message}`);
          lastTransition = { kind: "operation", toolName: decision.operation.toolName, succeeded: false, pageChanged: false };
        } else {
          lastOperationFingerprint = operationFingerprint;
          if (trackingCompletes) completes.forEach((id) => completedIds.add(id));
          history.push(`action ${decision.operation.toolName}: ${decision.reason}`);
          lastTransition = { kind: "operation", toolName: decision.operation.toolName, succeeded: true, pageChanged: false };
        }
        if (history.length > 10) history.shift();
        iteration.immediate = await this.adapter.captureShot("takeShotImmediate");
        if (iteration.immediate.error) return finish("blocked", iteration.immediate.error.message);
        if (!iteration.operation.error) {
          lastTransition = { kind: "operation", toolName: decision.operation.toolName, succeeded: true, pageChanged: canonicalSerialize(iteration.before.raw) !== canonicalSerialize(iteration.immediate.raw) };
        }
        current = iteration.immediate;
        noProgress = 0;
        lastObserveFingerprint = undefined;
        sameSnapshotObserveCount = 0;
        consecutiveNoChangeObservations = 0;
        iteration.finishedAt = now();
        continue;
      }

      return finish("blocked", `Unknown case decision kind: ${(decision as { kind?: string }).kind}`);
    }
    return finish("timeout", `Case exceeded timeout (${testCase.timing.timeoutMs}ms).`);
  }
}

function context(
  testCase: TestCaseDefinition,
  current: CaseModelContext["current"],
  capabilities: ToolDescriptor[],
  history: string[],
  actionCount: number,
  started: number,
  deadline: number,
  completedIds: Set<string>,
  lastTransition: CaseLastTransition | undefined,
  consecutiveNoChangeObservations: number,
): CaseModelContext {
  // state_reached 不把 completedOperationIds / pendingOperations 当作权威状态喂给模型，
  // 避免模型用“checklist 全满”来自证通过；requiredOperations 仍作为 testCase 中的任务提示可见。
  const trackingCompletes = testCase.completion.mode === "operation_succeeded";
  return {
    testCase,
    current,
    capabilities,
    history: [...history],
    actionCount,
    elapsedMs: Date.now() - started,
    remainingMs: Math.max(0, deadline - Date.now()),
    completedOperationIds: trackingCompletes ? [...completedIds] : [],
    pendingOperations: trackingCompletes ? (testCase.requiredOperations ?? []).filter((item) => !completedIds.has(item.id)) : [],
    lastTransition,
    consecutiveNoChangeObservations,
  };
}

function inferMode(testCase: TestCaseDefinition): "short" | "long" { return testCase.timing.expectedMs > 60_000 ? "long" : "short"; }
function isObservationTool(name: string): boolean { return /^(take_|get_)?(snapshot|screenshot)$|^wait(_for)?$/i.test(name); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function validateCase(value: TestCaseDefinition): void {
  if (!value?.name || !value.description) throw new Error("Test case requires name and description.");
  if (!value.completion?.success?.length) throw new Error("Test case requires at least one success condition.");
  if (!(["operation_succeeded", "state_reached"] as const).includes(value.completion.mode)) throw new Error("Test case requires a valid completion mode.");
  if (!Array.isArray(value.completion.failure)) throw new Error("Test case failure conditions must be an array.");
  if (value.requiredOperations) {
    const ids = value.requiredOperations.map((item) => item.id);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("Test case required operation IDs must be unique and non-empty.");
  }
  if (!(value.timing?.expectedMs > 0) || !(value.timing?.timeoutMs > 0) || value.timing.timeoutMs < value.timing.expectedMs) throw new Error("Test case timing requires timeoutMs >= expectedMs > 0.");
}
