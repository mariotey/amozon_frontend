// Only display labels live here; the backend owns the three demo shopper IDs.
const DEMO_SHOPPER_LABELS = {
  collaborative: 'Shopper 1',
  content_based: 'Shopper 2',
  popular: 'Shopper 3',
};

class APIError extends Error {
  constructor(message, status = 0, retryAfter = 0) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value, valid = record) => Array.isArray(value) && value.every(valid);
const product = value => record(value) && typeof value.parent_asin === 'string' && value.parent_asin.length > 0;
function validate(value, valid) {
  if (!valid(value)) throw new APIError('The service returned an unexpected response.');
  return value;
}

function normalizeBaseURL(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('API_BASE_URL must be a public HTTP(S) URL without credentials, query, or fragment.');
  }
  return url.href.replace(/\/$/, '');
}

function createAPI(baseURL, fetcher = globalThis.fetch) {
  const base = normalizeBaseURL(baseURL);
  async function get(path, params = {}, signal) {
    const url = new URL(`${base}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetcher(url, {
      signal, mode: 'cors', credentials: 'omit', cache: 'no-store',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) {
      const raw = response.headers.get('Retry-After');
      const seconds = raw === null ? 0 : Number(raw);
      const retryAfter = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(raw) - Date.now()) || 0;
      throw new APIError('The service could not complete this request.', response.status, retryAfter);
    }
    try { return await response.json(); }
    catch { throw new APIError('The service returned an invalid response.'); }
  }
  return {
    async demoUsers(signal) {
      const users = validate(await get('/api/v1/demo_user', {}, signal), value =>
        record(value) && Object.keys(value).length === 3
        && Object.keys(DEMO_SHOPPER_LABELS).every(scenario =>
          typeof value[scenario] === 'string' && value[scenario].trim().length > 0
          && value[scenario] === value[scenario].trim())
        && new Set(Object.values(value)).size === 3);
      return Object.entries(DEMO_SHOPPER_LABELS).map(([scenario, label]) => ({user_id: users[scenario], label}));
    },
    async history(userId, signal) {
      const pageSize = 100;
      const fetchPage = async page => validate(await get(`/api/v1/users/${encodeURIComponent(userId)}/history`,
        {verified_only: true, page, page_size: pageSize}, signal),
        data => record(data) && list(data.items, row => record(row)
          && typeof row.review_id === 'string' && row.review_id.length > 0
          && (row.item == null || product(row.item)))
          && Number.isInteger(data.total_count) && data.total_count >= 0
          && Number.isInteger(data.page_count) && data.page_count === Math.ceil(data.total_count / pageSize));
      const first = await fetchPage(1);
      const items = [...first.items];
      for (let page = 2; page <= first.page_count; page += 1) {
        const next = await fetchPage(page);
        if (next.total_count !== first.total_count) throw new APIError('Review history changed. Please try again.');
        items.push(...next.items);
      }
      if (items.length !== first.total_count || new Set(items.map(row => row.review_id)).size !== items.length) {
        throw new APIError('The service returned incomplete review history.');
      }
      return {items, total_count: first.total_count};
    },
    async recommendations(userId, signal) {
      // Collaborative, content, and popular results all come from this endpoint.
      return validate(await get(`/api/v1/users/${encodeURIComponent(userId)}/recommendations`, {n: 8}, signal),
        data => record(data) && list(data.items, product));
    },
    async item(asin, signal) {
      return validate(await get(`/api/v1/items/${encodeURIComponent(asin)}`, {}, signal), product);
    },
    async reviews(asin, page, signal) {
      return validate(await get(`/api/v1/items/${encodeURIComponent(asin)}/reviews`, {page, page_size: 10}, signal),
        data => record(data) && list(data.items) && Number.isInteger(data.total_count) && data.total_count >= 0
          && Number.isInteger(data.page_count) && data.page_count >= 0);
    },
  };
}

function abortError() { return new DOMException('Request cancelled', 'AbortError'); }
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const done = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(done, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError()); };
    signal?.addEventListener('abort', cancel, {once: true});
  });
}

// Retry in the browser; no serverless function waits for a sleeping API.
async function withRetry(operation, {
  signal, windowMs = 300000, attemptMs = 30000, onRetry = () => {},
  now = Date.now, sleep = delay,
} = {}) {
  const deadline = now() + windowMs;
  let lastError;
  let failures = 0;
  while (now() < deadline) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, {once: true});
    const timer = setTimeout(cancel, Math.min(attemptMs, deadline - now()));
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      // Missing resources and invalid requests are final; transient failures can recover.
      if (error instanceof APIError && error.status >= 400 && error.status < 500
          && ![408, 429].includes(error.status)) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
    failures += 1;
    onRetry(lastError);
    const wait = Math.max(Math.min(4000 * failures, 12000), Math.min(lastError?.retryAfter || 0, 30000));
    await sleep(Math.min(wait, Math.max(0, deadline - now())), signal);
  }
  throw lastError || new APIError('The service is taking longer than expected.');
}

document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement && event.target.classList.contains('product-image')) {
    event.target.remove();
  }
}, true);

const view = (() => {
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const e = escapeHTML;
const text = (value, fallback) => value == null || value === '' ? fallback : String(value);
const productTitle = item => item.item_title
  ? String(item.item_title).replace(/(^|[\s-])\p{L}/gu, value => value.toUpperCase())
  : item.parent_asin;
const trim = (value, length) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const words = (value, limit) => String(value).split(/\s+/).slice(0, limit).join(' ');
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function homeURL(userId = '') {
  return userId ? `/?${new URLSearchParams({user_id: userId})}` : '/';
}
function productURL(asin, userId = '') {
  return `/product/${encodeURIComponent(asin)}/${userId ? `?${new URLSearchParams({user_id: userId})}` : ''}`;
}
function readRoute(url) {
  const match = url.pathname.match(/^\/product\/([^/]+)\/?$/);
  let asin = null;
  try { if (match) asin = decodeURIComponent(match[1]); } catch { /* Invalid URL is a final not-found page. */ }
  const rawPage = url.searchParams.get('page') || '1';
  const parsed = /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  return {
    kind: url.pathname === '/' ? 'home' : asin ? 'product' : 'not-found',
    asin, userId: url.searchParams.get('user_id') || '',
    page: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1,
  };
}
function loading(label, waiting = false) {
  return `<div class="empty-state compact-empty loading-state"><p class="loading-message">${e(waiting ? 'Waiting for the service to respond' : `Loading ${label}`)}<span class="loading-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>${waiting ? '<p class="loading-help">The service may be waking up. This section will update automatically.</p>' : ''}</div>`;
}
function section(id, title, eyebrow = '') {
  return `<section class="section-block" id="${id}" aria-labelledby="${id}-heading"><div class="section-heading"><div>${eyebrow ? `<p class="eyebrow">${e(eyebrow)}</p>` : ''}<h2 id="${id}-heading">${e(title)}</h2></div></div><div id="${id}-content" aria-live="polite" aria-busy="true">${loading(title.toLowerCase())}</div></section>`;
}
function shopperPicker(users, selected) {
  const options = [...users];
  if (selected && !options.some(user => user.user_id === selected)) {
    options.unshift({user_id: selected, label: 'Selected shopper'});
  }
  const current = options.find(user => user.user_id === selected) || options[0];
  const avatar = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/></svg>';
  return `<div class="user-picker"><button class="account-picker" id="user-picker" type="button" role="combobox" aria-label="Change shopper, currently ${e(current.label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="shopper-options" aria-describedby="shopper-context" value="${e(current.user_id)}"><span class="account-avatar" aria-hidden="true">${avatar}</span><span class="account-greeting">Hello,</span><span class="account-name">${e(current.label)}</span></button><div class="shopper-menu" hidden aria-live="off"><p class="shopper-menu-title" id="shopper-menu-title">Select a user profile.</p><div id="shopper-options" role="listbox" aria-labelledby="shopper-menu-title">${options.map((user, index) => `<div class="shopper-option" id="shopper-option-${index}" role="option" aria-selected="${user.user_id === current.user_id}" data-shopper-id="${e(user.user_id)}" data-shopper-label="${e(user.label)}"><span class="shopper-option-avatar" aria-hidden="true">${e(user.label.match(/\d+$/)?.[0] || 'S')}</span><span>${e(user.label)}</span><svg class="shopper-option-check" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"/></svg></div>`).join('')}</div></div></div>`;
}
function price(item, details = false) {
  if (item.is_free) return '<strong>Free</strong>';
  if (number(item.price) > 0) return `<span>$</span><strong>${number(item.price).toFixed(2)}</strong>`;
  return `<strong>${details ? 'Price not listed' : 'See details'}</strong>`;
}
function productImage(item, details = false) {
  const candidates = [
    record(item.image_url) ? item.image_url.large : item.image_url,
    item.item_images?.large,
  ].flat();
  const source = candidates.find(value => {
    if (typeof value !== 'string' || !value.trim()) return false;
    try { return ['https:', 'http:'].includes(new URL(value).protocol); }
    catch { return false; }
  });
  if (!source) return '';
  const title = productTitle(item);
  return `<img class="product-image" src="${e(source)}" alt="${e(title)}"${details ? '' : ' loading="lazy"'} decoding="async">`;
}
function shopperReview(review) {
  if (!review) return '';
  const rating = number(review.review_rating);
  const date = review.review_date == null || review.review_date === '' ? null : new Date(review.review_date);
  const validDate = date && Number.isFinite(date.getTime());
  const reviewed = validDate ? new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(date) : '';
  return `<div class="shopper-review"><span>This shopper's rating: <strong>${rating >= 1 && rating <= 5 ? `${e(rating)}/5` : 'Not available'}</strong></span>${reviewed ? `<small>Reviewed <time datetime="${date.toISOString()}">${e(reviewed)}</time></small>` : ''}</div>`;
}
function productCard(item, userId, review = null) {
  const category = text(item.main_category, 'Amozon finds');
  const title = productTitle(item);
  const href = e(productURL(item.parent_asin, userId));
  return `<article class="product-card"><a class="product-art" href="${href}" data-product="${e(item.parent_asin)}" aria-label="${e(`View ${title}`)}">${productImage(item)}<span class="art-spark art-spark-one">✦</span><span class="art-spark art-spark-two">✧</span><span class="art-letter">${e(category.slice(0, 1).toUpperCase())}</span><span class="art-category">${e(category)}</span></a><div class="product-card-content"><p class="product-category">${e(category)}</p><a class="product-title" data-product="${e(item.parent_asin)}" href="${href}">${e(trim(title, 70))}</a>${number(item.avg_rating) > 0 ? `<div class="product-rating"><strong>${number(item.avg_rating).toFixed(1)}</strong><small>/ 5 average</small></div>` : ''}<div class="product-price">${price(item)}</div>${number(item.num_reviews) > 0 ? `<small class="review-count">${number(item.num_reviews)} reviews in the dataset</small>` : ''}${shopperReview(review)}</div></article>`;
}
function historyCards(payload, page, userId, pageSize) {
  const start = page * pageSize;
  const end = Math.min(start + pageSize, payload.items.length);
  const pages = Math.ceil(payload.items.length / pageSize);
  const range = `Reviews ${start + 1} to ${end} of ${payload.items.length}`;
  return `<div id="history-products" class="product-grid history-product-grid" role="group" aria-label="${range}">${payload.items.slice(start, end).map(row => row.item
    ? productCard(row.item, userId, row)
    : `<article class="product-card"><div class="empty-state compact-empty"><p>Product details unavailable</p><small>Item #${e(row.parent_asin)}</small></div><div class="product-card-content">${shopperReview(row)}</div></article>`).join('')}</div>${pages > 1
    ? `<nav class="history-pagination" aria-label="Review pages">${Array.from({length: pages}, (_, index) => `<button type="button" class="history-dot" data-history-page="${index}" aria-controls="history-products" aria-label="Show reviews ${index * pageSize + 1} to ${Math.min((index + 1) * pageSize, payload.items.length)} of ${payload.items.length}"${index === page ? ' aria-current="page"' : ''}><span aria-hidden="true"></span></button>`).join('')}</nav>` : ''}`;
}
function history(payload, userId, pageSize) {
  const context = `<p class="recommendation-note">Verified purchase reviews of this user, newest first.</p><details class="history-context"><summary>About this review history</summary><p>These are reviews marked as verified purchases, not a complete order history. Recommendations may also use unverified reviews. The collaborative model uses an earlier snapshot, so some reviews shown here may be newer than its training history and a reviewed product can still appear in its picks.</p></details>`;
  if (!payload.items.length) return `${context}<div class="empty-state compact-empty"><p>No verified purchase reviews are available for this shopper. Recommendations may still use other reviews.</p></div>`;
  return `${context}<div class="history-carousel" data-history-carousel>${historyCards(payload, 0, userId, pageSize)}</div><p id="history-status" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"></p>`;
}
function recommendations(payload, userId) {
  const explanations = {
    collaborative: 'Collaborative filtering looks for patterns across shopper ratings to suggest products for this profile. It uses the history saved when the model was trained.',
    content_based: 'Content-based filtering uses the titles, descriptions, and features of products this shopper rated positively to find similar products. Category and free-product preferences also help shape the picks.',
    popular: 'Personalized picks were unavailable, so the store is showing popular products instead. These are ranked by review count, with average rating used to break ties.',
  };
  const explanation = explanations[payload.engine_used];
  const caption = payload.engine_used === 'popular'
    ? 'Showing popular products because personalized picks are unavailable.'
    : "Product picks based on this shopper's review history.";
  const note = explanation ? `<p class="recommendation-note">${e(caption)}</p><details class="recommendation-explanation"><summary>Why these picks?</summary><p>${e(explanation)}</p></details>` : '';
  if (!payload.items.length) return `${note}<div class="empty-state"><h3>${payload.engine_used === 'popular' ? 'No popular picks available' : 'No recommendations available'}</h3><p>Try viewing the store as another shopper above.</p></div>`;
  return `${note}<div class="product-grid">${payload.items.map(item => productCard(item, userId)).join('')}</div>`;
}
function details(item) {
  const category = text(item.main_category, 'Amozon finds');
  return `<section class="product-detail"><div class="detail-art">${productImage(item, true)}<span class="detail-art-spark">✦</span><span class="detail-art-letter">${e(category.slice(0, 1).toUpperCase())}</span><span>${e(category)}</span></div><div class="detail-copy"><p class="eyebrow">${e(category)}</p><h1>${e(productTitle(item))}</h1><p class="detail-byline">Sold by <strong>${e(text(item.store, 'Amozon Marketplace'))}</strong> · Item #${e(item.parent_asin)}</p>${number(item.avg_rating) > 0 ? `<div class="detail-rating">${number(item.avg_rating).toFixed(1)} out of 5 based on ${number(item.num_reviews)} reviews</div>` : ''}<div class="detail-price">${price(item, true)}</div><p class="muted">Prices and product information come from a historical dataset.</p>${item.description ? `<p class="detail-description">${e(words(item.description, 100))}</p>` : ''}</div></section>`;
}
function notFound(userId, product = false) {
  return `<section class="empty-state not-found"><span aria-hidden="true">?</span><h1>${product ? 'Product' : 'Page'} not found</h1><p>${product ? 'This product could not be found.' : 'This address does not match a storefront page.'}</p><a class="button button-dark" href="${e(homeURL(userId))}">Back to recommendations</a></section>`;
}
function reviews(payload, page, asin, userId) {
  const totalPages = Math.max(1, payload.page_count);
  const link = target => `${productURL(asin, userId)}${userId ? '&' : '?'}page=${target}#product-reviews`;
  return `<p class="muted">${payload.total_count} total reviews</p>${payload.items.length ? payload.items.map(review => `<article class="review-card"><div class="review-product-mark" aria-hidden="true">A</div><div class="review-body"><div class="review-meta"><span>${e(review.review_rating)} / 5</span>${review.verified_purchase ? '<span class="verified-purchase">Verified purchase</span>' : ''}</div>${review.review_title ? `<h3>${e(review.review_title)}</h3>` : ''}<p>${e(words(text(review.review_text, 'No written review was provided.'), 60))}</p><small>By ${e(review.user_id)}${review.review_date ? ` · ${e(review.review_date)}` : ''}</small></div></article>`).join('') : '<div class="empty-state compact-empty"><p>No reviews are available for this product yet.</p></div>'}${totalPages > 1 ? `<nav class="pagination" aria-label="Review pages">${page > 1 ? `<a data-review-page="${page - 1}" href="${e(link(page - 1))}">← Previous</a>` : ''}<span>Page ${page} of ${totalPages}</span>${page < totalPages ? `<a data-review-page="${page + 1}" href="${e(link(page + 1))}">Next →</a>` : ''}</nav>` : ''}`;
}

return {escapeHTML, productTitle, homeURL, productURL, readRoute, loading, section, shopperPicker, productCard, history, historyCards, recommendations, details, notFound, reviews};
})();


