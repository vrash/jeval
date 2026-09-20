import { ProviderError } from "./provider.js";

export interface RetryOptions {
  /** Total attempts including the first. 1 disables retries. */
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Cap on how long a server-supplied Retry-After is honoured. */
  maxRetryAfterMs?: number;
  signal?: AbortSignal | undefined;
  /** Test hook. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export function isTransient(error: unknown): boolean {
  return error instanceof ProviderError && error.transient;
}

export async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError("aborted while waiting to retry", { kind: "aborted", transient: false }));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Retry transient provider errors with capped exponential backoff, honouring Retry-After. */
export async function withRetries<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<{ value: T; attempts: number }> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  const base = options.baseDelayMs ?? 500;
  const max = options.maxDelayMs ?? 8000;
  const maxRetryAfter = options.maxRetryAfterMs ?? 60_000;
  const sleep = options.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    if (options.signal?.aborted) {
      throw new ProviderError("aborted", { kind: "aborted", transient: false });
    }
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      if (attempt >= maxAttempts || !isTransient(error)) throw error;
      const retryAfter = error instanceof ProviderError ? error.retryAfterMs : undefined;
      let delay = Math.min(max, base * 2 ** (attempt - 1));
      if (retryAfter !== undefined && Number.isFinite(retryAfter)) {
        delay = Math.min(maxRetryAfter, Math.max(delay, retryAfter));
      }
      // jitter: subtract up to 25%
      delay = Math.round(delay * (1 - Math.random() * 0.25));
      options.onRetry?.({ attempt, delayMs: delay, error });
      await sleep(delay, options.signal);
    }
  }
}
