/* Libreta de Cuentas: funciona sin conexión. La app se actualiza sola cuando hay internet. */
const APP = "libreta-app-v4", LIBS = "libreta-libs-v1";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png"];
const LIB_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
  caches.open(LIBS).then(c => Promise.all(LIB_URLS.map(u => c.match(u).then(h => h || c.add(u)).catch(() => {}))));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== LIBS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.hostname === "api.github.com" || u.hostname === "gist.githubusercontent.com") return; // datos: siempre en directo
  if (u.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(APP).then(c => c.put(req, cp)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("./index.html"))));
    return;
  }
  if (u.hostname === "cdnjs.cloudflare.com" || u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(LIBS).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }))));
  }
});

/* Avisos: el service worker solo lee nombres de cuenta y fechas del último extracto (sin importes). */
function kv(op, key, val) {
  return new Promise((res, rej) => {
    const r = indexedDB.open("libreta", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onerror = () => rej(r.error);
    r.onsuccess = () => { const t = r.result.transaction("kv", op === "get" ? "readonly" : "readwrite"); const s = t.objectStore("kv");
      const q = op === "get" ? s.get(key) : s.put(val, key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
  });
}
async function checkRemind(test) {
  const r = await kv("get", "remind").catch(() => null);
  if (!test && (!r || !r.on)) return;
  const today = new Date(); const days = d => Math.floor((today - new Date(d + "T12:00:00")) / 864e5);
  const stale = ((r && r.accs) || []).map(a => ({ n: a.n, d: days(a.last) })).filter(a => a.d > 30).sort((a, b) => b.d - a.d);
  const fc = r && r.fc && r.fc.date >= today.toISOString().slice(0, 10) ? r.fc : null;
  const rv = r && r.rev && r.rev !== r.revNotified && days(r.rev) >= -31 && days(r.rev) <= 0 ? r.rev : null;
  if (!test && !rv && ((!stale.length && !fc) || (r.lastNotif && Date.now() - r.lastNotif < 3 * 864e5))) return;
  const fd = fc ? fc.date.split("-").reverse().join("/") : "";
  const lines = [];
  if (rv) lines.push(`Tu hipoteca se revisa el ${rv.split("-").reverse().join("/")}: mira el euríbor y actualízalo en la Libreta.`);
  if (fc) lines.push(fc.kind === "neg" ? `Previsión: tu saldo podría quedar en negativo hacia el ${fd}.` : `Previsión: tu saldo bajará de tu colchón hacia el ${fd}.`);
  if (stale.length) lines.push(stale.map(a => `${a.n}: ${a.d} días sin extractos`).join("\n") + "\nDescárgalos en la banca online e impórtalos.");
  const body = test ? "Así te avisaré si una cuenta lleva más de 30 días sin extractos o si tu saldo va a bajar de tu colchón." : lines.join("\n");
  await self.registration.showNotification("Libreta de Cuentas", { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "libreta-avisos", renotify: true, data: { url: (fc || rv) && !stale.length ? "./#funciones" : "./#importar" } });
  if (!test) await kv("put", "remind", Object.assign({}, r, { lastNotif: Date.now() }, rv ? { revNotified: rv } : {}));
}
self.addEventListener("periodicsync", e => { if (e.tag === "libreta-avisos") e.waitUntil(checkRemind(false)); });
self.addEventListener("message", e => { if (e.data && e.data.type === "libreta-check") e.waitUntil(checkRemind(!!e.data.test)); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
    for (const c of cs) { if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
