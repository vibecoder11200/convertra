const CACHE_NAME = "convertra-wasm-cache-v1"; // updated when workers update

// tesseract assets cache separately: its version key follows the tesseract.js
// version, so app deploys never discard downloaded OCR languages
const TESSDATA_CACHE_PREFIX = "tessdata-cache-v";
const TESSDATA_CACHE_VERSION = "7"; // tesseract.js major version
const TESSDATA_CACHE_NAME = TESSDATA_CACHE_PREFIX + TESSDATA_CACHE_VERSION;

// web share target handoff: POST /share bodies are stashed here keyed by a
// per-share id echoed back in the /convert?fromShare=<id> redirect, so two
// rapid shares can't overwrite each other. Entries carry an x-stashed-at
// header and are swept when older than SHARE_STASH_TTL.
const SHARE_STASH_CACHE = "share-stash-v1";
const SHARE_STASH_TTL = 60 * 60 * 1000; // 1h
const SHARE_STASH_URL_PREFIX = "/share-stash/";

const WASM_FILES = [
	"/pandoc.wasm",
	"/mupdf-wasm.wasm",
	"https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js",
	"https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm",
];

const WASM_URL_PATTERNS = [
	/\/src\/lib\/workers\/.*\.js$/, // dev mode worker files
	/\/assets\/.*worker.*\.js$/, // prod worker files
	/magick.*\.wasm$/, // magick-wasm (unneeded?)
];

function shouldCacheUrl(url) {
	const urlObj = new URL(url);

	if (WASM_FILES.includes(urlObj.pathname) || WASM_FILES.includes(url)) {
		return true;
	}

	return WASM_URL_PATTERNS.some(
		(pattern) => pattern.test(urlObj.pathname) || pattern.test(url),
	);
}

// tesseract runtime assets (core wasm variants, worker script, traineddata)
// live under /tessdata/ and are cached lazily in their own versioned cache
function isTessdataUrl(url) {
	const urlObj = new URL(url);
	return urlObj.pathname.startsWith("/tessdata/");
}

self.addEventListener("install", (event) => {
	console.log("[SW] installing service worker");

	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			const staticFiles = WASM_FILES.filter((file) =>
				file.startsWith("/"),
			);
			if (staticFiles.length > 0) {
				console.log("[SW] pre-caching static files:", staticFiles);
				return cache.addAll(staticFiles).catch((err) => {
					console.warn("[SW] failed to pre-cache some files:", err);
				});
			}
		}),
	);

	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((cacheNames) => {
				return Promise.all(
					cacheNames.map((cacheName) => {
						if (
							cacheName !== CACHE_NAME &&
							(cacheName.startsWith("vert-wasm-cache") ||
								cacheName.startsWith("convertra-wasm-cache"))
						) {
							console.log("[SW] deleting old cache:", cacheName);
							return caches.delete(cacheName);
						}
						// tessdata caches: drop only other tesseract versions
						if (
							cacheName.startsWith(TESSDATA_CACHE_PREFIX) &&
							cacheName !== TESSDATA_CACHE_NAME
						) {
							console.log(
								"[SW] deleting old tessdata cache:",
								cacheName,
							);
							return caches.delete(cacheName);
						}
						}),
				);
			})
			// share-stash: drop other versions of the handoff cache, then
			// sweep entries older than the TTL (unclaimed shares, e.g. the
			// user closed the tab before /convert read them)
			.then(async () => {
				for (const cacheName of await caches.keys()) {
					if (
						cacheName.startsWith("share-stash-") &&
						cacheName !== SHARE_STASH_CACHE
					) {
						await caches.delete(cacheName);
					}
				}
				await sweepShareStash();
			})
			.then(() => {
				return self.clients.claim();
			}),
	);
});

async function sweepShareStash() {
	const cache = await caches.open(SHARE_STASH_CACHE);
	for (const request of await cache.keys()) {
		try {
			const response = await cache.match(request);
			const stashedAt = Number(
				response?.headers.get("x-stashed-at") ?? 0,
			);
			if (!stashedAt || Date.now() - stashedAt > SHARE_STASH_TTL) {
				await cache.delete(request);
			}
		} catch (err) {
			console.warn("[SW] share stash sweep failed:", err);
		}
	}
}

