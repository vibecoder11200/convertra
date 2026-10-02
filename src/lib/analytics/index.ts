// Provider-agnostic analytics: Plausible and/or Umami run in parallel, driven
// purely by env configuration. Conversion events fan out to every active
// provider through trackEvent().
//
// Dependency rule: this module may import the settings LEAF
// ($lib/sections/settings/store.svelte) ONLY. Never import the settings
// barrel ($lib/sections/settings) — it re-exports components that import
// $lib/store, and $lib/store imports this module; the barrel would create a
// real ESM cycle that svelte-check cannot detect.
import {
	PUB_PLAUSIBLE_URL,
	PUB_UMAMI_URL,
	PUB_UMAMI_WEBSITE_ID,
} from "$env/static/public";
import { browser } from "$app/environment";
import { DISABLE_ALL_EXTERNAL_REQUESTS } from "$lib/util/consts";
import { Settings } from "$lib/sections/settings/store.svelte";

// Stable Umami tracker path; if a future Umami renames it, copy the exact
// snippet from the deployed dashboard (Settings → Website → Tracking code).
export const UMAMI_SCRIPT_PATH = "/script.js";

// Full tracker script URL; a trailing slash in PUB_UMAMI_URL is tolerated.
export const UMAMI_SCRIPT_SRC = `${PUB_UMAMI_URL.replace(/\/+$/, "")}${UMAMI_SCRIPT_PATH}`;

if (browser && PUB_UMAMI_URL && !PUB_UMAMI_WEBSITE_ID) {
	console.warn(
		"[analytics] PUB_UMAMI_URL is set but PUB_UMAMI_WEBSITE_ID is empty — Umami stays disabled",
	);
}

export type AnalyticsEventName =
	| "convert_start"
	| "convert_complete"
	| "convert_fail"
	| "file_select"
	| "download_click"
	| "settings_change";

/** How a file entered the app (file_select.via vocabulary). */
export type AnalyticsVia = "drop" | "paste" | "picker" | "zip";

/**
 * Payload contract: scalar values only, within Umami's event-data limits
 * (strings ≤ 500 chars, objects ≤ 50 properties). Vocabularies:
 * - file_select.via: "drop" | "paste" | "picker" | "zip"
 * - convert_fail.reason: "cancelled" | "error" ("none" converter = resolution itself failed)
 * - settings_change.key: "useDefaultFormat" | "metadata" | "vertdSpeed"
 * Payloads never contain file names, paths, URLs with names, or error message text.
 */
export type AnalyticsEventData = Record<string, string | number | boolean>;

export const providers = {
	plausible: !!PUB_PLAUSIBLE_URL,
	umami: !!(PUB_UMAMI_URL && PUB_UMAMI_WEBSITE_ID),
};

export const analyticsConfigured = () => providers.plausible || providers.umami;

export const analyticsEnabled = () =>
	analyticsConfigured() &&
	Settings.instance.settings.analytics &&
	!DISABLE_ALL_EXTERNAL_REQUESTS;

export type PlausibleTrackFn = (
	eventName: string,
	options?: {
		callback?: (args: { status: number }) => void;
		props?: Record<string, string | number | boolean>;
	},
	eventData?: unknown,
) => void;

/**
 * Tagged no-op Plausible stub: armed pre-hydration and re-armed on opt-out so
 * orphaned trackers never expose a live entry point. The `__stub` tag lets the
 * readiness predicates distinguish stub from real tracker.
 */
export function createPlausibleStub(): PlausibleTrackFn {
	const stub: PlausibleTrackFn = (_name, options) => {
		options?.callback?.({ status: 200 });
	};
	(stub as { __stub?: boolean }).__stub = true;
	return stub;
}

// Per-provider readiness: the real tracker is present (the Plausible stub is
// tagged `__stub`; Umami gets no stub, absence simply means not ready).
const plausibleReady = () =>
	typeof window.plausible === "function" &&
	!(window.plausible as unknown as { __stub?: boolean }).__stub;
const umamiReady = () => typeof window.umami?.track === "function";

type Provider = "plausible" | "umami";
const PROVIDER_NAMES = ["plausible", "umami"] as const;

const isReady = (p: Provider) =>
	p === "plausible" ? plausibleReady() : umamiReady();

// Trackers load asynchronously; conversion events can fire before the script
// is fetched, so events buffer per provider and flush on readiness (bounded).
const buffer: Partial<
	Record<
		Provider,
		Array<[AnalyticsEventName, AnalyticsEventData | undefined]>
	>
> = {};
let retryTimer: ReturnType<typeof setInterval> | undefined;
let retryAttempts = 0;
const MAX_RETRY_ATTEMPTS = 33; // ~10s at 300ms — never an eternal interval

function send(
	provider: Provider,
	name: AnalyticsEventName,
	data?: AnalyticsEventData,
) {
	if (provider === "plausible") window.plausible?.(name, { props: data });
	else window.umami?.track(name, data);
}

function tryFlush() {
	if (!analyticsEnabled()) return; // never transmit after opt-out
	for (const p of PROVIDER_NAMES) {
		if (!isReady(p)) continue;
		for (const [n, d] of buffer[p] ?? []) send(p, n, d);
		buffer[p] = [];
	}
	const allReady = PROVIDER_NAMES.every((p) => !providers[p] || isReady(p));
	if (allReady || ++retryAttempts >= MAX_RETRY_ATTEMPTS) {
		clearInterval(retryTimer);
		retryTimer = undefined;
	}
}

export function trackEvent(
	name: AnalyticsEventName,
	data?: AnalyticsEventData,
) {
	if (!browser || !analyticsEnabled()) return;
	for (const p of PROVIDER_NAMES) {
		if (!providers[p]) continue;
		if (isReady(p)) send(p, name, data);
		else (buffer[p] ??= []).push([name, data]);
	}
	tryFlush();
	if (!retryTimer) {
		// fresh retry episode: the attempt budget restarts (a past bounded stop
		// must not disable delivery for the rest of the session)
		retryAttempts = 0;
		retryTimer = setInterval(tryFlush, 300);
	}
}

/**
 * Per-send opt-out flags honored by the tracker scripts themselves (verified
 * against the plausible script.js and the umami v3.4.0 tracker source):
 * removing the injected <script> and restoring the History methods cannot
 * stop an already-executed tracker's own popstate/engagement listeners, but
 * these flags are re-checked on every event/send, so beacons stop immediately.
 */
export function setTrackerOptOut(optedOut: boolean) {
	if (!browser) return;
	try {
		if (optedOut) {
			localStorage.setItem("plausible_ignore", "true");
			localStorage.setItem("umami.disabled", "1");
		} else {
			localStorage.removeItem("plausible_ignore");
			localStorage.removeItem("umami.disabled");
		}
	} catch {
		// localStorage unavailable — the flags are best-effort hardening
	}
}

/**
 * Drops buffered (not yet transmitted) events and stops the retry interval.
 * Called from the opt-out teardown: pre-opt-out events are never deferred to
 * transmit after the user withdraws consent.
 */
export function purgeAnalyticsBuffer() {
	for (const p of PROVIDER_NAMES) buffer[p] = [];
	retryAttempts = 0;
	if (retryTimer) {
		clearInterval(retryTimer);
		retryTimer = undefined;
	}
}
