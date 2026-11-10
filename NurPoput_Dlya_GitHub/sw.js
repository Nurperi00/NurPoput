const CACHE_NAME = 'nurpoput-v2';
const OFFLINE_URL = '/offline.html';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/offline.html',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192.svg',
  '/icon-512.svg',
  '/screenshot-mobile.png',
  '/screenshot-desktop.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Не перехватываем обращения к API и синхронизации
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Навигация (переход по страницам) с гарантированным оффлайн-режимом
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        return cache.match(OFFLINE_URL);
      })
    );
    return;
  }

  // Статические файлы: из кэша либо из сети
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    }).catch(() => {
      if (event.request.destination === 'image') {
        return caches.match('/icon-192.png');
      }
    })
  );
});
