<script lang="ts">
	import { page } from "$app/state";
	import { duration, transition } from "$lib/util/animation";
	import VertVBig from "$lib/assets/convertra-bg.svg?component";
	import { files, gradientColor } from "$lib/store/index.svelte";
	import { quintOut } from "svelte/easing";
	import { fade } from "$lib/util/animation";
	import { Tween } from "svelte/motion";

	const colors: {
		matcher: (path: string) => boolean;
		color: string;
		at: number;
	}[] = $derived([
		{
			matcher: (path) => path === "/",
			color: "var(--bg-gradient-from)",
			at: 100,
		},
		{
			matcher: (path) => path === "/convert/",
			color: `var(--bg-gradient-${$gradientColor ? $gradientColor + "-" : ""}from)`,
			at: 25,
		},
		{
			matcher: (path) => path === "/settings/",
			color: "var(--bg-gradient-blue-from)",
			at: 25,
		},
		{
			matcher: (path) => path === "/about/",
			color: "var(--bg-gradient-from)",
			at: 25,
		},
		{
			matcher: (path) => path === "/privacy/",
			color: "var(--bg-gradient-red-from)",
			at: 100,
		},
	]);

	const color = $derived(
		Object.values(colors).find((p) => p.matcher(page.url.pathname)) || {
			matcher: () => false,
			color: "transparent",
			at: 0,
		},
	);

	// svelte-ignore state_referenced_locally This captures the initial value; the effect below keeps it reactive
	let at = new Tween(color.at, {
		duration,
		easing: quintOut,
	});

	$effect(() => {
		at.set(color.at);
	});

	const maskImage = $derived(
		`linear-gradient(to top, transparent ${100 - at.current}%, black 100%)`,
	);
</script>

{#if page.url.pathname === "/"}
	<div
		class="fixed -z-30 top-0 left-0 w-screen h-screen flex items-center justify-center overflow-hidden"
		transition:fade={{
			duration,
			easing: quintOut,
		}}
	>
		<VertVBig
			class="text-[--fg] opacity-10 dynadark:opacity-5 scale-[130%] md:scale-[62%]"
		/>
	</div>
{/if}

<div
	class="fixed top-0 left-0 w-screen h-screen -z-40 pointer-events-none"
	style="background-color: {color.color}; 
	mask-image: {maskImage}; 
	-webkit-mask-image: {maskImage};
	transition: background-color {duration}ms {transition};"
></div>

{#if page.url.pathname === "/convert/" && files.files.length === 1}
	{@const bgMask =
		"linear-gradient(to top, transparent 5%, rgba(0, 0, 0, 0.5) 100%)"}
	<div
		class="fixed top-0 left-0 w-screen h-screen -z-50"
		style="background-image: url({files.files[0].blobUrl});
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		filter: blur(10px);
		mask-image: {bgMask};
		-webkit-mask-image: {bgMask};"
		transition:fade={{ duration, easing: quintOut }}
	></div>
{/if}
