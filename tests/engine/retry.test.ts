import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry, RateLimitError, APIError, isRateLimitError } from "../../src/engine/retry";

describe("Retry Logic", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("should return success on first try", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on 429", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new APIError("Rate limited", 429))
      .mockResolvedValueOnce("success");

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should retry on 1305 model overload", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new APIError("Model overloaded", 500, "1305"))
      .mockResolvedValueOnce("success");

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should not retry on 401", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new APIError("Unauthorized", 401));

    await expect(withRetry(fn)).rejects.toThrow("Unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should not retry on 400", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new APIError("Bad request", 400));

    await expect(withRetry(fn)).rejects.toThrow("Bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should exhaust retries and throw", async () => {
    const fn = vi.fn().mockRejectedValue(new APIError("Rate limited", 429));

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 }))
      .rejects.toThrow("Rate limited");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should detect 1305 in response body", () => {
    expect(isRateLimitError(500, '{"error": {"code": "1305"}}')).toBe(true);
    expect(isRateLimitError(429)).toBe(true);
    expect(isRateLimitError(200)).toBe(false);
  });
});