const route = view.readRoute(new URL(window.location.href));
const root = document.getElementById('storefront');
const shoppersElement = document.getElementById('shoppers');
const homeLink = document.getElementById('home-link');
const config = JSON.parse(document.getElementById('app-config').textContent);
const rawWindow = Number(config.retryWindowMs || 300000);
const retryWindow = Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : 300000;
const jobs = new Map();
const state = {
  userId: route.userId, page: route.page, history: null, historyPage: 0, historyPageSize: 5,
};
let disposed = false;
let api;
let shopperPickerEvents;

function updateLinks() {
  const shopper = document.getElementById('user-picker')?.querySelector('.account-name')?.textContent;
  const historyHeading = document.getElementById('history-heading');
  if (shopper && historyHeading) historyHeading.textContent = `${shopper}'s reviews`;
  homeLink.href = view.homeURL(state.userId);
  document.querySelectorAll('[data-product]').forEach(link => {
    link.href = view.productURL(link.dataset.product, state.userId);
  });
  const back = document.getElementById('back-link');
  if (back) back.href = view.homeURL(state.userId);
  document.querySelectorAll('[data-review-page]').forEach(link => {
    const url = new URL(view.productURL(route.asin, state.userId), window.location.origin);
    url.searchParams.set('page', link.dataset.reviewPage);
    url.hash = 'product-reviews';
    link.href = `${url.pathname}${url.search}${url.hash}`;
  });
}

