// Product requests preserve shopper context and clamp review pages to the available range.
import { productTitle } from '../utils.js';
import { details, reviews } from './product-view.js';
export function createProductPage({ api, route, state, loadSection }) {
  function loadReviews() {
    return loadSection(
      'reviews',
      document.getElementById('product-reviews-content'),
      async (signal) => {
        let payload = await api.reviews(route.asin, state.page, signal);
        const lastPage = Math.max(1, payload.page_count);
        if (state.page > lastPage) {
          state.page = lastPage;
          payload = await api.reviews(route.asin, state.page, signal);
        }
        return payload;
      },
      (payload) => reviews(payload, state.page, route.asin, state.userId),
      () => {
        const url = new URL(window.location.href);
        if (state.page !== route.page) {
          url.searchParams.set('page', state.page);
          window.history.replaceState(null, '', url);
        }
        if (url.hash === '#product-reviews')
          document.getElementById('product-reviews')?.scrollIntoView();
      },
    );
  }
  return {
    load() {
      loadSection(
        'details',
        document.getElementById('details-content'),
        (signal) => api.item(route.asin, signal),
        (item) => details(item),
        (item) => {
          document.title = `${productTitle(item)} | Amozon`;
        },
      );
      loadReviews();
    },
  };
}
