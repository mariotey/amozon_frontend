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
    async shoppers(signal) {
      return validate(await get('/api/v1/randomusers', {n: 5}, signal),
        value => list(value, row => record(row) && typeof row.user_id === 'string' && row.user_id.length > 0));
    },
    async history(userId, page, signal) {
      return validate(await get(`/api/v1/users/${encodeURIComponent(userId)}/history`,
        {verified_only: true, page, page_size: 5}, signal),
        data => record(data) && list(data.items, row => record(row) && (row.item == null || product(row.item)))
          && Number.isInteger(data.total_count) && data.total_count >= 0
          && Number.isInteger(data.page_count) && data.page_count >= 0);
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
  return `<div class="empty-state compact-empty"><p>${e(waiting ? 'Waiting for the service to respond' : `Loading ${label}`)}<span class="loading-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>${waiting ? '<p class="loading-help">The service may be waking up. This section will update automatically.</p>' : ''}</div>`;
}
function section(id, title, eyebrow = '') {
  return `<section class="section-block" id="${id}" aria-labelledby="${id}-heading"><div class="section-heading"><div>${eyebrow ? `<p class="eyebrow">${e(eyebrow)}</p>` : ''}<h2 id="${id}-heading">${e(title)}</h2></div></div><div id="${id}-content" aria-live="polite" aria-busy="true">${loading(title.toLowerCase())}</div></section>`;
}
function shopperPicker(users, selected) {
  const ids = [...new Set(users.map(user => user.user_id))];
  if (selected && !ids.includes(selected)) ids.unshift(selected);
  if (!ids.length) return '<div class="user-picker account-picker"><span>Hello,</span><strong>No shoppers available</strong></div>';
  return `<div class="user-picker account-picker"><label for="user-picker">Hello,</label><select id="user-picker" aria-label="Select shopper">${ids.map(id => `<option value="${e(id)}"${id === selected ? ' selected' : ''}>${e(id)}</option>`).join('')}</select></div>`;
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
function productCard(item, userId) {
  const category = text(item.main_category, 'Amozon finds');
  const title = productTitle(item);
  const href = e(productURL(item.parent_asin, userId));
  return `<article class="product-card"><a class="product-art" href="${href}" data-product="${e(item.parent_asin)}" aria-label="${e(`View ${title}`)}">${productImage(item)}<span class="art-spark art-spark-one">✦</span><span class="art-spark art-spark-two">✧</span><span class="art-letter">${e(category.slice(0, 1).toUpperCase())}</span><span class="art-category">${e(category)}</span></a><div class="product-card-content"><p class="product-category">${e(category)}</p><a class="product-title" data-product="${e(item.parent_asin)}" href="${href}">${e(trim(title, 70))}</a>${number(item.avg_rating) > 0 ? `<div class="product-rating"><strong>${number(item.avg_rating).toFixed(1)}</strong><small>/ 5 average</small></div>` : ''}<div class="product-price">${price(item)}</div>${number(item.num_reviews) > 0 ? `<small class="review-count">${number(item.num_reviews)} reviews in the database</small>` : ''}</div></article>`;
}
function popular(items, userId) {
  return items.length ? `<div class="product-grid">${items.map(item => productCard(item, userId)).join('')}</div>` : '<div class="empty-state compact-empty"><p>No popular items available.</p></div>';
}
function history(payload, page, userId) {
  if (!payload.items.length) return '<div class="empty-state compact-empty"><p>No verified purchase reviews available for this shopper.</p><p>Recommendations may still use unverified reviews.</p></div>';
  const totalPages = Math.max(1, payload.page_count);
  return `<p class="recommendation-note">Products from reviews marked as verified purchases, newest reviews first. Recommendations may also use unverified reviews.</p><div class="product-grid history-product-grid">${payload.items.map(row => row.item
    ? productCard(row.item, userId)
    : `<article class="product-card"><div class="empty-state compact-empty"><p>Product details unavailable</p><small>Item #${e(row.parent_asin)}</small></div></article>`).join('')}</div>${totalPages > 1
    ? `<nav class="pagination" aria-label="Verified purchase review pages">${page > 1 ? `<button type="button" data-history-page="${page - 1}">Previous</button>` : ''}<span>Page ${page} of ${totalPages}</span>${page < totalPages ? `<button type="button" data-history-page="${page + 1}">Next</button>` : ''}</nav>` : ''}`;
}
function recommendations(payload, userId) {
  if (payload.engine_used === 'popular') {
    return `${payload.items.length ? '<p class="recommendation-note">Showing popular products because personalized recommendations are unavailable.</p>' : ''}${popular(payload.items, userId)}`;
  }
  if (!payload.items.length) return `<div class="empty-state"><span aria-hidden="true">✦</span><h3>No recommendations available</h3><p>${e(text(payload.reason, 'Try selecting another shopper ID.'))}</p></div>`;
  return `${payload.engine_used ? `<p class="recommendation-note">Selected using ${e(payload.engine_used)} recommendations.</p>` : ''}<div class="product-grid">${payload.items.map(item => productCard(item, userId)).join('')}</div>`;
}
function details(item) {
  const category = text(item.main_category, 'Amozon finds');
  const facts = [['Popularity', item.popularity_segment], ['Quality score', item.quality_score == null ? null : number(item.quality_score).toFixed(2)], ['Verified reviews', item.num_verified_reviews], ['Price bucket', item.price_bucket]];
  return `<section class="product-detail"><div class="detail-art">${productImage(item, true)}<span class="detail-art-spark">✦</span><span class="detail-art-letter">${e(category.slice(0, 1).toUpperCase())}</span><span>${e(category)}</span></div><div class="detail-copy"><p class="eyebrow">${e(category)}</p><h1>${e(productTitle(item))}</h1><p class="detail-byline">Sold by <strong>${e(text(item.store, 'Amozon Marketplace'))}</strong> · Item #${e(item.parent_asin)}</p>${number(item.avg_rating) > 0 ? `<div class="detail-rating">${number(item.avg_rating).toFixed(1)} out of 5 based on ${number(item.num_reviews)} reviews</div>` : ''}<div class="detail-price">${price(item, true)}</div><dl class="detail-facts">${facts.filter(([, value]) => value != null && value !== '').map(([label, value]) => `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>${item.description ? `<p class="detail-description">${e(words(item.description, 100))}</p>` : ''}</div></section>`;
}
function notFound(userId, product = false) {
  return `<section class="empty-state not-found"><span aria-hidden="true">?</span><h1>${product ? 'Product' : 'Page'} not found</h1><p>${product ? 'This product could not be found.' : 'This address does not match a storefront page.'}</p><a class="button button-dark" href="${e(homeURL(userId))}">Back to recommendations</a></section>`;
}
function reviews(payload, page, asin, userId) {
  const totalPages = Math.max(1, payload.page_count);
  const link = target => `${productURL(asin, userId)}${userId ? '&' : '?'}page=${target}#product-reviews`;
  return `<p class="muted">${payload.total_count} total reviews</p>${payload.items.length ? payload.items.map(review => `<article class="review-card"><div class="review-product-mark" aria-hidden="true">A</div><div class="review-body"><div class="review-meta"><span>${e(review.review_rating)} / 5</span>${review.verified_purchase ? '<span class="verified-pill">Verified purchase</span>' : ''}</div>${review.review_title ? `<h3>${e(review.review_title)}</h3>` : ''}<p>${e(words(text(review.review_text, 'No written review was provided.'), 60))}</p><small>By ${e(review.user_id)}${review.review_date ? ` · ${e(review.review_date)}` : ''}</small></div></article>`).join('') : '<div class="empty-state compact-empty"><p>No reviews are available for this product yet.</p></div>'}${totalPages > 1 ? `<nav class="pagination" aria-label="Review pages">${page > 1 ? `<a data-review-page="${page - 1}" href="${e(link(page - 1))}">← Previous</a>` : ''}<span>Page ${page} of ${totalPages}</span>${page < totalPages ? `<a data-review-page="${page + 1}" href="${e(link(page + 1))}">Next →</a>` : ''}</nav>` : ''}`;
}