function showError(element, message, retry) {
  element.setAttribute('aria-busy', 'false');
  const box = document.createElement('div');
  box.className = 'empty-state compact-empty';
  const description = document.createElement('p');
  description.textContent = message;
  box.append(description);
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-dark';
    button.textContent = 'Try again';
    button.addEventListener('click', retry);
    box.append(button);
  }
  element.replaceChildren(box);
}

async function loadSection(key, element, operation, render, onSuccess = () => {}) {
  if (disposed) return null;
  jobs.get(key)?.abort();
  const controller = new AbortController();
  jobs.set(key, controller);
  element.setAttribute('aria-busy', 'true');
  element.innerHTML = view.loading(key);
  const current = () => !disposed && jobs.get(key) === controller && !controller.signal.aborted;
  try {
    const payload = await withRetry(operation, {
      signal: controller.signal, windowMs: retryWindow,
      onRetry: () => { if (current()) element.innerHTML = view.loading(key, true); },
    });
    if (!current()) return null;
    element.innerHTML = render(payload);
    element.setAttribute('aria-busy', 'false');
    onSuccess(payload);
    updateLinks();
    return payload;
  } catch (error) {
    if (!current()) return null;
    if (error instanceof APIError && error.status === 404 && ['details', 'reviews'].includes(key)) {
      element.innerHTML = key === 'details' ? view.notFound(state.userId, true)
        : '<div class="empty-state compact-empty"><p>This product could not be found.</p></div>';
      element.setAttribute('aria-busy', 'false');
    } else {
      console.warn(`Unable to load ${key}`, error instanceof APIError ? `HTTP ${error.status}` : error.name);
      showError(element,
        key === 'demo shoppers' ? 'Demo shopper selection is unavailable. Please try again.'
        : error instanceof APIError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)
          ? 'This request could not be completed.'
          : 'Unable to reach the service. Please try again shortly.',
        () => loadSection(key, element, operation, render, onSuccess));
    }
    return null;
  } finally {
    if (jobs.get(key) === controller) jobs.delete(key);
  }
}

