// Accessible shopper menu: pointer/keyboard selection and product-to-home navigation.
import {escapeHTML as e} from '../utils.js';
import {homeURL} from '../navigation.js';

export function shopperPicker(users, selected) {
  const options = [...users];
  if (selected && !options.some(user => user.user_id === selected)) {
    options.unshift({user_id: selected, label: 'Selected shopper'});
  }
  const current = options.find(user => user.user_id === selected) || options[0];
  const avatar = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/></svg>';
  return `<div class="user-picker"><button class="account-picker" id="user-picker" type="button" role="combobox" aria-label="Change shopper, currently ${e(current.label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="shopper-options" aria-describedby="shopper-context" value="${e(current.user_id)}"><span class="account-avatar" aria-hidden="true">${avatar}</span><span class="account-greeting">Hello,</span><span class="account-name">${e(current.label)}</span></button><div class="shopper-menu" hidden aria-live="off"><p class="shopper-menu-title" id="shopper-menu-title">Select a user profile.</p><div id="shopper-options" role="listbox" aria-labelledby="shopper-menu-title">${options.map((user, index) => `<div class="shopper-option" id="shopper-option-${index}" role="option" aria-selected="${user.user_id === current.user_id}" data-shopper-id="${e(user.user_id)}" data-shopper-label="${e(user.label)}"><span class="shopper-option-avatar" aria-hidden="true">${e(user.label.match(/\d+$/)?.[0] || 'S')}</span><span>${e(user.label)}</span><svg class="shopper-option-check" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"/></svg></div>`).join('')}</div></div></div>`;
}

export function setupShopperPicker({state, route, updateLinks, onChange}) {
  const picker = document.getElementById('user-picker');
  if (!picker) return;
  const wrapper = picker.closest('.user-picker');
  const menu = wrapper.querySelector('.shopper-menu');
  const options = [...menu.querySelectorAll('[role="option"]')];
  const controller = new AbortController();
  const events = {signal: controller.signal};
  let active = options.findIndex(option => option.dataset.shopperId === state.userId);

  function highlight(index) {
    active = Math.max(0, Math.min(index, options.length - 1));
    options.forEach((option, position) => option.classList.toggle('is-active', position === active));
    picker.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView({block: 'nearest'});
  }
  function close() {
    menu.hidden = true;
    picker.setAttribute('aria-expanded', 'false');
    picker.removeAttribute('aria-activedescendant');
    options.forEach(option => option.classList.remove('is-active'));
  }
  function open() {
    menu.hidden = false;
    picker.setAttribute('aria-expanded', 'true');
    picker.focus({preventScroll: true});
    highlight(options.findIndex(option => option.dataset.shopperId === state.userId));
  }
  function select(option) {
    const userId = option.dataset.shopperId;
    const label = option.dataset.shopperLabel;
    close();
    if (userId === state.userId) return;
    state.userId = userId;
    picker.value = userId;
    picker.querySelector('.account-name').textContent = label;
    picker.setAttribute('aria-label', `Change shopper, currently ${label}`);
    options.forEach(row => row.setAttribute('aria-selected', String(row === option)));
    if (route.kind === 'product') {
      window.location.assign(homeURL(userId));
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('user_id', userId);
    window.history.replaceState(null, '', url);
    updateLinks();
    if (route.kind === 'home') onChange();
  }

  picker.addEventListener('click', () => menu.hidden ? open() : close(), events);
  picker.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey) return;
    const isOpen = !menu.hidden;
    if (event.key === 'Tab') {
      if (isOpen) select(options[active]);
      return;
    }
    if (event.key === 'Escape') {
      if (isOpen) { event.preventDefault(); close(); }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) select(options[active]); else open();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!isOpen) open();
      if (event.key === 'Home') highlight(0);
      else if (event.key === 'End') highlight(options.length - 1);
      else if (event.key === 'ArrowUp' && event.altKey) select(options[active]);
      else if (isOpen) highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key.length === 1 && !event.altKey) {
      const key = event.key.toLocaleLowerCase();
      const match = options.findIndex((option, index) => index > active
        && option.dataset.shopperLabel.toLocaleLowerCase().startsWith(key));
      const index = /^\d$/.test(key)
        ? options.findIndex(option => option.dataset.shopperLabel.endsWith(` ${key}`))
        : match >= 0 ? match : options.findIndex(option => option.dataset.shopperLabel.toLocaleLowerCase().startsWith(key));
      if (index >= 0) { event.preventDefault(); if (!isOpen) open(); highlight(index); }
    }
  }, events);
  menu.addEventListener('pointermove', event => {
    const option = event.target.closest('[data-shopper-id]');
    if (option) highlight(options.indexOf(option));
  }, events);
  menu.addEventListener('pointerdown', event => event.preventDefault(), events);
  menu.addEventListener('click', event => {
    const option = event.target.closest('[data-shopper-id]');
    if (option) select(option);
  }, events);
  document.addEventListener('pointerdown', event => {
    if (!wrapper.contains(event.target)) close();
  }, events);
  document.addEventListener('focusin', event => {
    if (!wrapper.contains(event.target)) close();
  }, events);
  return () => controller.abort();
}
