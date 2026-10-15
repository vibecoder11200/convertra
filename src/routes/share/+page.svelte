<script lang="ts">
	import { m } from "$lib/paraglide/messages";
	import { Share2Icon } from "lucide-svelte";

	// Graceful fallback when a share POST lands here without the service
	// worker intercepting it (first share right after install, or while the
	// SW updates). The SW normally turns this POST into a stash + redirect to
	// /convert, so reaching this page at all means the automatic handoff
	// wasn't available.
</script>

<div class="flex flex-col h-full items-center">
	<h1 class="hidden md:block text-[40px] tracking-tight leading-[72px] mb-6">
		<Share2Icon size="40" class="inline-block -mt-2 mr-2" />
		{m["share.title"]()}
	</h1>

	<div class="w-full max-w-[720px] p-4 md:px-4 md:py-0">
		<div class="bg-panel rounded-2xl p-6 shadow-panel text-lg font-normal">
			<p class="mb-4">{m["share.description"]()}</p>
			<a class="highlight btn" href="/convert/">{m["share.open_app"]()}</a>
		</div>
	</div>
</div>