function chooseShopper() {
  shopperPickerEvents?.abort();
  const picker = document.getElementById('user-picker');
  if (!picker) return;
  const wrapper = picker.closest('.user-picker');
  const menu = wrapper.querySelector('.shopper-menu');
  const options = [...menu.querySelectorAll('[role="option"]')];
  shopperPickerEvents = new AbortController();
  const events = {signal: shopperPickerEvents.signal};
  let active = options.findIndex(option => option.dataset.shopperId === state.userId);

  function highlight(index) {
    active = Math.max(0, Math.min(index, options.length - 1));
    options.forEach((option, position) => option.classList.toggle('is-active', position === active));
    picker.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView({block: 'nearest'});
  }
  function close() {
    menu.hidden = true;
    picker.setAttribute('aria-expanded', 'false');
    picker.removeAttribute('aria-activedescendant');
    options.forEach(option => option.classList.remove('is-active'));
  }
  function open() {
    menu.hidden = false;
    picker.setAttribute('aria-expanded', 'true');
    picker.focus({preventScroll: true});
    highlight(options.findIndex(option => option.dataset.shopperId === state.userId));
  }
  function select(option) {
    const userId = option.dataset.shopperId;
    const label = option.dataset.shopperLabel;
    close();
    if (userId === state.userId) return;
    state.userId = userId;
    picker.value = userId;
    picker.querySelector('.account-name').textContent = label;
    picker.setAttribute('aria-label', `Change shopper, currently ${label}`);
    options.forEach(row => row.setAttribute('aria-selected', String(row === option)));
    if (route.kind === 'product') {
      window.location.assign(view.homeURL(userId));
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('user_id', userId);
    window.history.replaceState(null, '', url);
    updateLinks();
    if (route.kind === 'home') loadShopperSections();
  }

  picker.addEventListener('click', () => menu.hidden ? open() : close(), events);
  picker.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey) return;
    const isOpen = !menu.hidden;
    if (event.key === 'Tab') {
      if (isOpen) select(options[active]);
      return;
    }
    if (event.key === 'Escape') {
      if (isOpen) { event.preventDefault(); close(); }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) select(options[active]); else open();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!isOpen) open();
      if (event.key === 'Home') highlight(0);
      else if (event.key === 'End') highlight(options.length - 1);
      else if (event.key === 'ArrowUp' && event.altKey) select(options[active]);
      else if (isOpen) highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key.length === 1 && !event.altKey) {
      const key = event.key.toLocaleLowerCase();
      const match = options.findIndex((option, index) => index > active
        && option.dataset.shopperLabel.toLocaleLowerCase().startsWith(key));
      const index = /^\d$/.test(key)
        ? options.findIndex(option => option.dataset.shopperLabel.endsWith(` ${key}`))
        : match >= 0 ? match : options.findIndex(option => option.dataset.shopperLabel.toLocaleLowerCase().startsWith(key));
      if (index >= 0) { event.preventDefault(); if (!isOpen) open(); highlight(index); }
    }
  }, events);
  menu.addEventListener('pointermove', event => {
    const option = event.target.closest('[data-shopper-id]');
    if (option) highlight(options.indexOf(option));
  }, events);
  menu.addEventListener('pointerdown', event => event.preventDefault(), events);
  menu.addEventListener('click', event => {
    const option = event.target.closest('[data-shopper-id]');
    if (option) select(option);
  }, events);
  document.addEventListener('pointerdown', event => {
    if (!wrapper.contains(event.target)) close();
  }, events);
  document.addEventListener('focusin', event => {
    if (!wrapper.contains(event.target)) close();
  }, events);
}

