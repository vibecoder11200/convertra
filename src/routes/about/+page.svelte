<script lang="ts">
	import * as About from "$lib/sections/about";
	import { InfoIcon } from "lucide-svelte";
	import { PUB_DONATION_URL, PUB_STRIPE_KEY } from "$env/static/public";
	import { DISABLE_ALL_EXTERNAL_REQUESTS } from "$lib/util/consts";
	import { m } from "$lib/paraglide/messages";

	const donationsEnabled =
		PUB_STRIPE_KEY && PUB_DONATION_URL && !DISABLE_ALL_EXTERNAL_REQUESTS;
</script>

<div class="flex flex-col h-full items-center">
	<h1 class="hidden md:block text-[40px] tracking-tight leading-[72px] mb-6">
		<InfoIcon size="40" class="inline-block -mt-2 mr-2" />
		{m["about.title"]()}
	</h1>

	<div class="w-full max-w-[1280px] flex flex-col gap-4 p-4 md:px-4 md:py-0">
		{#if donationsEnabled}
			<About.Donate />
		{/if}
		<About.Why />
	</div>
</div>
