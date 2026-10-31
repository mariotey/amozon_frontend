// Product details and paginated customer reviews use the same shared card/rating helpers.
import { escapeHTML as e, text, productTitle, words, number } from '../utils.js';
import { productURL } from '../navigation.js';
import { starRating, productImage, price } from '../components/products.js';
export function details(item) {
  const category = text(item.main_category, 'Amozon finds');
  return (
    '<section class="product-detail"><div class="detail-art">' +
    `${productImage(item, true)}` +
    '<span class="detail-art-spark">✦</span>' +
    '<span class="detail-art-letter">' +
    `${e(category.slice(0, 1).toUpperCase())}` +
    '</span><span>' +
    `${e(category)}` +
    '</span></div><div class="detail-copy">' +
    '<p class="eyebrow">' +
    `${e(category)}` +
    '</p><h1>' +
    `${e(productTitle(item))}` +
    '</h1><p class="detail-byline">Sold by <strong>' +
    `${e(text(item.store, 'Amozon Marketplace'))}` +
    '</strong> · Item #' +
    `${e(item.parent_asin)}` +
    '</p>' +
    `${number(item.avg_rating) > 0 ? '<div class="detail-rating">' + `${
      starRating(item.avg_rating)
    }` + `${
      number(item.num_reviews) > 0
          ? `<span>Based on ${number(item.num_reviews)} reviews</span>`
          : ''
    }` + '</div>' : ''}` +
    '<div class="detail-price">' +
    `${price(item, true)}` +
    '</div><p class="muted">Prices and product information ' +
    'come from a historical dataset.</p>' +
    `${
      item.description
        ? '<p class="detail-description">' + `${e(words(item.description, 100))}` + '</p>'
        : ''
    }` +
    '</div></section>'
  );
}
export function reviews(payload, page, asin, userId) {
  const totalPages = Math.max(1, payload.page_count);
  const link = (target) =>
    `${productURL(asin, userId)}` +
    `${userId ? '&' : '?'}` +
    'page=' +
    `${target}` +
    '#product-reviews';
  return (
    '<p class="muted">' +
    `${payload.total_count}` +
    ' total reviews</p>' +
    `${
      payload.items.length
        ? payload.items
            .map(
              (review) =>
                '<article class="review-card">' +
                '<div class="review-product-mark" ' +
                'aria-hidden="true">A</div><div class="review-body">' +
                '<div class="review-meta">' +
                `${starRating(review.review_rating)}` +
                `${
                  review.verified_purchase
                    ? '<span class="verified-purchase">Verified purchase</span>'
                    : ''
                }` +
                '</div>' +
                `${review.review_title ? `<h3>${e(review.review_title)}</h3>` : ''}` +
                '<p>' +
                `${e(words(text(review.review_text, 'No written review was provided.'), 60))}` +
                '</p><small>By ' +
                `${e(review.user_id)}` +
                `${review.review_date ? ` · ${e(review.review_date)}` : ''}` +
                '</small></div></article>',
            )
            .join('')
        : '<div class="empty-state compact-empty">' +
          '<p>No reviews are available for this product yet.</p></div>'
    }` +
    `${totalPages > 1 ? '<nav class="pagination" aria-label="Review pages">' + `${
      page > 1
          ? '<a data-review-page="' +
            `${page - 1}` +
            '" href="' +
            `${e(link(page - 1))}` +
            '">← Previous</a>'
          : ''
    }` + '<span>Page ' + `${page}` + ' of ' + `${totalPages}` + '</span>' + `${
      page < totalPages
          ? '<a data-review-page="' +
            `${page + 1}` +
            '" href="' +
            `${e(link(page + 1))}` +
            '">Next →</a>'
          : ''
    }` + '</nav>' : ''}`
  );
}
