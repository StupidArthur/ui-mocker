import { randomUUID } from "node:crypto";
import { ArtifactRecord, BrowserAdapter, CaseAgentProvider, SetupArtifact, StepArtifact, StepInput, TestCaseArtifact, TestCaseDefinition, JudgeProvider, ThinkProvider, ToolDescriptor, serializeError } from "./types.js";
import { SingleStepRunner } from "./runner.js";
import { TestCaseRunner } from "./case-runner.js";

export interface ArtifactSink { write(record: ArtifactRecord): Promise<void>; }

export interface SessionOptions {
  adapter: BrowserAdapter;
  thinker: ThinkProvider;
  judge: JudgeProvider;
  caseAgent?: CaseAgentProvider;
  sink?: ArtifactSink;
  sessionId?: string;
}

export type SessionState = "created" | "connected" | "closed" | "fatal";

/** Long-lived application/session boundary. It owns exactly one MCP/Chrome connection. */
export class Session {
  readonly sessionId: string;
  private readonly runner: SingleStepRunner;
  private readonly caseRunner?: TestCaseRunner;
  private state: SessionState = "created";
  private capabilities: ToolDescriptor[] = [];
  private sequence = 0;
  private stepNumber = 0;

  constructor(private readonly options: SessionOptions) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.runner = new SingleStepRunner(options.adapter, options.thinker, options.judge);
    this.caseRunner = options.caseAgent ? new TestCaseRunner(options.adapter, options.caseAgent) : undefined;
  }

  get status(): SessionState { return this.state; }
  get tools(): readonly ToolDescriptor[] { return this.capabilities; }
  get nextSequence(): number { return this.sequence + 1; }

  async start(): Promise<void> {
    if (this.state === "connected") return;
    if (this.state === "closed") throw new Error("Session is closed.");
    try {
      await this.options.adapter.connect();
      this.capabilities = await this.options.adapter.listTools();
      this.state = "connected";
    } catch (error) {
      this.state = "fatal";
      throw error;
    }
  }

  async open(url: string): Promise<SetupArtifact> {
    this.requireConnected();
    const sequence = ++this.sequence;
    const setupId = `setup-${sequence}`;
    const startedAt = new Date().toISOString();
    try {
      const phase = await this.options.adapter.setup(url);
      const artifact: SetupArtifact = { version: "0.2", recordType: "setup", sessionId: this.sessionId, setupId, sequence, url, startedAt, finishedAt: new Date().toISOString(), phase, error: phase?.error };
      await this.write(artifact);
      return artifact;
    } catch (error) {
      const artifact: SetupArtifact = { version: "0.2", recordType: "setup", sessionId: this.sessionId, setupId, sequence, url, startedAt, finishedAt: new Date().toISOString(), error: serializeError(error) };
      await this.write(artifact);
      return artifact;
    }
  }

  async runStep(step: string, config?: StepInput["config"]): Promise<StepArtifact> {
    this.requireConnected();
    const sequence = ++this.sequence;
    const artifact = await this.runner.run({ step, config }, { sessionId: this.sessionId, stepId: `step-${++this.stepNumber}`, sequence, capabilities: this.capabilities });
    await this.write(artifact);
    return artifact;
  }

  async runCase(testCase: TestCaseDefinition): Promise<TestCaseArtifact> {
    this.requireConnected();
    if (!this.caseRunner) throw new Error("Session has no case agent provider.");
    if (testCase.startUrl) {
      const setup = await this.open(testCase.startUrl);
      if (setup.error) {
        const timestamp = new Date().toISOString();
        const artifact: TestCaseArtifact = { version: "0.3", recordType: "case", sessionId: this.sessionId, caseId: `case-${this.sequence + 1}`, sequence: ++this.sequence, testCase, status: "blocked", reason: `Start URL setup failed: ${setup.error.message}`, startedAt: timestamp, finishedAt: timestamp, actionCount: 0, modelCallCount: 0, completedOperationIds: [], iterations: [] };
        await this.write(artifact);
        return artifact;
      }
    }
    const sequence = ++this.sequence;
    const artifact = await this.caseRunner.run(testCase, { sessionId: this.sessionId, sequence, capabilities: this.capabilities, caseId: `case-${sequence}` });
    await this.write(artifact);
    return artifact;
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    if (this.state === "created") { this.state = "closed"; return; }
    try { await this.options.adapter.disconnect(); }
    finally { this.state = "closed"; }
  }

  private requireConnected(): void {
    if (this.state !== "connected") throw new Error(`Session is not connected (state: ${this.state}).`);
  }

  private async write(record: ArtifactRecord): Promise<void> { if (this.options.sink) await this.options.sink.write(record); }
}

export class MemoryArtifactSink implements ArtifactSink {
  readonly records: ArtifactRecord[] = [];
  async write(record: ArtifactRecord): Promise<void> { this.records.push(record); }
}
