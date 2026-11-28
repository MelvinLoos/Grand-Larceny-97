// Imported into the generated service worker (see vite.config.js).
// When a new deploy replaces an older service worker, tell every open tab ('update-ready'). New page
// code acknowledges ('update-ack') and reloads at a safe moment (never mid-run). A tab that has not
// acknowledged after FALLBACK_MS is still running pre-handshake code, so it is reloaded here one last time.
// A first-ever install (no previous worker) does not message anyone.
const FALLBACK_MS = 3000;
let replacesOldWorker = false;
const acked = new Set();

self.addEventListener('install', () => {
    replacesOldWorker = Boolean(self.registration.active);
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'update-ack' && event.source?.id) acked.add(event.source.id);
});

self.addEventListener('activate', (event) => {
    if (!replacesOldWorker) return;
    event.waitUntil(
        self.clients
            .claim()
            .then(() => self.clients.matchAll({ type: 'window' }))
            .then((tabs) => {
                tabs.forEach((tab) => tab.postMessage({ type: 'update-ready' }));
                return new Promise((resolve) => setTimeout(resolve, FALLBACK_MS)).then(() =>
                    Promise.all(
                        tabs.filter((tab) => !acked.has(tab.id)).map((tab) => tab.navigate(tab.url).catch(() => {}))
                    )
                );
            })
    );
});
