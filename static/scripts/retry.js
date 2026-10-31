// Browser retries remain bounded and abortable when changing shoppers or leaving a page.
import { APIError } from './api.js';
function abortError() {
  return new DOMException('Request cancelled', 'AbortError');
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const done = () => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(abortError());
    };
    signal?.addEventListener('abort', cancel, {
      once: true,
    });
  });
}

// Retry in the browser; no serverless function waits for a sleeping API.
export async function withRetry(
  operation,
  {
    signal,
    windowMs = 300000,
    attemptMs = 30000,
    onRetry = () => {},
    now = Date.now,
    sleep = delay,
  } = {},
) {
  const deadline = now() + windowMs;
  let lastError;
  let failures = 0;
  while (now() < deadline) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, {
      once: true,
    });
    const timer = setTimeout(cancel, Math.min(attemptMs, deadline - now()));
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      // Missing resources and invalid requests are final; transient failures can recover.
      if (
        error instanceof APIError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status)
      )
        throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
    failures += 1;
    onRetry(lastError);
    const wait = Math.max(
      Math.min(4000 * failures, 12000),
      Math.min(lastError?.retryAfter || 0, 30000),
    );
    await sleep(Math.min(wait, Math.max(0, deadline - now())), signal);
  }
  throw lastError || new APIError('The service is taking longer than expected.');
}
