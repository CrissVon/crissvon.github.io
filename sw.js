/* Service worker: розклад відкривається й без інтернету.
 * Стратегія: спочатку мережа (завжди свіжі дані), якщо її немає — остання збережена копія.
 * Змінюєш логіку кешу — підніми версію CACHE.
 */
const CACHE = 'schedule-v2';
const SHELL = ['./', 'index.html', 'js/app.js', 'css/style.css', 'assets/favicon.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // шрифти та інше зовнішнє не кешуємо

  // Ключ без query (?t=..., ?date=...), щоб не плодити копії одного файлу
  const key = url.origin + url.pathname;

  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(key).then(
          (hit) => hit || (req.mode === 'navigate' ? caches.match(new URL('index.html', self.location).href) : Response.error())
        )
      )
  );
});
