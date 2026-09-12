import { canonicalSerialize } from "./mcp-adapter.js";
import type { BrowserAdapter, FeedbackMode, PhaseRecord } from "./types.js";

export type DelayFn = (ms: number) => Promise<void>;

export interface ObservationResult {
  status: "changed" | "checkpoint" | "timeout";
  observations: PhaseRecord[];
}

/** Polls cheaply and returns only when page evidence changes or the hard deadline is reached. */
export class ObservationScheduler {
  constructor(private readonly adapter: BrowserAdapter, private readonly delay: DelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}

  async waitForChange(previous: unknown, mode: FeedbackMode, deadlineMs: number): Promise<ObservationResult> {
    const observations: PhaseRecord[] = [];
    const baseline = canonicalSerialize(previous);
    const schedule = mode === "long" ? [5_000, 15_000, 30_000, 60_000, 120_000, 300_000] : [500, 1_000, 2_000, 3_000];
    let index = 0;
    while (Date.now() < deadlineMs) {
      const remaining = deadlineMs - Date.now();
      await this.delay(Math.min(schedule[Math.min(index, schedule.length - 1)], remaining));
      if (Date.now() >= deadlineMs) return { status: "timeout", observations };
      const shot = await this.adapter.captureShot("takeShotSettled");
      observations.push(shot);
      if (shot.error || canonicalSerialize(shot.raw) !== baseline) return { status: "changed", observations };
      index += 1;
      if (index >= schedule.length) return { status: "checkpoint", observations };
    }
    return { status: "timeout", observations };
  }
}
