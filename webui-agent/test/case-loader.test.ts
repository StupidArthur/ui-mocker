import { describe, expect, it } from "vitest";
import { createAdHocCase, loadCase } from "../src/cli.js";

describe("test case loader", () => {
  it("loads Chinese duration hints from YAML", async () => {
    const item = await loadCase("examples/long-task.case.yaml");
    expect(item.timing.expectedMs).toBe(30 * 60_000);
    expect(item.timing.timeoutMs).toBe(60 * 60_000);
    expect(item.completion.success).toEqual(["页面显示“训练完成”"]);
    expect(item.completion.mode).toBe("state_reached");
  });

  it("turns plain console input into a bounded V2 test case", () => {
    const item = createAdHocCase("填写登录表单并点击登录");
    expect(item.description).toBe("填写登录表单并点击登录");
    expect(item.completion.mode).toBe("operation_succeeded");
    expect(item.timing).toEqual({ expectedMs: 5_000, timeoutMs: 30_000 });
    expect(item.limits?.maxActions).toBe(12);
  });
});
