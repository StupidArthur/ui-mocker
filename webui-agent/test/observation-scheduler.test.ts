import { describe, expect, it } from "vitest";
import { ObservationScheduler } from "../src/observation-scheduler.js";
import type { BrowserAdapter, PhaseRecord, ToolDescriptor, ToolInvocation, WaitResult } from "../src/types.js";

class StaticAdapter implements BrowserAdapter {
  shots = 0;
  async connect() {}
  async disconnect() {}
  async listTools(): Promise<ToolDescriptor[]> { return []; }
  async setup(): Promise<undefined> { return undefined; }
  async captureShot(phase: PhaseRecord["phase"]): Promise<PhaseRecord> { this.shots += 1; return { phase, startedAt: "", finishedAt: "", raw: { state: "same" }, toolCalls: [] }; }
  async callTool(): Promise<ToolInvocation> { throw new Error("unused"); }
  async waitForStability(): Promise<WaitResult> { throw new Error("unused"); }
}

describe("ObservationScheduler", () => {
  it("returns a short checkpoint instead of consuming the whole case timeout", async () => {
    const adapter = new StaticAdapter();
    const scheduler = new ObservationScheduler(adapter, async () => undefined);
    const result = await scheduler.waitForChange({ state: "same" }, "short", Date.now() + 60_000);
    expect(result.status).toBe("checkpoint");
    expect(adapter.shots).toBe(4);
  });
});
