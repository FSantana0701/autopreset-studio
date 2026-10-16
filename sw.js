'use strict';
const CACHE_NAME = 'shell-v14'; // DSP e exportação locais incluídos no HTML autônomo.
const APP_SHELL = ['./', './index.html', './index%20(1).html', './manifest.webmanifest', './icons/autopreset-192.png', './icons/autopreset-512.png'];
const SCOPE = new URL(self.registration.scope);
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, SCOPE).href));
const HTML_URLS = new Set(APP_SHELL.slice(0, 3).map(path => new URL(path, SCOPE).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.addAll(APP_SHELL.map(path => new Request(new URL(path, SCOPE), { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key =>
    (key.startsWith('shell-v') && key !== CACHE_NAME) || key.startsWith('autopreset-studio-shell-') || key.startsWith('autopreset-local-model-')
  ).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname) || request.headers.has('Authorization')) return;
  // Only public shell files are cacheable. API calls and user audio pass through.
  const canonical = new URL(url.pathname, SCOPE.origin).href;
  const html = request.mode === 'navigate' && HTML_URLS.has(canonical);
  if (!html && (!SHELL_URLS.has(url.href) || HTML_URLS.has(url.href))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (!html) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    try {
      const response = await fetch(request, html ? { cache: 'no-cache' } : undefined);
      if (response.ok && response.type !== 'opaque' && !response.redirected) {
        await cache.put(html ? canonical : request, response.clone());
        return response;
      }
      return html ? (await cache.match(canonical)) || response : response;
    } catch (error) {
      const cached = await cache.match(html ? canonical : request);
      if (cached) return cached;
      throw error;
    }
  })());
});