return {escapeHTML, productTitle, homeURL, productURL, readRoute, loading, section, shopperPicker, productCard, popular, history, recommendations, details, notFound, reviews};
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
  userId: route.userId, shoppersReady: false, page: route.page,
};
let disposed = false;
let api;

function updateLinks() {
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
        error instanceof APIError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)
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
  const picker = document.getElementById('user-picker');
  if (!picker) return;
  picker.addEventListener('change', () => {
    state.userId = picker.value;
    const url = new URL(window.location.href);
    url.searchParams.set('user_id', state.userId);
    window.history.replaceState(null, '', url);
    updateLinks();
    if (route.kind === 'home') loadShopperSections();
  });
}

function loadShoppers() {
  return loadSection('shoppers', shoppersElement, signal => api.shoppers(signal), users => {
    if (!state.userId) state.userId = users[0]?.user_id || '';
    return view.shopperPicker(users, state.userId);
  }, () => {
    state.shoppersReady = true;
    chooseShopper();
    if (route.kind === 'home') loadShopperSections();
  });
}

function loadShopperSections() {
  if (disposed) return;
  if (state.shoppersReady) {
    loadHistory();
    loadRecommendations();
  } else {
    for (const section of ['history', 'recommendations']) {
      showError(document.getElementById(`${section}-content`),
        'Load shoppers to see verified purchase reviews and recommendations.', () => loadShoppers());
    }
  }
}

