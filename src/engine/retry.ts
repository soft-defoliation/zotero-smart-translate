/**
 * Retry Logic — Exponential Backoff for Rate Limits
 *
 * Handles:
 * - 429 Too Many Requests
 * - 1305 Model Overloaded (智谱)
 * - 5xx Server Errors
 * 
 * Not retried:
 * - 401 Unauthorized
 * - 400 Bad Request
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 2000,
  maxDelayMs: 10000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

export class RateLimitError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, retryableStatuses } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry on 401/400
      if (error instanceof APIError && error.statusCode) {
        if (error.statusCode === 401 || error.statusCode === 400) {
          throw error;
        }
      }

      // Check if retryable
      const shouldRetry =
        error instanceof RateLimitError ||
        (error instanceof APIError &&
          error.statusCode &&
          retryableStatuses.includes(error.statusCode));

      if (!shouldRetry || attempt === maxAttempts) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs
      );
      
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper to detect rate limit from response
export function isRateLimitError(statusCode: number, body?: string): boolean {
  if (statusCode === 429) return true;
  if (body?.includes("1305")) return true;
  if (statusCode >= 500 && statusCode < 600) return true;
  return false;
}
