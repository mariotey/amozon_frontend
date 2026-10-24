(() => {
  const root = document.getElementById('live-storefront');
  if (!root) return;
  let userId = root.dataset.userId;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function loadSection(element, deadline = Date.now() + 120000) {
    element.setAttribute('aria-busy', 'true');
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
        element.innerHTML = payload.html;
        element.setAttribute('aria-busy', 'false');
        if (element.dataset.section === 'shoppers') userId = payload.user_id;
        return;
      } catch (error) {
        // The request itself wakes a sleeping backend; allow time before retrying.
      } finally {
        clearTimeout(timer);
      }
      await pause(Math.min(4000, Math.max(0, deadline - Date.now())));
    }
    element.setAttribute('aria-busy', 'false');
    element.replaceChildren();
    const message = document.createElement('p');
    message.textContent = 'Unable to load right now.';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-dark';
    button.textContent = 'Try again';
    button.addEventListener('click', () => {
      element.innerHTML = 'Loading<span class="loading-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>';
      loadSection(element).then(() => {
        if (element.dataset.section === 'shoppers') refreshRecommendations();
      });
    });
    element.append(message, button);
  }

  function refreshRecommendations(deadline) {
    const recommendations = root.querySelector('[data-section="recommendations"]');
    if (recommendations) return loadSection(recommendations, deadline);
  }

  const shoppers = document.querySelector('[data-section="shoppers"]');
  // Recommendations wait for shopper selection; other sections load independently.
  const deadline = Date.now() + 120000;
  loadSection(shoppers, deadline).then(() => refreshRecommendations(deadline));
  root.querySelectorAll('[data-section]:not([data-section="recommendations"])').forEach(element => loadSection(element, deadline));
})();
