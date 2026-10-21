'use strict';
(() => {
  const button = document.getElementById('more-nav');
  const menu = document.getElementById('more-menu');
  if (!button || !menu) return;
  button.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== button && !button.contains(event.target)) {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });
})();
