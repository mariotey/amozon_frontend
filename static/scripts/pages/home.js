// Home-page requests, cached review carousel, animation, and responsive height measurements.
import { history, historyCards, recommendations } from './home-view.js';
export function createHomePage({
  api,
  state: shopper,
  root,
  loadSection,
  updateLinks,
  isDisposed,
}) {
  const state = {
    history: null,
    historyPage: 0,
    historyPageSize: 5,
  };
  const events = new AbortController();
  function loadShopperSections() {
    if (isDisposed()) return;
    loadHistory();
    loadRecommendations();
  }
  function loadRecommendations() {
    const userId = shopper.userId;
    document.getElementById('recommendations-heading').textContent = 'Recommendations';
    return loadSection(
      'recommendations',
      document.getElementById('recommendations-content'),
      (signal) =>
        userId
          ? api.recommendations(userId, signal)
          : Promise.resolve({
              items: [],
            }),
      (payload) => recommendations(payload, userId),
      (payload) => {
        const shopper =
          document.getElementById('user-picker')?.querySelector('.account-name')?.textContent ||
          'this shopper';
        document.getElementById('recommendations-heading').textContent =
          payload.engine_used === 'popular' ? 'Popular picks' : `Recommended for ${shopper}`;
      },
    );
  }
  function historyPageSize() {
    return (
      Number.parseInt(
        getComputedStyle(document.getElementById('history-content')).getPropertyValue(
          '--history-page-size',
        ),
        10,
      ) || 5
    );
  }
  function sizeHistoryCards() {
    const carousel = document.querySelector('[data-history-carousel]');
    const products = document.getElementById('history-products');
    if (!state.history?.items.length || !carousel || !products) return;
    carousel
      .getAnimations?.({
        subtree: true,
      })
      .forEach((animation) => animation.cancel());
    carousel.querySelectorAll('.history-outgoing').forEach((slide) => slide.remove());

    // Measure every cached review once at this width, including later pages.
    const template = document.createElement('template');
    template.innerHTML = historyCards(state.history, 0, shopper.userId, state.history.items.length);
    const measure = template.content.querySelector('.history-product-grid');
    measure.removeAttribute('id');
    measure.classList.add('history-measure');
    measure.style.width = `${products.getBoundingClientRect().width}px`;
    measure.setAttribute('aria-hidden', 'true');
    measure.inert = true;
    // Product images are positioned inside fixed artwork areas; measuring needs no downloads.
    measure.querySelectorAll('img').forEach((image) => image.remove());
    document.getElementById('history-content').append(measure);
    let height = 0;
    for (const card of measure.children)
      height = Math.max(height, card.getBoundingClientRect().height);
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
      if (focusDot)
        carousel.querySelector('[aria-current="page"]')?.focus({
          preventScroll: true,
        });
      return;
    }
    carousel
      .getAnimations?.({
        subtree: true,
      })
      .forEach((animation) => animation.cancel());
    carousel.querySelectorAll('.history-outgoing').forEach((slide) => slide.remove());
    const outgoing = document.getElementById('history-products');
    state.historyPage = nextPage;
    state.historyPageSize = pageSize;
    carousel.innerHTML = historyCards(state.history, state.historyPage, shopper.userId, pageSize);
    const products = document.getElementById('history-products');
    if (
      focusDot &&
      pageSize === previousSize &&
      outgoing &&
      typeof products.animate === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const options = {
        duration: 320,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      };
      const width = products.getBoundingClientRect().width;
      const gap = Number.parseFloat(getComputedStyle(products).columnGap) || 0;
      const offset = (nextPage > previousPage ? 1 : -1) * (width + gap);
      outgoing.removeAttribute('id');
      outgoing.classList.add('history-outgoing');
      outgoing.style.width = `${width}px`;
      outgoing.setAttribute('aria-hidden', 'true');
      outgoing.inert = true;
      carousel.append(outgoing);
      products.animate(
        [
          {
            transform: `translateX(${offset}px)`,
          },
          {
            transform: 'translateX(0)',
          },
        ],
        options,
      );
      const departure = outgoing.animate(
        [
          {
            transform: 'translateX(0)',
          },
          {
            transform: `translateX(${-offset}px)`,
          },
        ],
        options,
      );
      departure.finished.then(
        () => outgoing.remove(),
        () => outgoing.remove(),
      );
    }
    document.getElementById('history-status').textContent = products.getAttribute('aria-label');
    updateLinks();
    if (focusDot)
      carousel.querySelector('[aria-current="page"]')?.focus({
        preventScroll: true,
      });
  }
  function loadHistory() {
    const userId = shopper.userId;
    state.history = null;
    state.historyPage = 0;
    return loadSection(
      'history',
      document.getElementById('history-content'),
      (signal) =>
        userId
          ? api.history(userId, signal)
          : Promise.resolve({
              items: [],
              total_count: 0,
            }),
      (payload) => history(payload, userId, historyPageSize()),
      (payload) => {
        state.history = payload;
        state.historyPageSize = historyPageSize();
        sizeHistoryCards();
      },
    );
  }
  root.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('[data-history-page]');
      if (!button) return;
      const page = Number(button.dataset.historyPage);
      if (Number.isSafeInteger(page) && page >= 0) showHistoryPage(page, true);
    },
    {
      signal: events.signal,
    },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      const button = event.target.closest('[data-history-page]');
      if (!button || !state.history) return;
      const page = Number(button.dataset.historyPage);
      const lastPage = Math.ceil(state.history.items.length / historyPageSize()) - 1;
      const target = {
        ArrowLeft: page - 1,
        ArrowRight: page + 1,
        Home: 0,
        End: lastPage,
      }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      showHistoryPage(target, true);
    },
    {
      signal: events.signal,
    },
  );
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
  const historyContainer = document.getElementById('history-content');
  if (historyContainer) historyResizeObserver.observe(historyContainer);
  return {
    load: loadShopperSections,
    dispose() {
      events.abort();
      historyResizeObserver.disconnect();
    },
  };
}
