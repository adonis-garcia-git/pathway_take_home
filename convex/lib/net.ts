// Small network resilience helpers. Used by every external client
// (USDA, Places, Maileroo, Anthropic, fetchUrl) to bound latency and
// shield the pipeline from transient blips.
//
// Conventions:
// - All errors are surfaced as plain `Error` with a `label`-prefixed message
//   so action callers can categorize them in logs without sniffing types.
// - Retries are conservative: at most one extra attempt, jittered backoff.
// - Anything 4xx other than 429 is treated as permanent (a bounced email,
//   a bad API key, a malformed URL — retrying just burns budget).

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export class HttpError extends Error {
  constructor(
    label: string,
    public status: number,
    public body?: string,
  ) {
    super(`${label}: HTTP ${status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    this.name = "HttpError";
  }
}

/**
 * Race a promise against a timer. The underlying promise keeps running —
 * use `AbortController` for true cancellation (see `fetchWithTimeout`).
 */
export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface FetchWithTimeoutInit extends RequestInit {
  timeoutMs?: number;
  label?: string;
}

/**
 * `fetch` with an `AbortController` deadline. Throws `TimeoutError` on
 * deadline expiry. Does NOT raise on non-2xx — callers inspect `res.status`
 * to decide how to react (so retry policy lives in `withRetry`, not here).
 */
export async function fetchWithTimeout(
  url: string,
  init: FetchWithTimeoutInit = {},
): Promise<Response> {
  const { timeoutMs = 10_000, label = "fetch", ...rest } = init;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new TimeoutError(label, timeoutMs);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export interface RetryOpts {
  attempts?: number; // total attempts including the first; default 2
  baseMs?: number; // base backoff; default 300
  label: string;
  retryOn?: (err: unknown) => boolean;
}

/** Default retry predicate: network/timeout/HTTP 5xx/429. */
export const defaultRetryOn = (err: unknown): boolean => {
  if (err instanceof TimeoutError) return true;
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  if (err instanceof Error) {
    // node-undici/fetch network errors typically surface like this
    const msg = err.message.toLowerCase();
    if (msg.includes("network") || msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("eai_again") || msg.includes("fetch failed")) {
      return true;
    }
  }
  return false;
};

/**
 * Try `fn()` up to `attempts` times. Backoff is `baseMs * 2^n + jitter(±25%)`.
 * If the predicate returns false (e.g. a 4xx), bail immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts,
): Promise<T> {
  const attempts = opts.attempts ?? 2;
  const baseMs = opts.baseMs ?? 300;
  const retryOn = opts.retryOn ?? defaultRetryOn;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1 || !retryOn(e)) throw e;
      const jitter = 0.75 + Math.random() * 0.5;
      const delay = Math.round(baseMs * Math.pow(2, i) * jitter);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
