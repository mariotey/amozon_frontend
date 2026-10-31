// Shared product cards, safe images, prices, and fractional five-star ratings.
import { escapeHTML as e, record, text, productTitle, trim, number } from '../utils.js';
import { productURL } from '../navigation.js';
export function starRating(value) {
  const rating = Number(value);
  if (value == null || value === '' || !Number.isFinite(rating)) {
    return '<span class="muted">Rating unavailable</span>';
  }
  const score = Math.round(Math.min(5, Math.max(0, rating)) * 10) / 10;
  const label = `${score} out of 5 stars`;
  const star =
    '<svg viewBox="0 0 24 24" aria-hidden="true" ' +
    'focusable="false"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 ' +
    '6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z"/></svg>';
  const stars = Array.from(
    {
      length: 5,
    },
    (_, index) => {
      const fill = Math.round(Math.min(1, Math.max(0, score - index)) * 100);
      return (
        '<span class="rating-star" aria-hidden="true">' +
        `${star}` +
        '<span class="rating-star-fill" style="width: ' +
        `${fill}` +
        '%">' +
        `${star}` +
        '</span></span>'
      );
    },
  ).join('');
  return (
    '<span class="star-rating" role="img" aria-label="' +
    `${label}` +
    '" title="' +
    `${label}` +
    '">' +
    `${stars}` +
    '</span>'
  );
}
export function price(item, details = false) {
  if (item.is_free) return '<strong>Free</strong>';
  if (number(item.price) > 0)
    return `<span>$</span><strong>${number(item.price).toFixed(2)}</strong>`;
  return '<strong>' + `${details ? 'Price not listed' : 'See details'}` + '</strong>';
}
export function productImage(item, details = false) {
  const candidates = [
    record(item.image_url) ? item.image_url.large : item.image_url,
    item.item_images?.large,
  ].flat();
  const source = candidates.find((value) => {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
      return ['https:', 'http:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  });
  if (!source) return '';
  const title = productTitle(item);
  return (
    '<img class="product-image" src="' +
    `${e(source)}` +
    '" alt="' +
    `${e(title)}` +
    '"' +
    `${details ? '' : ' loading="lazy"'}` +
    ' decoding="async">'
  );
}
export function shopperReview(review) {
  if (!review) return '';
  const rating = number(review.review_rating);
  const date =
    review.review_date == null || review.review_date === '' ? null : new Date(review.review_date);
  const validDate = date && Number.isFinite(date.getTime());
  const reviewed = validDate
    ? new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    : '';
  return (
    '<div class="shopper-review">' +
    "<span>This shopper's rating: <strong>" +
    `${rating >= 1 && rating <= 5 ? `${e(rating)}/5` : 'Not available'}` +
    '</strong></span>' +
    `${reviewed ? '<small>Reviewed <time datetime="' + `${date.toISOString()}` + '">' + `${
      e(reviewed)
    }` + '</time></small>' : ''}` +
    '</div>'
  );
}
export function productCard(item, userId, review = null) {
  const category = text(item.main_category, 'Amozon finds');
  const title = productTitle(item);
  const href = e(productURL(item.parent_asin, userId));
  return (
    '<article class="product-card">' +
    '<a class="product-art" href="' +
    `${href}` +
    '" data-product="' +
    `${e(item.parent_asin)}` +
    '" aria-label="' +
    `${e(`View ${title}`)}` +
    '">' +
    `${productImage(item)}` +
    '<span class="art-spark art-spark-one">✦</span>' +
    '<span class="art-spark art-spark-two">✧</span>' +
    '<span class="art-letter">' +
    `${e(category.slice(0, 1).toUpperCase())}` +
    '</span><span class="art-category">' +
    `${e(category)}` +
    '</span></a><div class="product-card-content">' +
    '<p class="product-category">' +
    `${e(category)}` +
    '</p><a class="product-title" data-product="' +
    `${e(item.parent_asin)}` +
    '" href="' +
    `${href}` +
    '">' +
    `${e(trim(title, 70))}` +
    '</a>' +
    `${number(item.avg_rating) > 0 ? '<div class="product-rating"><strong>' + `${
      number(item.avg_rating).toFixed(1)
    }` + '</strong><small>/ 5 average</small></div>' : ''}` +
    '<div class="product-price">' +
    `${price(item)}` +
    '</div>' +
    `${number(item.num_reviews) > 0 ? '<small class="review-count">' + `${
      number(item.num_reviews)
    }` + ' reviews in the dataset</small>' : ''}` +
    `${shopperReview(review)}` +
    '</div></article>'
  );
}