function loadRecommendations() {
  const userId = state.userId;
  return loadSection('recommendations', document.getElementById('recommendations-content'),
    signal => userId ? api.recommendations(userId, signal) : Promise.resolve({items: []}),
    payload => view.recommendations(payload, userId));
}

function loadHistory(page = 1) {
  const userId = state.userId;
  let currentPage = page;
  return loadSection('verified purchase reviews', document.getElementById('history-content'), async signal => {
    if (!userId) return {items: [], total_count: 0, page_count: 0};
    let payload = await api.history(userId, currentPage, signal);
    const lastPage = Math.max(1, payload.page_count);
    if (currentPage > lastPage) {
      currentPage = lastPage;
      payload = await api.history(userId, currentPage, signal);
    }
    return payload;
  }, payload => view.history(payload, currentPage, userId));
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

function start() {
  updateLinks();
  if (route.kind === 'not-found') {
    root.innerHTML = view.notFound(state.userId);
    shoppersElement.replaceChildren();
    shoppersElement.setAttribute('aria-busy', 'false');
    return;
  }
  try {
    api = createAPI(config.apiBaseURL || 'https://amozon-backend-tg7x.onrender.com');
  } catch {
    root.innerHTML = '<div class="empty-state"><h1>Storefront unavailable</h1><p>The service address has not been configured correctly.</p></div>';
    shoppersElement.replaceChildren();
    shoppersElement.setAttribute('aria-busy', 'false');
    return;
  }
  if (route.kind === 'home') {
    root.innerHTML = view.section('history', 'Verified purchase reviews', 'PRODUCTS YOU REVIEWED')
      + view.section('recommendations', 'Recommended for you', 'PICKED FOR YOUR PARTICULAR VIBE');
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-history-page]');
      if (!button) return;
      const page = Number(button.dataset.historyPage);
      if (Number.isSafeInteger(page) && page > 0) loadHistory(page);
    });
    loadShoppers().then(() => {
      if (!state.shoppersReady) loadShopperSections();
    });
  } else {
    root.innerHTML = `<nav class="breadcrumbs" aria-label="Breadcrumb"><a id="back-link" href="${view.escapeHTML(view.homeURL(state.userId))}">Home</a><span aria-hidden="true">›</span><span>Product details</span></nav><div id="details-content" aria-live="polite" aria-busy="true">${view.loading('product details')}</div>`
      + view.section('product-reviews', 'Customer reviews', 'WHAT SHOPPERS SAID');
    loadSection('details', document.getElementById('details-content'), signal => api.item(route.asin, signal),
      item => view.details(item), item => { document.title = `${view.productTitle(item)} | Amozon`; });
    loadReviews();
    loadShoppers();
  }
}

window.addEventListener('pagehide', () => {
  disposed = true;
  jobs.forEach(controller => controller.abort());
});
// Reload requests cancelled on pagehide when a browser restores its back/forward cache.
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
start();
