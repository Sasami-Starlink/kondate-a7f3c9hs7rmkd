// オフライン対応の簡易 Service Worker
const CACHE = "kondate-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./scaler.js",
  "./clips.js",
  "./pairing.js",
  "./recipes.js",
  "./recipes.json",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 外部（レシピサイト等）はキャッシュせずネットワークへ
  if (url.origin !== location.origin) return;
  // recipes.json は再クロールを反映するためネット優先（失敗時のみキャッシュ）
  if (url.pathname.endsWith("recipes.json")) {
    e.respondWith(
      fetch(e.request).then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
