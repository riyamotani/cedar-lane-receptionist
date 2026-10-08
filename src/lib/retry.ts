// HTTP status from a googleapis (gaxios) error, or undefined if there was no HTTP response.
export function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } }).response?.status;
}

// Worth retrying: rate limits, Google-side failures, and network errors (no response, error code
// like ECONNRESET). Never 4xx like 404: retrying can't fix "not found" or a bad request.
function isRetryable(err: unknown): boolean {
  const status = httpStatus(err);
  if (status === undefined) return typeof (err as { code?: unknown }).code === 'string';
  return status === 429 || status >= 500;
}

// Runs fn; on a retryable failure waits briefly and tries exactly once more.
// Only use with idempotent operations, or ones made idempotent (see createBooking).
export async function withRetry<T>(fn: () => Promise<T>, delayMs = 500): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryable(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fn();
  }
}
