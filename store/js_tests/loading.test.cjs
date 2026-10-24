const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../static/store/loading.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

// Exercise the browser script with controlled network responses and time.
function storefront({itemId = '', userId = '', search = ''} = {}) {
  const element = section => ({
    dataset: {section}, attributes: {}, children: [], innerHTML: '', listeners: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceChildren() { this.children = []; this.innerHTML = ''; },
    append(...children) { this.children.push(...children); },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  });
  const names = itemId ? ['details', 'reviews'] : ['popular', 'recommendations'];
  const sections = Object.fromEntries(['shoppers', ...names].map(name => [name, element(name)]));
  const root = {
    dataset: {itemId, userId, sectionUrl: '/sections/SECTION/'},
    querySelector(selector) { return sections[selector.match(/"(.*?)"/)[1]]; },
    querySelectorAll() { return names.map(name => sections[name]); },
  };
  let now = 0;
  const calls = [];
  vm.runInNewContext(source, {
    document: {
      getElementById: () => root,
      querySelector: () => sections.shoppers,
      createElement: () => element(''),
    },
    window: {location: {origin: 'https://store.example', search}},
    URL, AbortController,
    Date: {now: () => now},
    setTimeout(callback, ms) {
      if (ms <= 4000) queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    fetch(url) {
      return new Promise((resolve, reject) => calls.push({
        name: url.pathname.split('/')[2], url, resolve, reject, answered: false,
      }));
    },
  });
  return {
    calls, sections,
    order: () => calls.map(call => call.name),
    advance(ms) { now += ms; },
    async reply(name, payload = {}) {
      const call = calls.find(call => call.name === name && !call.answered);
      assert.ok(call, `Expected pending ${name} request`);
      call.answered = true;
      call.resolve({ok: true, json: async () => ({html: `<p>${name}</p>`, user_id: userId, ...payload})});
      await settle();
    },
    async expire(name) {
      const call = calls.find(call => call.name === name && !call.answered);
      assert.ok(call, `Expected pending ${name} request`);
      call.answered = true;
      now += 120001;
      call.reject(new Error('Service unavailable'));
      await settle();
    },
    async retry(name) {
      const button = sections[name].children.find(child => child.type === 'button');
      assert.ok(button, `Expected ${name} retry button`);
      button.listeners.click();
      await settle();
    },
  };
}

test('home loads shoppers, popular, then recommendations for the chosen shopper', async () => {
  const app = storefront();
  assert.deepEqual(app.order(), ['shoppers']);
  await app.reply('shoppers', {user_id: 'selected-shopper'});
  assert.deepEqual(app.order(), ['shoppers', 'popular']);
  assert.equal(app.calls[1].url.searchParams.get('user_id'), 'selected-shopper');
  await app.reply('popular');
  assert.deepEqual(app.order(), ['shoppers', 'popular', 'recommendations']);
  assert.equal(app.calls[2].url.searchParams.get('user_id'), 'selected-shopper');
  await app.reply('recommendations');
  assert.equal(app.sections.recommendations.attributes['aria-busy'], 'false');
});

test('recommendations get a fresh retry window after slow earlier sections', async () => {
  const app = storefront();
  app.advance(110000);
  await app.reply('shoppers', {user_id: 'shopper'});
  app.advance(110000);
  await app.reply('popular');
  assert.deepEqual(app.order(), ['shoppers', 'popular', 'recommendations']);
  await app.reply('recommendations');
});

test('shopper failure still permits popular products and retry resumes recommendations', async () => {
  const app = storefront();
  await app.expire('shoppers');
  assert.deepEqual(app.order(), ['shoppers', 'popular']);
  await app.reply('popular');
  assert.equal(app.sections.recommendations.children[0].textContent, 'Load shoppers to see recommendations.');
  await app.retry('shoppers');
  await app.reply('shoppers', {user_id: 'recovered-shopper'});
  assert.deepEqual(app.order(), ['shoppers', 'popular', 'shoppers', 'recommendations']);
  assert.equal(app.calls.at(-1).url.searchParams.get('user_id'), 'recovered-shopper');
  await app.reply('recommendations');
});

test('popular failure does not prevent recommendations and retries do not duplicate them', async () => {
  const app = storefront();
  await app.reply('shoppers', {user_id: 'shopper'});
  await app.expire('popular');
  assert.deepEqual(app.order(), ['shoppers', 'popular', 'recommendations']);
  await app.reply('recommendations');
  await app.retry('popular');
  await app.reply('popular');
  assert.deepEqual(app.order(), ['shoppers', 'popular', 'recommendations', 'popular']);
});

test('retrying dependent recommendations recovers shoppers without duplicating pending requests', async () => {
  const app = storefront();
  await app.expire('shoppers');
  await app.reply('popular');
  await app.retry('recommendations');
  await app.retry('recommendations');
  assert.deepEqual(app.order(), ['shoppers', 'popular', 'shoppers']);
  await app.reply('shoppers', {user_id: 'shopper'});
  assert.deepEqual(app.order(), ['shoppers', 'popular', 'shoppers', 'recommendations']);
  await app.reply('recommendations');
});

test('recommendation retry does not reload successful shopper and popular sections', async () => {
  const app = storefront();
  await app.reply('shoppers', {user_id: 'shopper'});
  await app.reply('popular');
  await app.expire('recommendations');
  await app.retry('recommendations');
  assert.deepEqual(app.order(), ['shoppers', 'popular', 'recommendations', 'recommendations']);
  await app.reply('recommendations');
});

test('direct product pages fetch item details and review page without waiting for shoppers', async () => {
  const app = storefront({itemId: 'item-1', userId: 'saved-shopper', search: '?page=2&user_id=saved-shopper'});
  assert.deepEqual(app.order(), ['details', 'reviews', 'shoppers']);
  for (const call of app.calls.slice(0, 2)) {
    assert.equal(call.url.searchParams.get('item_id'), 'item-1');
    assert.equal(call.url.searchParams.get('page'), '2');
    assert.equal(call.url.searchParams.get('user_id'), 'saved-shopper');
  }
  await app.reply('details');
  await app.reply('reviews');
  assert.equal(app.sections.details.attributes['aria-busy'], 'false');
  assert.equal(app.sections.reviews.attributes['aria-busy'], 'false');
  await app.expire('shoppers');
  assert.deepEqual(app.order(), ['details', 'reviews', 'shoppers']);
});
