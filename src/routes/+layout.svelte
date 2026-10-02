<script lang="ts">
	import { onMount } from "svelte";
	import { goto, beforeNavigate, afterNavigate } from "$app/navigation";

	import {
		PUB_PLAUSIBLE_URL,
		PUB_UMAMI_URL,
		PUB_UMAMI_WEBSITE_ID,
		PUB_HOSTNAME,
	} from "$env/static/public";
	import {
		DISABLE_ALL_EXTERNAL_REQUESTS,
		APP_NAME,
	} from "$lib/util/consts.js";
	import * as Layout from "$lib/components/layout";
	import * as Navbar from "$lib/components/layout/Navbar";
	import featuredImage from "$lib/assets/convertra-feature.webp";
	import { Settings } from "$lib/sections/settings/index.svelte";
	import {
		analyticsEnabled,
		createPlausibleStub,
		purgeAnalyticsBuffer,
		providers,
		UMAMI_SCRIPT_PATH,
		type AnalyticsVia,
	} from "$lib/analytics/index";
	import {
		files,
		isMobile,
		effects,
		theme,
		dropping,
		vertdLoaded,
		locale,
		updateLocale,
	} from "$lib/store/index.svelte";
	import "$lib/css/app.scss";
	import { browser } from "$app/environment";
	import { initStores as initAnimStores } from "$lib/util/animation.js";
	import { VertdInstance } from "$lib/sections/settings/vertdSettings.svelte.js";
	import { ToastManager } from "$lib/util/toast.svelte.js";
	import { m } from "$lib/paraglide/messages.js";
	import { log } from "$lib/util/logger.js";

	let { children } = $props();
	let analyticsActive = $state(false);
	let isAprilFools = $state(false);

	let scrollPositions = new Map<string, number>();

	// canonical/og:url/twitter:url need a configured hostname - an empty
	// PUB_HOSTNAME would render broken "https:///" URLs that SvelteKit's
	// prerender crawler also fails to parse (Invalid URL)
	const canonicalBase = PUB_HOSTNAME ? `https://${PUB_HOSTNAME}` : "";

	beforeNavigate((nav) => {
		if (!nav.from || !$isMobile) return;
		scrollPositions.set(nav.from.url.pathname, window.scrollY);
	});

	afterNavigate((nav) => {
		if (!$isMobile) return;
		const scrollY = nav.to
			? scrollPositions.get(nav.to.url.pathname) || 0
			: 0;
		window.scrollTo(0, scrollY);
	});

	// add() is not awaited: regular files push synchronously, so the length
	// comparison right after reflects what was added
	const addFiles = (list: FileList | null | undefined, via: AnalyticsVia) => {
		const oldLength = files.files.length;
		files.add(list, via);
		if (oldLength !== files.files.length) goto("/convert");
	};

	const dropFiles = (e: DragEvent) => {
		e.preventDefault();
		dropping.set(false);
		addFiles(e.dataTransfer?.files, "drop");
	};

	const handleDrag = (e: DragEvent, drag: boolean) => {
		e.preventDefault();
		dropping.set(drag);
	};

	const handlePaste = (e: ClipboardEvent) => {
		const clipboardData = e.clipboardData;
		if (!clipboardData || !clipboardData.files.length) return;
		e.preventDefault();
		addFiles(clipboardData.files, "paste");
	};

	onMount(() => {
		const now = new Date();
		isAprilFools = now.getDate() === 1 && now.getMonth() === 3;

		initAnimStores();

		const handleResize = () => {
			isMobile.set(window.innerWidth <= 768);
		};

		isMobile.set(window.innerWidth <= 768); // initial page load
		window.addEventListener("resize", handleResize); // handle window resize
		window.addEventListener("paste", handlePaste);

		effects.set(localStorage.getItem("effects") !== "false"); // defaults to true if not set
		theme.set(
			(localStorage.getItem("theme") as "light" | "dark") || "light",
		);
		const storedLocale = localStorage.getItem("locale");
		if (storedLocale) updateLocale(storedLocale);

		Settings.instance.load();

		if (!DISABLE_ALL_EXTERNAL_REQUESTS) {
			VertdInstance.instance
				.url()
				.then((u) => (u ? fetch(`${u}/api/version`) : undefined))
				.then((res) => {
					if (res && res.ok) $vertdLoaded = true;
				});
		}

		// detect if insecure context
		if (!window.isSecureContext) {
			log(
				["layout"],
				'Insecure context (HTTP) detected, some features may not work as expected -- you may want to enable "PUB_DISABLE_FAILURE_BLOCKS" on local deployments.',
			);
			ToastManager.add({
				type: "warning",
				message: m["toast.insecure_context"](),
				disappearing: false,
			});
		}

		return () => {
			window.removeEventListener("paste", handlePaste);
			window.removeEventListener("resize", handleResize);
		};
	});

	$effect(() => {
		analyticsActive = analyticsEnabled();
		if (!analyticsActive && browser) {
			// opt-out teardown: removing the <script> does not unload an
			// already-executed tracker, so restore the History methods
			// (stops popstate/replaceState pageviews, e.g. the Back button)
			// and re-arm no-op stubs so orphaned trackers' entry points die.
			history.pushState = History.prototype.pushState;
			history.replaceState = History.prototype.replaceState;
			window.plausible = createPlausibleStub();
			window.umami = undefined;
			purgeAnalyticsBuffer(); // buffered pre-opt-out events are dropped, not deferred
		}
	});
