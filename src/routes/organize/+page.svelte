<script lang="ts">
	import { onMount } from "svelte";
	import { m } from "$lib/paraglide/messages";
	import Organizer from "$lib/sections/organize/Organizer.svelte";
	import UnlockModal from "$lib/components/functional/UnlockModal.svelte";
	import { organize } from "$lib/sections/organize/store.svelte";

	// leaving the page frees the render worker and the (possibly
	// decrypted) source bytes — onMount so the cleanup doesn't track
	// store reads the way an $effect would
	onMount(() => () => organize.reset());
</script>

<svelte:head>
	<title>{m["organize.title"]()} | Convertra</title>
	<meta name="description" content={m["organize.meta_description"]()} />
</svelte:head>

<div class="flex flex-col items-center gap-6 w-full">
	<h1 class="hidden md:block text-[40px] tracking-tight leading-[72px]">
		{m["organize.title"]()}
	</h1>
	<p class="text-muted text-center max-w-[720px]">
		{m["organize.subtitle"]()}
	</p>
	<Organizer />
</div>

<UnlockModal />
