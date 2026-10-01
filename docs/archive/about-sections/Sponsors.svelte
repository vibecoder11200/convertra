<script lang="ts">
	import Panel from "$lib/components/visual/Panel.svelte";
	import { PiggyBankIcon } from "lucide-svelte";
	import { DISCORD_URL } from "$lib/util/consts";
	import { m } from "$lib/paraglide/messages";
	import { link, sanitize } from "$lib/store/index.svelte";
	import lily from "$lib/assets/lily.jpeg";
</script>

<Panel class="flex flex-col gap-3 p-6 min-h-[280px]">
	<h2 class="text-2xl font-bold flex items-center">
		<div class="rounded-full bg-accent p-2 inline-block mr-3 w-10 h-10">
			<PiggyBankIcon class="text-on-accent" />
		</div>
		{m["about.sponsors.title"]()}
	</h2>
	<div class="mt-2 [&>*]:font-normal h-full flex justify-between flex-col">
		<div class="flex gap-3 justify-center text-lg">
			<a
				href="https://eva.pink"
				target="_blank"
				class="w-48 h-24 rounded-2xl px-0 btn gap-2 flex flex-col justify-center items-center"
			>
				<img
					src={lily}
					alt="Eva"
					class="w-full h-full select-none object-cover"
				/>
			</a>
		</div>
		<p class="text-muted">
			{@html sanitize(
				link(
					"discord_link",
					m["about.sponsors.description"](),
					DISCORD_URL,
					true,
				),
			)}
		</p>
	</div>
</Panel>
