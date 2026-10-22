'use strict';
(() => {
  const button = document.getElementById('more-nav');
  const menu = document.getElementById('more-menu');
  if (!button || !menu) return;
  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', close);
  document.addEventListener('click', event => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== button && !button.contains(event.target)) {
      close();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
})();
