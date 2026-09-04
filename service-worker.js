const CACHE="my-notes-professional-v14";
const FILES=["./","./index.html","./style.css","./script.js","./manifest.json","./icon.svg","./icon-192.png","./icon-512.png","./icon-512-maskable.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>r)).catch(()=>caches.match("./index.html")))});
