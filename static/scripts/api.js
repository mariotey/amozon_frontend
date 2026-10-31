// Read-only API access and payload validation. No UI or page state.
import { record } from './utils.js';
export class APIError extends Error {
  constructor(message, status = 0, retryAfter = 0) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
const list = (value, valid = record) => Array.isArray(value) && value.every(valid);
const product = (value) =>
  record(value) && typeof value.parent_asin === 'string' && value.parent_asin.length > 0;
function validate(value, valid) {
  if (!valid(value)) throw new APIError('The service returned an unexpected response.');
  return value;
}
function normalizeBaseURL(value) {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'API_BASE_URL must be a public HTTP(S) URL without ' + 'credentials, query, or fragment.',
    );
  }
  return url.href.replace(/\/$/, '');
}
export function createAPI(baseURL, fetcher = globalThis.fetch) {
  const base = normalizeBaseURL(baseURL);
  async function get(path, params = {}, signal) {
    const url = new URL(`${base}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetcher(url, {
      signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const raw = response.headers.get('Retry-After');
      const seconds = raw === null ? 0 : Number(raw);
      const retryAfter = Number.isFinite(seconds)
        ? Math.max(0, seconds * 1000)
        : Math.max(0, Date.parse(raw) - Date.now()) || 0;
      throw new APIError(
        'The service could not complete this request.',
        response.status,
        retryAfter,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new APIError('The service returned an invalid response.');
    }
  }
  return {
    async history(userId, signal) {
      const pageSize = 100;
      const fetchPage = async (page) =>
        validate(
          await get(
            `/api/v1/users/${encodeURIComponent(userId)}/history`,
            {
              verified_only: true,
              page,
              page_size: pageSize,
            },
            signal,
          ),
          (data) =>
            record(data) &&
            list(
              data.items,
              (row) =>
                record(row) &&
                typeof row.review_id === 'string' &&
                row.review_id.length > 0 &&
                (row.item == null || product(row.item)),
            ) &&
            Number.isInteger(data.total_count) &&
            data.total_count >= 0 &&
            Number.isInteger(data.page_count) &&
            data.page_count === Math.ceil(data.total_count / pageSize),
        );
      const first = await fetchPage(1);
      const items = [...first.items];
      for (let page = 2; page <= first.page_count; page += 1) {
        const next = await fetchPage(page);
        if (next.total_count !== first.total_count)
          throw new APIError('Review history changed. Please try again.');
        items.push(...next.items);
      }
      if (
        items.length !== first.total_count ||
        new Set(items.map((row) => row.review_id)).size !== items.length
      ) {
        throw new APIError('The service returned incomplete review history.');
      }
      return {
        items,
        total_count: first.total_count,
      };
    },
    async recommendations(userId, signal) {
      // Collaborative, content, and popular results all come from this endpoint.
      return validate(
        await get(
          `/api/v1/users/${encodeURIComponent(userId)}/recommendations`,
          {
            n: 8,
          },
          signal,
        ),
        (data) => record(data) && list(data.items, product),
      );
    },
    async item(asin, signal) {
      return validate(await get(`/api/v1/items/${encodeURIComponent(asin)}`, {}, signal), product);
    },
    async reviews(asin, page, signal) {
      return validate(
        await get(
          `/api/v1/items/${encodeURIComponent(asin)}/reviews`,
          {
            page,
            page_size: 10,
          },
          signal,
        ),
        (data) =>
          record(data) &&
          list(data.items) &&
          Number.isInteger(data.total_count) &&
          data.total_count >= 0 &&
          Number.isInteger(data.page_count) &&
          data.page_count >= 0,
      );
    },
  };
}
