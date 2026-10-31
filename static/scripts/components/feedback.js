// One request lifecycle for independent sections, including cancellation and retry UI.
import {escapeHTML as e} from '../utils.js';
import {homeURL} from '../navigation.js';
import {APIError} from '../api.js';
import {withRetry} from '../retry.js';

export function loading(label, waiting = false) {
  const message = ['history', 'recommendations'].includes(label) ? 'Loading' : `Loading ${label}`;
  return `<div class="empty-state compact-empty loading-state"><p class="loading-message">${e(waiting ? 'Waiting for the service to respond' : message)}<span class="loading-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>${waiting ? '<p class="loading-help">The service may be waking up. This section will update automatically.</p>' : ''}</div>`;
}

export function notFound(userId, product = false) {
  return `<section class="empty-state not-found"><span aria-hidden="true">?</span><h1>${product ? 'Product' : 'Page'} not found</h1><p>${product ? 'This product could not be found.' : 'This address does not match a storefront page.'}</p><a class="button button-dark" href="${e(homeURL(userId))}">Back to recommendations</a></section>`;
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

export function createSectionLoader({state, retryWindow, updateLinks}) {
  const jobs = new Map();
  let disposed = false;
  async function loadSection(key, element, operation, render, onSuccess = () => {}) {
    if (disposed) return null;
    jobs.get(key)?.abort();
    const controller = new AbortController();
    jobs.set(key, controller);
    element.setAttribute('aria-busy', 'true');
    element.innerHTML = loading(key);
    const current = () => !disposed && jobs.get(key) === controller && !controller.signal.aborted;
    try {
      const payload = await withRetry(operation, {
        signal: controller.signal, windowMs: retryWindow,
        onRetry: () => { if (current()) element.innerHTML = loading(key, true); },
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
        element.innerHTML = key === 'details' ? notFound(state.userId, true)
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

  return {
    load: loadSection,
    isDisposed: () => disposed,
    dispose() {
      disposed = true;
      jobs.forEach(controller => controller.abort());
      jobs.clear();
    },
  };
}
