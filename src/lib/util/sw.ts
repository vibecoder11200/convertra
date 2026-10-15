import { browser } from "$app/environment";

export interface CacheInfo {
	totalSize: number;
	fileCount: number;
	files: Array<{
		url: string;
		size: number;
		type: string;
	}>;
}

class ServiceWorkerManager {
	private registration: ServiceWorkerRegistration | null = null;
	private initialized = false;

	async init(): Promise<void> {
		if (!browser || !("serviceWorker" in navigator) || this.initialized) {
			return;
		}

		try {
			this.registration = await navigator.serviceWorker.register(
				"/sw.js",
				{
					scope: "/",
				},
			);

			this.initialized = true;
		} catch (error) {
			console.error(
				"[SW Manager] service worker registration failed:",
				error,
			);
		}
	}

	/**
	 * Post a command to the controlling service worker and await its reply
	 * on a fresh MessageChannel port, rejecting after `timeoutMs`.
	 */
	private postCommand<T>(
		type: string,
		timeoutError: string,
		timeoutMs: number,
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const messageChannel = new MessageChannel();

			messageChannel.port1.onmessage = (event) => {
				resolve(event.data);
			};

			setTimeout(() => {
				reject(new Error(timeoutError));
			}, timeoutMs);

			navigator.serviceWorker?.controller?.postMessage({ type }, [
				messageChannel.port2,
			]);
		});
	}

	async getCacheInfo(): Promise<CacheInfo> {
		if (!this.registration || !navigator.serviceWorker.controller) {
			console.warn(
				"[SW Manager] no service worker available for cache info",
			);
			return { totalSize: 0, fileCount: 0, files: [] };
		}

		return this.postCommand<CacheInfo>(
			"GET_CACHE_INFO",
			"Timeout waiting for cache info",
			5000,
		);
	}

	async clearCache(): Promise<void> {
		if (!this.registration || !navigator.serviceWorker.controller) {
			throw new Error("No service worker available for cache clearing");
		}

		const result = await this.postCommand<{
			success?: boolean;
			error?: string;
		}>("CLEAR_CACHE", "Timeout waiting for cache clear", 10000);
		if (!result.success) {
			throw new Error(result.error || "Failed to clear cache");
		}
	}

	formatSize(bytes: number): string {
		if (bytes === 0) return "0 B";
		const k = 1024;
		const sizes = ["B", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
	}
}

export const swManager = new ServiceWorkerManager();

// --- web share target stash handoff -----------------------------------------
// The service worker turns a share-sheet POST /share into: stash files in the
// "share-stash-v1" cache under /share-stash/<shareId>/<index>, then redirect
// to /convert?fromShare=<shareId>. These helpers read + clear that stash.
// (JS here mirrors sw.js; there is no shared module between them.)

const SHARE_STASH_CACHE = "share-stash-v1";
const SHARE_STASH_URL_PREFIX = "/share-stash/";

/**
 * Read all files stashed for a share id (SW intercept of POST /share) and
 * clear them from the cache. Returns [] when the SW wasn't controlling
 * (the /share fallback page handles that case) or the id is unknown/stale.
 */
export async function readShareStash(shareId: string): Promise<File[]> {
	if (!browser || !("caches" in window)) return [];
	try {
		const cache = await caches.open(SHARE_STASH_CACHE);
		const keys = await cache.keys();
		const prefix = `${SHARE_STASH_URL_PREFIX}${shareId}/`;
		const stashKeys = keys
			.map((k) => new URL(k.url))
			.filter((u) => u.pathname.startsWith(prefix))
			.sort((a, b) => a.pathname.localeCompare(b.pathname));
		const files: File[] = [];
		for (const url of stashKeys) {
			const response = await cache.match(url.pathname);
			if (!response) continue;
			const blob = await response.blob();
			// the SW encodes the filename to keep the header ByteString-safe
			const name = decodeURIComponent(
				response.headers.get("x-file-name") ?? "file",
			);
			const type =
				response.headers.get("x-file-type") ||
				"application/octet-stream";
			files.push(new File([blob], name, { type }));
			await cache.delete(url.pathname);
		}
		return files;
	} catch (err) {
		console.warn("[SW Manager] reading share stash failed:", err);
		return [];
	}
}

// Auto-initialize when imported
if (browser) {
	swManager.init();
}
