// URL helpers preserve shopper context across full-page navigation.
export function homeURL(userId = '') {
  return userId
    ? `/?${new URLSearchParams({
        user_id: userId,
      })}`
    : '/';
}
export function productURL(asin, userId = '') {
  return (
    '/product/' +
    `${encodeURIComponent(asin)}` +
    '/' +
    `${
      userId
        ? `?${new URLSearchParams({
            user_id: userId,
          })}`
        : ''
    }`
  );
}
export function readRoute(url) {
  const match = url.pathname.match(/^\/product\/([^/]+)\/?$/);
  let asin = null;
  try {
    if (match) asin = decodeURIComponent(match[1]);
  } catch {
    /* Invalid URL is a final not-found page. */
  }
  const rawPage = url.searchParams.get('page') || '1';
  const parsed = /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  return {
    kind: url.pathname === '/' ? 'home' : asin ? 'product' : 'not-found',
    asin,
    userId: url.searchParams.get('user_id') || '',
    page: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1,
  };
}
