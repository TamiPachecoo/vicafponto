'use strict';
(() => {
  const button = document.getElementById('more-nav');
  const menu = document.getElementById('more-menu');
  if (!button || !menu) return;
  let closeTimer;
  const close = () => {
    clearTimeout(closeTimer);
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => {
    const open = menu.hidden;
    clearTimeout(closeTimer);
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) closeTimer = setTimeout(close, 3500);
  });
  menu.addEventListener('pointerdown', close, true);
  menu.addEventListener('click', close);
  const closeFromOutside = event => {
    if (menu.hidden || menu.contains(event.target) || button.contains(event.target)) return;
    close();
  };
  document.querySelectorAll('.bottom-nav a, .bottom-nav button:not(#more-nav)').forEach(item => {
    item.addEventListener('pointerdown', close, true);
    item.addEventListener('click', close);
  });
  document.addEventListener('pointerdown', closeFromOutside, true);
  document.addEventListener('touchstart', closeFromOutside, true);
  document.addEventListener('click', closeFromOutside, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
})();
