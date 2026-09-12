import { describe, it, expect } from "vitest";
import { BatchQueue, estimateTokens } from "../../src/engine/batch";

describe("BatchQueue", () => {
  it("translates items with limited concurrency", async () => {
    const results: string[] = [];
    const queue = new BatchQueue({
      concurrency: 2,
      translator: async (text: string) => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(text);
        return `x:${text}`;
      },
    });
    queue.load(["a", "bb", "ccc", "dddd"]);
    await queue.run();
    expect(queue.snapshot().every((j) => j.status === "done")).toBe(true);
    expect(results).toHaveLength(4);
  });

  it("actually runs `concurrency` jobs in parallel", async () => {
    let active = 0;
    let peak = 0;
    const queue = new BatchQueue({
      concurrency: 2,
      translator: async (text: string) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
        return `x:${text}`;
      },
    });
    queue.load(["a", "b", "c", "d"]);
    await queue.run();
    // 真并发: 同一时刻最多两个任务在途(旧实现恒为 1)
    expect(peak).toBe(2);
    expect(queue.snapshot().every((j) => j.status === "done")).toBe(true);
  });

  it("estimateTokens is >0", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
  });
});
