import "@poppanator/sveltekit-svg/dist/svg";

type CallbackArgs = {
	readonly status: number;
};

type EventOptions = {
	/**
	 * Callback called when the event is successfully sent.
	 */
	readonly callback?: (args: CallbackArgs) => void;
	/**
	 * Properties to be bound to the event.
	 */
	readonly props?: { readonly [propName: string]: string | number | boolean };
};

type UmamiTracker = {
	/**
	 * Tracks a custom event (Umami tracker functions).
	 */
	track: (
		eventName: string,
		eventData?: Record<string, string | number | boolean>,
	) => void;
	identify: (...args: unknown[]) => void;
};

declare global {
	interface Window {
		plausible?: TrackEvent;
		umami?: UmamiTracker;
	}

	const __COMMIT_HASH__: string;
}

/**
 * Options used when initializing the tracker.
 */
export type PlausibleInitOptions = {
	/**
	 * If true, pageviews will be tracked when the URL hash changes.
	 * Enable this if you are using a frontend that uses hash-based routing.
	 */
	readonly hashMode?: boolean;
	/**
	 * Set to true if you want events to be tracked when running the site locally.
	 */
	readonly trackLocalhost?: boolean;
	/**
	 * The domain to bind the event to.
	 * Defaults to `location.hostname`
	 */
	readonly domain?: Location["hostname"];
	/**
	 * The API host where the events will be sent.
	 * Defaults to `'https://plausible.io'`
	 */
	readonly apiHost?: string;
};

/**
 * Data passed to Plausible as events.
 */
export type PlausibleEventData = {
	/**
	 * The URL to bind the event to.
	 * Defaults to `location.href`.
	 */
	readonly url?: Location["href"];
	/**
	 * The referrer to bind the event to.
	 * Defaults to `document.referrer`
	 */
	readonly referrer?: Document["referrer"] | null;
	/**
	 * The current device's width.
	 * Defaults to `window.innerWidth`
	 */
	readonly deviceWidth?: Window["innerWidth"];
};

/**
 * Options used when tracking Plausible events.
 */
export type PlausibleOptions = PlausibleInitOptions & PlausibleEventData;

/**
 * Tracks a custom event.
 *
 * Use it to track your defined goals by providing the goal's name as `eventName`.
 *
 * ### Example
 * ```js
 * import Plausible from 'plausible-tracker'
 *
 * const { trackEvent } = Plausible()
 *
 * // Tracks the 'signup' goal
 * trackEvent('signup')
 *
 * // Tracks the 'Download' goal passing a 'method' property.
 * trackEvent('Download', { props: { method: 'HTTP' } })
 * ```
 *
 * @param eventName - Name of the event to track
 * @param options - Event options.
 * @param eventData - Optional event data to send. Defaults to the current page's data merged with the default options provided earlier.
 */
type TrackEvent = (
	eventName: string,
	options?: EventOptions,
	eventData?: PlausibleOptions,
) => void;

/**
 * Initializes the tracker with your default values.
 *
 * ### Example (es module)
 * ```js
 * import Plausible from 'plausible-tracker'
 *
 * const { enableAutoPageviews, trackEvent } = Plausible({
 *   domain: 'my-app-domain.com',
 *   hashMode: true
 * })
 *
 * enableAutoPageviews()
 *
 * function onUserRegister() {
 *   trackEvent('register')
 * }
 * ```
 *
 * ### Example (commonjs)
 * ```js
 * var Plausible = require('plausible-tracker');
 *
 * var { enableAutoPageviews, trackEvent } = Plausible({
 *   domain: 'my-app-domain.com',
 *   hashMode: true
 * })
 *
 * enableAutoPageviews()
 *
 * function onUserRegister() {
 *   trackEvent('register')
 * }
 * ```
 *
 * @param defaults - Default event parameters that will be applied to all requests.
 */

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module "svelte/elements" {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interface HTMLAttributes<T> {
		[key: `event-${string}`]: string | undefined | null;
	}
}

export {};