function loadDemoShoppers() {
  shopperPickerEvents?.abort();
  const needsDefaultShopper = !state.userId;
  return loadSection('demo shoppers', shoppersElement, signal => api.demoUsers(signal), users => {
    if (!state.userId) state.userId = users[0].user_id;
    return view.shopperPicker(users, state.userId);
  }, () => {
    chooseShopper();
    if (route.kind === 'home' && needsDefaultShopper) loadShopperSections();
  }).then(users => {
    if (!users && !disposed && route.kind === 'home' && !state.userId) {
      for (const section of ['history', 'recommendations']) {
        showError(document.getElementById(`${section}-content`),
          'Load demo shoppers to explore reviews and recommendations.', loadDemoShoppers);
      }
    }
    return users;
  });
}

function loadShopperSections() {
  if (disposed) return;
  loadHistory();
  loadRecommendations();
}

function loadRecommendations() {
  const userId = state.userId;
  document.getElementById('recommendations-heading').textContent = 'Recommendations';
  return loadSection('recommendations', document.getElementById('recommendations-content'),
    signal => userId ? api.recommendations(userId, signal) : Promise.resolve({items: []}),
    payload => view.recommendations(payload, userId),
    payload => {
      const shopper = document.getElementById('user-picker')?.querySelector('.account-name')?.textContent || 'this shopper';
      document.getElementById('recommendations-heading').textContent = payload.engine_used === 'popular'
        ? 'Popular picks' : `Recommended for ${shopper}`;
    });
}

