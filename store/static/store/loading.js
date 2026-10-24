(() => {
  const root = document.getElementById('live-storefront');
  if (!root) return;
  let userId = root.dataset.userId || '';
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const loaded = new Set();
  const pending = new Map();
  const shoppers = document.querySelector('[data-section="shoppers"]');

  function showRetry(element, retry, message = 'Unable to load right now.') {
    element.setAttribute('aria-busy', 'false');
    element.replaceChildren();
    const text = document.createElement('p');
    text.textContent = message;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-dark';
    button.textContent = 'Try again';
    button.addEventListener('click', retry);
    element.append(text, button);
  }

  function loadSection(element) {
    if (!element) return Promise.resolve(false);
    if (loaded.has(element)) return Promise.resolve(true);
    if (pending.has(element)) return pending.get(element);
    const request = fetchSection(element).finally(() => pending.delete(element));
    pending.set(element, request);
    return request;
  }

  async function fetchSection(element) {
    // Each section gets its own retry window, including after a long cold start.
    const deadline = Date.now() + 120000;
    element.setAttribute('aria-busy', 'true');
    element.innerHTML = 'Loading<span class="loading-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>';
    while (Date.now() < deadline) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(15000, deadline - Date.now()));
      try {
        const url = new URL(root.dataset.sectionUrl.replace('SECTION', element.dataset.section), window.location.origin);
        url.search = window.location.search;
        url.searchParams.set('user_id', userId);
        if (root.dataset.itemId) url.searchParams.set('item_id', root.dataset.itemId);
        const response = await fetch(url, {signal: controller.signal, cache: 'no-store'});
        if (!response.ok) throw new Error('Service unavailable');
        const payload = await response.json();
        if (typeof payload.html !== 'string') throw new Error('Invalid response');
        if (element === shoppers && typeof payload.user_id !== 'string') throw new Error('Invalid shopper');
        element.innerHTML = payload.html;
        element.setAttribute('aria-busy', 'false');
        if (element === shoppers) {
          userId = payload.user_id;
          root.dataset.userId = userId;
        }
        loaded.add(element);
        return true;
      } catch (error) {
        // The request itself wakes a sleeping backend; allow time before retrying.
      } finally {
        clearTimeout(timer);
      }
      await pause(Math.min(4000, Math.max(0, deadline - Date.now())));
    }
    showRetry(element, async () => {
      if (await loadSection(element) && !root.dataset.itemId) loadHomeSections();
    });
    return false;
  }

  async function loadHomeSections() {
    const shoppersReady = await loadSection(shoppers);
    // Popular products remain usable even if shopper selection is unavailable.
    await loadSection(root.querySelector('[data-section="popular"]'));
    const recommendations = root.querySelector('[data-section="recommendations"]');
    if (!recommendations) return;
    if (shoppersReady) {
      await loadSection(recommendations);
    } else {
      showRetry(recommendations, loadHomeSections, 'Load shoppers to see recommendations.');
    }
  }

  if (root.dataset.itemId) {
    // Direct product links and review pagination do not depend on shopper loading.
    root.querySelectorAll('[data-section]').forEach(element => loadSection(element));
    loadSection(shoppers);
  } else {
    loadHomeSections();
  }
})();