// web share target: the OS POSTs shared files to /share. Directly redirecting
// would lose the body, so stash every file into the share-stash cache under a
// per-share id and 302 to /convert?fromShare=<id> (the convert page reads and
// clears the stash). Handled AHEAD of the shouldCacheUrl gate.
async function handleSharePost(request) {
	try {
		const stashId = crypto.randomUUID();
		const form = await request.formData();
		const cache = await caches.open(SHARE_STASH_CACHE);
		let index = 0;
		for (const [, value] of form.entries()) {
			if (typeof value === "string") continue;
			const response = new Response(value, {
				headers: {
					// header values are ByteStrings — non-Latin-1 filenames
					// (e.g. Vietnamese) throw on raw insertion
					"x-file-name": encodeURIComponent(value.name || `file-${index}`),
					"x-file-type": value.type || "application/octet-stream",
					"x-stashed-at": String(Date.now()),
				},
			});
			await cache.put(
				`${SHARE_STASH_URL_PREFIX}${stashId}/${index}`,
				response,
			);
			index++;
		}

		// text-only shares (no files) just open the app
		const target = new URL("/convert/", self.location.origin);
		if (index > 0) {
			target.searchParams.set("fromShare", stashId);
		}
		return Response.redirect(target.toString(), 302);
	} catch (err) {
		console.error("[SW] share target handling failed:", err);
		return Response.redirect(
			new URL("/share/", self.location.origin).toString(),
			302,
		);
	}
}

self.addEventListener("fetch", (event) => {
	const request = event.request;

	// web share target POST lands here first; everything else falls through
	const shareUrl = new URL(request.url);
	if (
		request.method === "POST" &&
		shareUrl.origin === self.location.origin &&
		(shareUrl.pathname === "/share" || shareUrl.pathname === "/share/")
	) {
		event.respondWith(handleSharePost(request));
		return;
	}

	// tessdata: lazy cache-first in the versioned tessdata cache
	if (isTessdataUrl(request.url)) {
		event.respondWith(
			caches.open(TESSDATA_CACHE_NAME).then(async (cache) => {
				const cached = await cache.match(request);
				if (cached) return cached;
				const response = await fetch(request);
				if (response.ok) {
					cache.put(request, response.clone()).catch((err) => {
						console.warn("[SW] failed to cache tessdata:", err);
					});
				}
				return response;
			}),
		);
		return;
	}

	if (!shouldCacheUrl(request.url)) {
		return; // Let the request go through normally if not a target URL
	}

	// else intercept request
	event.respondWith(
		caches.match(request).then((cachedResponse) => {
			if (cachedResponse) {
				console.log("[SW] serving from cache:", request.url);
				return cachedResponse;
			}

			console.log("[SW] fetching and caching:", request.url);
			return fetch(request)
				.then((response) => {
					if (!response.ok) {
						console.warn(
							"[SW] not caching failed response:",
							response.status,
							request.url,
						);
						return response;
					}

					const responseToCache = response.clone();
					caches.open(CACHE_NAME).then((cache) => {
						cache
							.put(request, responseToCache)
							.then(() => {
								console.log(
									"[SW] cached successfully:",
									request.url,
								);
							})
							.catch((err) => {
								console.warn(
									"[SW] failed to cache:",
									request.url,
									err,
								);
							});
					});

					return response;
				})
				.catch((err) => {
					console.error("[SW] fetch failed for:", request.url, err);
					throw err;
				});
		}),
	);
});

self.addEventListener("message", (event) => {
	if (!event.data) return;
	const type = event.data.type;

	if (type === "GET_CACHE_INFO") {
		event.waitUntil(
			caches.open(CACHE_NAME).then(async (cache) => {
				const keys = await cache.keys();
				let totalSize = 0;
				const files = [];

				for (const request of keys) {
					try {
						const response = await cache.match(request);
						if (response) {
							const blob = await response.blob();
							const size = blob.size;
							totalSize += size;

							files.push({
								url: request.url,
								size: size,
								type:
									response.headers.get("content-type") ||
									"unknown",
							});
						}
					} catch (err) {
						console.warn(
							"[SW] failed to get info for cached file:",
							request.url,
							err,
						);
					}
				}

				event.ports[0].postMessage({
					totalSize,
					fileCount: files.length,
					files,
				});
			}),
		);
	}

	if (type === "CLEAR_CACHE") {
		event.waitUntil(
			caches
				.delete(CACHE_NAME)
				.then(() => {
					console.log("[SW] cache cleared");
					return caches.open(CACHE_NAME);
				})
				.then(() => {
					event.ports[0].postMessage({ success: true });
				})
				.catch((err) => {
					console.error("[SW] failed to clear cache:", err);
					event.ports[0].postMessage({
						success: false,
						error: err.message,
					});
				}),
		);
	}
});