function historyPageSize() {
  return Number.parseInt(getComputedStyle(document.getElementById('history-content')).getPropertyValue('--history-page-size'), 10) || 5;
}

function sizeHistoryCards() {
  const carousel = document.querySelector('[data-history-carousel]');
  const products = document.getElementById('history-products');
  if (!state.history?.items.length || !carousel || !products) return;
  carousel.getAnimations?.({subtree: true}).forEach(animation => animation.cancel());
  carousel.querySelectorAll('.history-outgoing').forEach(slide => slide.remove());

  // Measure every cached review once at this width, including later pages.
  const template = document.createElement('template');
  template.innerHTML = view.historyCards(state.history, 0, state.userId, state.history.items.length);
  const measure = template.content.querySelector('.history-product-grid');
  measure.removeAttribute('id');
  measure.classList.add('history-measure');
  measure.style.width = `${products.getBoundingClientRect().width}px`;
  measure.setAttribute('aria-hidden', 'true');
  measure.inert = true;
  // Product images are positioned inside fixed artwork areas; measuring needs no downloads.
  measure.querySelectorAll('img').forEach(image => image.remove());
  document.getElementById('history-content').append(measure);
  let height = 0;
  for (const card of measure.children) height = Math.max(height, card.getBoundingClientRect().height);
  measure.remove();
  carousel.style.setProperty('--history-card-height', `${Math.ceil(height)}px`);
}

