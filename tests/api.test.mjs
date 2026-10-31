// Run with node --test tests/api.test.mjs. All responses/time are local fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAPI, APIError} from '../static/scripts/api.js';
import {withRetry} from '../static/scripts/retry.js';
import {readRoute, homeURL, productURL} from '../static/scripts/navigation.js';
import {starRating, productImage} from '../static/scripts/components/products.js';
import {details, reviews} from '../static/scripts/pages/product-view.js';
import {DEMO_SHOPPERS} from '../static/scripts/config.js';

const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json', ...headers},
});
const item = {parent_asin: 'one'};
const row = i => ({review_id: String(i), item});

test('history loads every API page and keeps read-only request options', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const api = createAPI('https://api.example/', async (url, options) => {
    calls.push({url, options});
    return response({items: url.searchParams.get('page') === '1'
      ? Array.from({length: 100}, (_, i) => row(i)) : [row(100)], total_count: 101, page_count: 2});
  });
  const result = await api.history('user /?', signal);
  assert.equal(result.items.length, 101);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url.pathname, /user%20%2F%3F\/history$/);
  assert.equal(calls[0].url.searchParams.get('verified_only'), 'true');
  assert.equal(calls[0].url.searchParams.get('page_size'), '100');
  assert.equal(calls[1].url.searchParams.get('page'), '2');
  assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('history rejects incomplete, duplicate, and changing results', async () => {
  for (const pages of [
    [{items: [row(1)], total_count: 2, page_count: 1}],
    [{items: [row(1), row(1)], total_count: 2, page_count: 1}],
    [{items: Array.from({length: 100}, (_, i) => row(i)), total_count: 101, page_count: 2},
     {items: [row(100)], total_count: 102, page_count: 2}],
  ]) {
    const api = createAPI('https://api.example', async () => response(pages.shift()));
    await assert.rejects(api.history('u'), APIError);
  }
});

test('all endpoint contracts validate malformed payloads and preserve page parameters', async () => {
  const calls = [];
  const api = createAPI('https://api.example', async url => {
    calls.push(url);
    if (url.pathname.endsWith('/recommendations')) return response({items: [item], engine_used: 'popular'});
    if (url.pathname.endsWith('/reviews')) return response({items: [], total_count: 0, page_count: 0});
    return response(item);
  });
  assert.equal((await api.recommendations('u')).engine_used, 'popular');
  assert.equal(calls[0].searchParams.get('n'), '8');
  assert.equal((await api.item('item /?')).parent_asin, 'one');
  await api.reviews('one', 3);
  assert.equal(calls[2].searchParams.get('page'), '3');
  assert.equal(calls[2].searchParams.get('page_size'), '10');
  const malformed = createAPI('https://api.example', async () => response({items: null}));
  for (const operation of [() => malformed.history('u'), () => malformed.recommendations('u'),
    () => malformed.item('one'), () => malformed.reviews('one', 1)]) {
    await assert.rejects(operation(), APIError);
  }
});

test('API handles HTTP errors, Retry-After, invalid JSON, and invalid base URLs', async () => {
  const busy = createAPI('https://api.example', async () => response({}, 503, {'Retry-After': '5'}));
  await assert.rejects(busy.item('one'), error => error instanceof APIError && error.status === 503 && error.retryAfter === 5000);
  const invalidJSON = createAPI('https://api.example', async () => new Response('invalid'));
  await assert.rejects(invalidJSON.item('one'), /invalid response/);
  for (const value of ['file:///tmp', 'https://user:password@api.example', 'https://api.example?q=x', 'https://api.example/#x']) {
    assert.throws(() => createAPI(value));
  }
});

test('retry recovers transient errors but leaves final errors alone', async () => {
  let calls = 0, clock = 0;
  const waits = [];
  const result = await withRetry(async () => {
    if (++calls === 1) throw new APIError('busy', 503, 5000);
    return 'ok';
  }, {now: () => clock, sleep: async ms => {waits.push(ms); clock += ms;}});
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(waits, [5000]);
  for (const status of [400, 404, 422]) {
    calls = 0;
    await assert.rejects(withRetry(async () => {calls++; throw new APIError('final', status);}), APIError);
    assert.equal(calls, 1);
  }
});

test('retry respects cancellation, attempt timeout, and the overall window', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(withRetry(async () => assert.fail('Must not start'), {signal: controller.signal}), {name: 'AbortError'});
  let clock = 0, calls = 0;
  await assert.rejects(withRetry(async () => {calls++; throw new APIError('busy', 503);}, {
    windowMs: 1000, now: () => clock, sleep: async ms => {clock += ms;},
  }), APIError);
  assert.equal(calls, 1);
  const signal = new AbortController();
  const pending = withRetry(attempt => new Promise((resolve, reject) => {
    attempt.addEventListener('abort', () => {signal.abort(); reject(new DOMException('Stopped', 'AbortError'));});
  }), {signal: signal.signal, attemptMs: 5});
  await assert.rejects(pending, {name: 'AbortError'});
});

test('navigation preserves arbitrary shopper IDs and normalizes review pages', () => {
  assert.equal(new URL(homeURL('shopper /?'), 'https://store.example').searchParams.get('user_id'), 'shopper /?');
  const route = readRoute(new URL(productURL('item /?', 'u') + '&page=3', 'https://store.example'));
  assert.deepEqual(route, {kind: 'product', asin: 'item /?', userId: 'u', page: 3});
  for (const page of ['-1', '0', 'invalid', '9007199254740992']) {
    assert.equal(readRoute(new URL('https://store.example/?page=' + page)).page, 1);
  }
  assert.equal(readRoute(new URL('https://store.example/missing')).kind, 'not-found');
  assert.equal(new Set(DEMO_SHOPPERS.map(row => row.user_id)).size, 3);
});

test('ratings preserve fractional stars and API text cannot inject HTML', () => {
  const rendered = starRating(4.2);
  assert.deepEqual([...rendered.matchAll(/style="width: (\d+)%"/g)].map(match => Number(match[1])), [100,100,100,100,20]);
  assert.match(rendered, /aria-label="4.2 out of 5 stars"/);
  assert.match(starRating(null), /Rating unavailable/);
  assert.match(starRating(-1), /0 out of 5 stars/);
  assert.match(starRating(8), /5 out of 5 stars/);
  const unsafe = '<script>alert(1)</script>';
  assert.ok(!details({...item, item_title: unsafe, store: unsafe, description: unsafe}).includes('<script>'));
  assert.ok(!reviews({items: [{review_text: unsafe, review_title: unsafe, user_id: unsafe}], page_count: 1, total_count: 1}, 1, 'one', 'u').includes('<script>'));
  assert.equal(productImage({...item, image_url: 'javascript:alert(1)'}), '');
});
