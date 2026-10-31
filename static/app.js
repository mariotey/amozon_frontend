// Entry point: shared navigation and lifecycle, then delegate to the current page.
import { DEMO_SHOPPERS } from './scripts/config.js';
import { createAPI } from './scripts/api.js';
import { homeURL, productURL, readRoute } from './scripts/navigation.js';
import { notFound, createSectionLoader } from './scripts/components/feedback.js';
import { shopperPicker, setupShopperPicker } from './scripts/components/shopper.js';
import { setupProjectMenu } from './scripts/components/drawer.js';
import { createHomePage } from './scripts/pages/home.js';
import { createProductPage } from './scripts/pages/product.js';
const route = readRoute(new URL(window.location.href));
const root = document.getElementById('storefront');
const shoppersElement = document.getElementById('shoppers');
const homeLink = document.getElementById('home-link');
const config = JSON.parse(document.getElementById('app-config').textContent);
const rawWindow = Number(config.retryWindowMs || 300000);
const retryWindow = Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : 300000;
const state = {
  userId: route.userId,
  page: route.page,
};
let page;
let disposePicker;
const sections = createSectionLoader({
  state,
  retryWindow,
  updateLinks,
});

// Failed catalogue images reveal the existing decorative fallback.
document.addEventListener(
  'error',
  (event) => {
    if (
      event.target instanceof HTMLImageElement &&
      event.target.classList.contains('product-image')
    ) {
      event.target.remove();
    }
  },
  true,
);
function updateLinks() {
  const shopper = document
    .getElementById('user-picker')
    ?.querySelector('.account-name')?.textContent;
  const historyHeading = document.getElementById('history-heading');
  if (shopper && historyHeading) historyHeading.textContent = `${shopper}'s reviews`;
  homeLink.href = homeURL(state.userId);
  document.querySelectorAll('[data-product]').forEach((link) => {
    link.href = productURL(link.dataset.product, state.userId);
  });
  const back = document.getElementById('back-link');
  if (back) back.href = homeURL(state.userId);
  document.querySelectorAll('[data-review-page]').forEach((link) => {
    const url = new URL(productURL(route.asin, state.userId), window.location.origin);
    url.searchParams.set('page', link.dataset.reviewPage);
    url.hash = 'product-reviews';
    link.href = `${url.pathname}${url.search}${url.hash}`;
  });
}
function start() {
  setupProjectMenu();
  updateLinks();
  if (route.kind === 'not-found') {
    root.innerHTML = notFound(state.userId);
    shoppersElement.replaceChildren();
    shoppersElement.setAttribute('aria-busy', 'false');
    return;
  }
  let api;
  try {
    api = createAPI(config.apiBaseURL);
  } catch {
    root.innerHTML =
      '<div class="empty-state"><h1>Storefront unavailable</h1>' +
      '<p>The service address has not been configured ' +
      'correctly.</p></div>';
    shoppersElement.replaceChildren();
    shoppersElement.setAttribute('aria-busy', 'false');
    return;
  }
  const context = {
    api,
    route,
    state,
    root,
    loadSection: sections.load,
    updateLinks,
    isDisposed: sections.isDisposed,
  };
  page = route.kind === 'home' ? createHomePage(context) : createProductPage(context);
  if (!state.userId) state.userId = DEMO_SHOPPERS[0].user_id;
  shoppersElement.innerHTML = shopperPicker(DEMO_SHOPPERS, state.userId);
  shoppersElement.setAttribute('aria-busy', 'false');
  disposePicker = setupShopperPicker({
    state,
    route,
    updateLinks,
    onChange: () => page.load(),
  });
  updateLinks();
  page.load();
}
window.addEventListener('pagehide', () => {
  page?.dispose?.();
  disposePicker?.();
  sections.dispose();
});
// Requests cancelled on pagehide restart if restored from the back/forward cache.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
start();