function showHistoryPage(page, focusDot = false) {
  const carousel = document.querySelector('[data-history-carousel]');
  if (!state.history || !carousel) return;
  const pageSize = historyPageSize();
  const lastPage = Math.max(0, Math.ceil(state.history.items.length / pageSize) - 1);
  const nextPage = Math.max(0, Math.min(page, lastPage));
  const previousPage = state.historyPage;
  const previousSize = state.historyPageSize;
  if (nextPage === previousPage && pageSize === previousSize) {
    if (focusDot) carousel.querySelector('[aria-current="page"]')?.focus({preventScroll: true});
    return;
  }
  carousel.getAnimations?.({subtree: true}).forEach(animation => animation.cancel());
  carousel.querySelectorAll('.history-outgoing').forEach(slide => slide.remove());
  const outgoing = document.getElementById('history-products');
  state.historyPage = nextPage;
  state.historyPageSize = pageSize;
  carousel.innerHTML = view.historyCards(state.history, state.historyPage, state.userId, pageSize);
  const products = document.getElementById('history-products');
  if (focusDot && pageSize === previousSize && outgoing && typeof products.animate === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const options = {duration: 320, easing: 'cubic-bezier(0.4, 0, 0.2, 1)'};
    const width = products.getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(products).columnGap) || 0;
    const offset = (nextPage > previousPage ? 1 : -1) * (width + gap);
    outgoing.removeAttribute('id');
    outgoing.classList.add('history-outgoing');
    outgoing.style.width = `${width}px`;
    outgoing.setAttribute('aria-hidden', 'true');
    outgoing.inert = true;
    carousel.append(outgoing);
    products.animate([
      {transform: `translateX(${offset}px)`},
      {transform: 'translateX(0)'},
    ], options);
    const departure = outgoing.animate([
      {transform: 'translateX(0)'},
      {transform: `translateX(${-offset}px)`},
    ], options);
    departure.finished.then(() => outgoing.remove(), () => outgoing.remove());
  }
  document.getElementById('history-status').textContent = products.getAttribute('aria-label');
  updateLinks();
  if (focusDot) carousel.querySelector('[aria-current="page"]')?.focus({preventScroll: true});
}

function loadHistory() {
  const userId = state.userId;
  state.history = null;
  state.historyPage = 0;
  return loadSection('verified purchase reviews', document.getElementById('history-content'),
    signal => userId ? api.history(userId, signal) : Promise.resolve({items: [], total_count: 0}),
    payload => view.history(payload, userId, historyPageSize()),
    payload => {
      state.history = payload;
      state.historyPageSize = historyPageSize();
      sizeHistoryCards();
    });
}

function loadReviews() {
  return loadSection('reviews', document.getElementById('product-reviews-content'), async signal => {
    let payload = await api.reviews(route.asin, state.page, signal);
    const lastPage = Math.max(1, payload.page_count);
    if (state.page > lastPage) {
      state.page = lastPage;
      payload = await api.reviews(route.asin, state.page, signal);
    }
    return payload;
  }, payload => view.reviews(payload, state.page, route.asin, state.userId), () => {
    const url = new URL(window.location.href);
    if (state.page !== route.page) {
      url.searchParams.set('page', state.page);
      window.history.replaceState(null, '', url);
    }
    if (url.hash === '#product-reviews') document.getElementById('product-reviews')?.scrollIntoView();
  });
}

