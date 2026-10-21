// Vicaf Hydro — cache the app shell, never authenticated data or signed PDFs.
const CACHE = 'vicaf-v5-fispq';
const SHELL = ['menu.html','index.html','perfil.html','ferramentas.html','fisqs.html','fisqs.css','fisqs.js','usage-tracker.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^vicaf-/.test(k) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Keep all Supabase, Auth, upload and signed document traffic out of Cache Storage.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || e.request.headers.has('Authorization')) return;
  const base = new URL('./', self.location.href);
  const allowed = SHELL.some(path => new URL(path, base).href === url.href);
  if (!allowed) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then(c => c.put(e.request, copy)));
    }
    return res;
  }).catch(async () => (await caches.match(e.request)) || new Response('Sem conexão. Conecte-se para abrir o app.', {status:503})));
});