</script>

<svelte:head>
	<title>{APP_NAME}</title>
	<meta
		name="theme-color"
		media="(prefers-color-scheme: light)"
		content="#D0F1EE"
	/>
	<meta
		name="theme-color"
		media="(prefers-color-scheme: dark)"
		content="#151A1E"
	/>
	<meta
		name="title"
		content="{APP_NAME} — Free, fast, and awesome file converter"
	/>
	<meta
		name="description"
		content="With Convertra, you can quickly convert any image, video, audio, and document file. No ads, open source, and all processing (other than video) is done on your device. Analytics are anonymous, aggregated, and cookieless — opt out in Settings."
	/>
	{#if canonicalBase}
		<meta property="og:url" content={canonicalBase} />
	{/if}
	<meta property="og:type" content="website" />
	<meta
		property="og:title"
		content="{APP_NAME} — Free, fast, and awesome file converter"
	/>
	<meta
		property="og:description"
		content="With Convertra, you can quickly convert any image, video, audio, and document file. No ads, open source, and all processing (other than video) is done on your device. Analytics are anonymous, aggregated, and cookieless — opt out in Settings."
	/>
	<meta property="og:image" content={featuredImage} />
	<meta name="twitter:card" content="summary_large_image" />
	{#if canonicalBase}
		<meta property="twitter:domain" content={PUB_HOSTNAME} />
		<meta property="twitter:url" content={canonicalBase} />
	{/if}
	<meta
		property="twitter:title"
		content="{APP_NAME} — Free, fast, and awesome file converter"
	/>
	<meta
		property="twitter:description"
		content="With Convertra, you can quickly convert any image, video, audio, and document file. No ads, open source, and all processing (other than video) is done on your device. Analytics are anonymous, aggregated, and cookieless — opt out in Settings."
	/>
	<meta property="twitter:image" content={featuredImage} />
	<link rel="manifest" href="/manifest.json" />
	{#if canonicalBase}
		<link rel="canonical" href="{canonicalBase}/" />
	{/if}
	{#if analyticsActive && providers.plausible}
		<script
			defer
			data-domain={PUB_HOSTNAME}
			src="{PUB_PLAUSIBLE_URL}/js/script.js"
		></script>
	{/if}
	{#if analyticsActive && providers.umami}
		<script
			defer
			data-website-id={PUB_UMAMI_WEBSITE_ID}
			src="{PUB_UMAMI_URL}{UMAMI_SCRIPT_PATH}"
		></script>
	{/if}
	{#if isAprilFools}
		<style>
			* {
				font-family: "Comic Sans MS", "Comic Sans", cursive !important;
			}
		</style>
	{/if}
</svelte:head>

<!-- FIXME: if user resizes between desktop/mobile, highlight of page disappears (only shows on original size) -->
{#key $locale}
	<div
		class="flex flex-col min-h-screen h-full w-full overflow-x-hidden"
		ondrop={dropFiles}
		ondragenter={(e) => handleDrag(e, true)}
		ondragover={(e) => handleDrag(e, true)}
		ondragleave={(e) => handleDrag(e, false)}
		role="region"
	>
		<Layout.UploadRegion />

		<div>
			<Layout.MobileLogo />
			<Navbar.Desktop />
		</div>

		<!-- 
		SvelteKit throws the following warning when developing - safe to ignore as we render the children in this component:
		`<slot />` or `{@render ...}` tag missing — inner content will not be rendered
		-->
		<Layout.PageContent {children} />

		<Layout.Toasts />
		<Layout.Dialogs />

		<div>
			<Layout.Footer />
			<Navbar.Mobile />
		</div>
	</div>
{/key}

<!-- Gradients placed here to prevent it overlapping in transitions -->
<Layout.Gradients />
