// Render API-backed home content; the static section layout is in templates/home.html.
import { escapeHTML as e } from '../utils.js';
import { productCard, shopperReview } from '../components/products.js';
export function historyCards(payload, page, userId, pageSize) {
  const start = page * pageSize;
  const end = Math.min(start + pageSize, payload.items.length);
  const pages = Math.ceil(payload.items.length / pageSize);
  const range = `Reviews ${start + 1} to ${end} of ${payload.items.length}`;
  return (
    '<div id="history-products" class="product-grid ' +
    'history-product-grid" role="group" aria-label="' +
    `${range}` +
    '">' +
    `${payload.items
      .slice(start, end)
      .map((row) =>
        row.item
          ? productCard(row.item, userId, row)
          : '<article class="product-card">' +
            '<div class="empty-state compact-empty">' +
            '<p>Product details unavailable</p><small>Item #' +
            `${e(row.parent_asin)}` +
            '</small></div><div class="product-card-content">' +
            `${shopperReview(row)}` +
            '</div></article>',
      )
      .join('')}` +
    '</div>' +
    `${
      pages > 1
        ? '<nav class="history-pagination" aria-label="Review ' +
          'pages">' +
          `${Array.from(
            {
              length: pages,
            },
            (_, index) =>
              '<button type="button" class="history-dot" ' +
              'data-history-page="' +
              `${index}` +
              '" aria-controls="history-products" aria-label="Show ' +
              'reviews ' +
              `${index * pageSize + 1}` +
              ' to ' +
              `${Math.min((index + 1) * pageSize, payload.items.length)}` +
              ' of ' +
              `${payload.items.length}` +
              '"' +
              `${index === page ? ' aria-current="page"' : ''}` +
              '><span aria-hidden="true"></span></button>',
          ).join('')}` +
          '</nav>'
        : ''
    }`
  );
}
export function history(payload, userId, pageSize) {
  const context =
    '<p class="recommendation-note">Verified purchase reviews ' +
    'of this user, newest first.</p>' +
    '<details class="history-context">' +
    '<summary>About this review history</summary>' +
    '<p>These are reviews marked as verified purchases, not a ' +
    'complete order history. Recommendations may also use ' +
    'unverified reviews. The collaborative model uses an earlier ' +
    'snapshot, so some reviews shown here may be newer than its ' +
    'training history and a reviewed product can still appear in ' +
    'its picks.</p></details>';
  if (!payload.items.length)
    return (
      `${context}` +
      '<div class="empty-state compact-empty">' +
      '<p>No verified purchase reviews are available for this ' +
      'shopper. Recommendations may still use other reviews.</p>' +
      '</div>'
    );
  return (
    `${context}` +
    '<div class="history-carousel" data-history-carousel>' +
    `${historyCards(payload, 0, userId, pageSize)}` +
    '</div><p id="history-status" class="visually-hidden" ' +
    'role="status" aria-live="polite" aria-atomic="true">' +
    '</p>'
  );
}
export function recommendations(payload, userId) {
  const explanations = {
    collaborative:
      'Collaborative filtering looks for patterns across shopper ' +
      'ratings to suggest products for this profile. It uses the ' +
      'history saved when the model was trained.',
    content_based:
      'Content-based filtering uses the titles, descriptions, and ' +
      'features of products this shopper rated positively to find ' +
      'similar products. Category and free-product preferences ' +
      'also help shape the picks.',
    popular:
      'Personalized picks were unavailable, so the store is ' +
      'showing popular products instead. These are ranked by ' +
      'review count, with average rating used to break ties.',
  };
  const explanation = explanations[payload.engine_used];
  const caption =
    payload.engine_used === 'popular'
      ? 'Showing popular products because personalized picks are unavailable.'
      : "Product picks based on this shopper's review history.";
  const note = explanation
    ? '<p class="recommendation-note">' +
      `${e(caption)}` +
      '</p><details class="recommendation-explanation">' +
      '<summary>Why these picks?</summary><p>' +
      `${e(explanation)}` +
      '</p></details>'
    : '';
  if (!payload.items.length)
    return (
      `${note}` +
      '<div class="empty-state"><h3>' +
      `${
        payload.engine_used === 'popular'
            ? 'No popular picks available'
            : 'No recommendations available'
      }` +
      '</h3><p>Try viewing the store as another shopper above.</p>' +
      '</div>'
    );
  return (
    `${note}` +
    '<div class="product-grid">' +
    `${payload.items.map((item) => productCard(item, userId)).join('')}` +
    '</div>'
  );
}
