/*
 * Simple service worker to cache the core assets of the Training Planner PWA.
 *
 * It pre-caches the application shell during the installation phase and serves
 * resources from the cache first. New requests fallback to the network if
 * they are not cached. This ensures the app works offline or when the
 * connection is poor.
 */

const CACHE_NAME = 'training-planner-cache-v1';
const CORE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(CORE_ASSETS);
        })
    );
});

self.addEventListener('activate', event => {
    // Clean up old caches if necessary
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        })
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    // Only handle GET requests
    if (request.method !== 'GET') return;
    event.respondWith(
        caches.match(request).then(cachedResponse => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(request).then(networkResponse => {
                // Optionally cache new requests here
                return networkResponse;
            }).catch(() => {
                // Fallback to offline page or nothing when offline
                return caches.match('./index.html');
            });
        })
    );
});