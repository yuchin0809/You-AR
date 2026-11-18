/* You AR — Service Worker
 * ・オフラインでも起動できるようにファイルを端末にキャッシュする
 * ・アプリを閉じている間に育成状態を確かめて通知する(Periodic Background Sync。サーバー不要) */
const CACHE = 'youar-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'pet.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/maskable-512.png'];
const CDN = 'https://cdn.jsdelivr.net/';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // 自分のファイル:まずネット(更新を反映)、だめならキャッシュ
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch:true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
  } else if (req.url.startsWith(CDN)) {
    // ライブラリ(three.jsなど):バージョン固定なのでキャッシュ優先
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});

/* ---------- 閉じている間の通知 ---------- */
const idbGet = k => new Promise(res => {
  const r = indexedDB.open('youar', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { try { const q = r.result.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); } catch (_) { res(null); } };
  r.onerror = () => res(null);
});
const idbSet = (k, v) => new Promise(res => {
  const r = indexedDB.open('youar', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { try { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); } catch (_) { res(); } };
  r.onerror = () => res();
});

// pet.js と同じ減り方で、今の状態を見積もる
function estimate(P) {
  const h = Math.min(72, (Date.now() - P.lastTick) / 3600e3);
  const hunger = Math.max(0, P.hunger - (P.sleeping ? 4 : 7) * h);
  const energy = Math.max(0, Math.min(100, P.energy + (P.sleeping ? 25 : -5) * h));
  const mood = Math.max(0, P.mood - 3 * h - (hunger < 25 ? 5 * h : 0));
  return { hunger, energy, mood };
}
async function checkPet() {
  const P = await idbGet('pet'); const cfg = await idbGet('notify');
  if (!P || !cfg || !cfg.on) return;
  const s = estimate(P), name = P.name || 'ぼく';
  let body = null, tag = null;
  if (s.hunger < 25) { body = 'おなかすいた…ごはんちょうだい!'; tag = 'hunger'; }
  else if (s.mood < 25) { body = 'さみしいよ…会いにきて'; tag = 'mood'; }
  else if ((Date.now() - P.lastSeen) > 24 * 3600e3) { body = 'ひさしぶりに会いたいな'; tag = 'miss'; }
  if (!body) return;
  // 同じ通知を何度も出さない(6時間あける)
  const last = (cfg.last || {})[tag] || 0;
  if (Date.now() - last < 6 * 3600e3) return;
  cfg.last = Object.assign({}, cfg.last, { [tag]: Date.now() }); await idbSet('notify', cfg);
  await self.registration.showNotification(name, { body, tag, icon:'icons/icon-192.png', badge:'icons/icon-192.png' });
}
self.addEventListener('periodicsync', e => { if (e.tag === 'pet-check') e.waitUntil(checkPet()); });
self.addEventListener('message', e => { if (e.data === 'pet-check') e.waitUntil(checkPet()); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(cs => {
    const c = cs.find(c => 'focus' in c);
    return c ? c.focus() : self.clients.openWindow('./');
  }));
});
