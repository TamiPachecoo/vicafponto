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
  menu.addEventListener('pointerdown', close, true);
  menu.addEventListener('click', close);
  const closeFromOutside = event => {
    if (menu.hidden || menu.contains(event.target) || button.contains(event.target)) return;
    close();
  };
  document.addEventListener('pointerdown', closeFromOutside, true);
  document.addEventListener('click', closeFromOutside, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
})();
