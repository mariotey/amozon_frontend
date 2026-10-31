// Shared store drawer. Native dialog/details provide focus handling and exclusive sections.
export function setupProjectMenu() {
  const toggle = document.getElementById('project-menu-toggle');
  const menu = document.getElementById('project-menu');
  const close = document.getElementById('project-menu-close');
  if (!toggle || !menu || !close) return;
  toggle.addEventListener('click', () => {
    if (menu.open) return;
    const shopper = document.querySelector('#user-picker .account-name')?.textContent || 'shopper';
    document.getElementById('project-menu-title').textContent = `Hello, ${shopper}`;
    menu.showModal();
    document.documentElement.classList.add('project-menu-open');
    toggle.setAttribute('aria-expanded', 'true');
  });
  close.addEventListener('click', () => menu.close());
  menu.addEventListener('click', (event) => {
    if (event.target !== menu) return;
    const bounds = menu.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      menu.close();
  });
  // Native dialog behavior handles Escape, focus containment, and background interaction.
  menu.addEventListener('close', () => {
    menu.querySelectorAll('.project-nav details[open]').forEach((section) => {
      section.open = false;
    });
    document.documentElement.classList.remove('project-menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus({
      preventScroll: true,
    });
  });
}
