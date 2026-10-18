const VERSION = "v5";
const SHELL_CACHE = `calendario-shell-${VERSION}`;
const CDN_CACHE = `calendario-cdn-${VERSION}`;

const APP_SHELL = [
  "index.html", "config.js", "admin.js", "manifest.json", "logo.svg",
  "icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
  "favicon-32.png", "favicon-48.png", "favicon-192.png", "favicon.ico"
];

// Librerías y tipografías externas que usa la página: se guardan para que la app abra sin conexión.
const CDN_HOSTS = ["cdn.tailwindcss.com", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const CDN_PRECACHE = ["https://cdn.tailwindcss.com", "https://unpkg.com/lucide@1.52.0/dist/umd/lucide.min.js"];
const FONTS_CSS = "https://fonts.googleapis.com/css2?family=Fira+Sans:wght@300;400;500;600;700&display=swap";

const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    const cdn = await caches.open(CDN_CACHE);
    // allSettled: si falta algún archivo, la instalación no se rompe.
    await Promise.allSettled([
      ...APP_SHELL.map((url) => shell.add(url)),
      ...CDN_PRECACHE.map((url) => precacheOpaque(cdn, url)),
      precacheFonts(cdn)
    ]);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("calendario-") && k !== SHELL_CACHE && k !== CDN_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

async function precacheOpaque(cache, url) {
  const req = new Request(url, { mode: "no-cors" });
  await cache.put(req, await fetch(req));
}

// Guarda la hoja de estilos de Google Fonts y solo los tipos latinos (suficiente para español).
async function precacheFonts(cache) {
  const res = await fetch(FONTS_CSS);
  const css = await res.clone().text();
  await cache.put(FONTS_CSS, res);
  const latinUrls = css.split("@font-face")
    .filter((block) => block.includes("U+0000-00FF"))
    .map((block) => (block.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/) || [])[1])
    .filter(Boolean);
  await Promise.allSettled(latinUrls.map(async (url) => {
    const font = await fetch(url);
    if (font.ok) await cache.put(url, font);
  }));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin && !url.pathname.includes("/api/") && !url.pathname.endsWith(".ics")) {
    event.respondWith(networkFirst(req));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, req));
  }
  // El calendario (api/) y cualquier otra petición van siempre directos a la red: la copia sin conexión la guarda la propia página.
});

// Red primero: así los cambios publicados se ven en cuanto hay conexión.
// Si la red tarda más de NETWORK_TIMEOUT_MS o no hay conexión, se usa la copia guardada.
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {});

  const fromCache = async () =>
    (await cache.match(req, { ignoreSearch: true })) ||
    (req.mode === "navigate" ? await cache.match("index.html") : undefined);

  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS))
    ]);
  } catch (err) {
    const cached = await fromCache();
    if (cached) return cached;
    if (err.message === "timeout") return network;
    return Response.error();
  }
}

// Librerías externas: se sirve la copia guardada al instante y se actualiza en segundo plano.
async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  event.waitUntil(refresh);
  return cached || (await refresh) || Response.error();
}
