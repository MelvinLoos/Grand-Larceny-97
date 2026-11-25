// Imported into the generated service worker (see vite.config.js).
// When a new deploy replaces an older service worker, reload every open tab so
// players get the new build immediately instead of one visit later. This runs
// in the new worker, so it also reaches tabs still running the old page code.
// A first-ever install (no previous worker) does not reload anything.
let replacesOldWorker = false;

self.addEventListener('install', () => {
    replacesOldWorker = Boolean(self.registration.active);
});

self.addEventListener('activate', (event) => {
    if (!replacesOldWorker) return;
    event.waitUntil(
        self.clients
            .claim()
            .then(() => self.clients.matchAll({ type: 'window' }))
            .then((tabs) => Promise.all(tabs.map((tab) => tab.navigate(tab.url).catch(() => {}))))
    );
});