function setupProjectMenu() {
  const toggle = document.getElementById('project-menu-toggle');
  const menu = document.getElementById('project-menu');
  const close = document.getElementById('project-menu-close');
  if (!toggle || !menu || !close) return;

  toggle.addEventListener('click', () => {
    if (menu.open) return;
    const shopper = document.querySelector('#user-picker .account-name')?.textContent || 'shopper';
    document.getElementById('project-menu-title').textContent = `Hello, ${shopper}`;
    menu.showModal();
    document.documentElement.classList.add('project-menu-open');
    toggle.setAttribute('aria-expanded', 'true');
  });
  close.addEventListener('click', () => menu.close());
  menu.addEventListener('click', event => {
    if (event.target !== menu) return;
    const bounds = menu.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) menu.close();
  });
  // Native dialog behavior handles Escape, focus containment, and background interaction.
  menu.addEventListener('close', () => {
    menu.querySelectorAll('.project-nav details[open]').forEach(section => { section.open = false; });
    document.documentElement.classList.remove('project-menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus({preventScroll: true});
  });
}

function start() {
  setupProjectMenu();
  updateLinks();
  if (route.kind === 'not-found') {
    root.innerHTML = view.notFound(state.userId);
    shoppersElement.replaceChildren();
    shoppersElement.setAttribute('aria-busy', 'false');
    return;
  }
  try {
    api = createAPI(config.apiBaseURL);
  } catch {
    root.innerHTML = '<div class="empty-state"><h1>Storefront unavailable</h1><p>The service address has not been configured correctly.</p></div>';
    shoppersElement.replaceChildren();
    shoppersElement.setAttribute('aria-busy', 'false');
    return;
  }
  if (route.kind === 'home') {
    root.innerHTML = view.section('history', "This shopper's reviews", 'VERIFIED PURCHASE REVIEWS')
      + view.section('recommendations', 'Recommendations', 'DISCOVER SOMETHING NEW');
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-history-page]');
      if (!button) return;
      const page = Number(button.dataset.historyPage);
      if (Number.isSafeInteger(page) && page >= 0) showHistoryPage(page, true);
    });
    root.addEventListener('keydown', event => {
      const button = event.target.closest('[data-history-page]');
      if (!button || !state.history) return;
      const page = Number(button.dataset.historyPage);
      const lastPage = Math.ceil(state.history.items.length / historyPageSize()) - 1;
      const target = {ArrowLeft: page - 1, ArrowRight: page + 1, Home: 0, End: lastPage}[event.key];
      if (target === undefined) return;
      event.preventDefault();
      showHistoryPage(target, true);
    });
    loadDemoShoppers();
    if (state.userId) loadShopperSections();
  } else {
    root.innerHTML = `<nav class="breadcrumbs" aria-label="Breadcrumb"><a id="back-link" href="${view.escapeHTML(view.homeURL(state.userId))}">Home</a><span aria-hidden="true">›</span><span>Product details</span></nav><div id="details-content" aria-live="polite" aria-busy="true">${view.loading('product details')}</div>`
      + view.section('product-reviews', 'Customer reviews', 'WHAT SHOPPERS SAID');
    loadSection('details', document.getElementById('details-content'), signal => api.item(route.asin, signal),
      item => view.details(item), item => { document.title = `${view.productTitle(item)} | Amozon`; });
    loadReviews();
    loadDemoShoppers();
  }
}

let historyLayoutWidth;
const historyResizeObserver = new ResizeObserver(([entry]) => {
  const width = entry.contentRect.width;
  if (!state.history || width === historyLayoutWidth) return;
  historyLayoutWidth = width;
  // Container changes include responsive styles settling after a window resize.
  const pageSize = historyPageSize();
  if (pageSize !== state.historyPageSize) {
    const firstVisible = state.historyPage * state.historyPageSize;
    showHistoryPage(Math.floor(firstVisible / pageSize));
  }
  sizeHistoryCards();
});

window.addEventListener('pagehide', () => {
  historyResizeObserver.disconnect();
  disposed = true;
  shopperPickerEvents?.abort();
  jobs.forEach(controller => controller.abort());
});
// Reload requests cancelled on pagehide when a browser restores its back/forward cache.
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
start();
const historyContainer = document.getElementById('history-content');
if (historyContainer) historyResizeObserver.observe(historyContainer);
