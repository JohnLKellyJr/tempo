// Tempo service worker: makes the app open instantly and work offline (showing the last data it saw).
const CACHE = 'tempo-v8';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'tempo-conn').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // never cache calls to the brain
  // Network first so updates show up, cache as a fallback when offline.
  e.respondWith(
    // 'no-cache' makes the phone ask GitHub for the newest file every time it's online.
    fetch(e.request.url, { cache: 'no-cache' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

// ───────────── Reminders ─────────────
// The brain sends an empty "wake up" push. The worker then asks the brain
// what to show, using the connection the app shared in Cache Storage.
self.addEventListener('push', (e) => { e.waitUntil(showReminders()); });

async function showReminders() {
  const opts = { icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  let items = [];
  try {
    const store = await caches.open('tempo-conn');
    const connRes = await store.match('conn');
    const conn = connRes ? await connRes.json() : null;
    const sinceRes = await store.match('since');
    const since = sinceRes ? Number(await sinceRes.text()) : 0;
    if (conn && conn.url && conn.key) {
      const res = await fetch(conn.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ key: conn.key, action: 'pendingPush', since }),
        redirect: 'follow'
      });
      const json = await res.json();
      items = (json && json.items) || [];
      if (items.length) await store.put('since', new Response(String(Math.max(...items.map((i) => i.ts)))));
    }
  } catch (err) { /* fall through to a plain notification */ }
  // iPhone requires every push to show something.
  if (!items.length) return self.registration.showNotification('Tempo', Object.assign({ body: 'You have a reminder. Tap to open Tempo.', tag: 'tempo' }, opts));
  return Promise.all(items.map((i) => self.registration.showNotification(i.title, Object.assign({ body: i.body || '', tag: i.id }, opts))));
}

// Tapping a notification opens (or brings forward) the Tempo app itself.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow('./');
  })());
});
