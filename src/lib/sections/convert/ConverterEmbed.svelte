<script lang="ts">
	import { DownloadIcon, RotateCwIcon, XIcon } from "lucide-svelte";
	import { m } from "$lib/paraglide/messages";
	import { files } from "$lib/store/index.svelte";
	import Uploader from "$lib/components/functional/Uploader.svelte";
	import ProgressBar from "$lib/components/visual/ProgressBar.svelte";
	import type { VertFile } from "$lib/types";

	/**
	 * The pair-page tool: an uploader plus a per-file flow with the pair
	 * preselected — drop a matching file and it converts immediately. Files
	 * live in the global store, so navigating to /convert keeps them (and
	 * their results); files already in the store when the page opens are
	 * left alone.
	 */
	let {
		from,
		to,
	}: {
		from: string;
		to: string;
	} = $props();

	const fromExt = `.${from.toLowerCase()}`;
	const toExt = `.${to.toLowerCase()}`;

	// only files added while THIS embed is mounted are auto-queued
	const preexisting = new Set<string>(files.files.map((f) => f.id));
	const queued = new Set<string>();

	$effect(() => {
		for (const file of files.files) {
			if (preexisting.has(file.id) || queued.has(file.id)) continue;
			queued.add(file.id);
			// a matching file gets the pair target; anything else still
			// converts (this page is a converter) with its default target
			if (file.from === fromExt) file.to = toExt;
			void file.convert();
		}
	});

	const remove = (file: VertFile) => {
		files.clearDecrypted(file.id);
		files.files = files.files.filter((f) => f.id !== file.id);
	};
</script>

<div class="w-full flex flex-col gap-4">
	{#if files.files.length === 0}
		<Uploader navigateAway={false} class="w-full min-h-56" />
	{:else}
		{#each files.files as file (file.id)}
			<div
				class="bg-panel rounded-2xl shadow-panel p-4 flex flex-col gap-3"
			>
				<div class="flex items-center gap-3">
					<div class="min-w-0 flex-1">
						<p class="truncate font-medium">{file.name}</p>
						<p class="text-sm text-muted">
							{file.from} → {file.to}
						</p>
					</div>
					<button
						class="flex-shrink-0 w-8 rounded-full hover:bg-panel-alt h-8 flex items-center justify-center"
						aria-label={m["convert.panel.remove_all"]()}
						onclick={() => remove(file)}
					>
						<XIcon size="18" class="text-muted" />
					</button>
				</div>

				{#if file.processing}
					<ProgressBar min={0} max={100} progress={file.progress} />
				{:else if file.result}
					<div class="flex items-center justify-between gap-3">
						<p class="text-sm text-muted truncate">
							{file.result.name} · {(
								file.result.file.size / 1024
							).toFixed(1)} KB
						</p>
						<button
							class="btn highlight flex gap-2 items-center"
							onclick={() => file.download()}
						>
							<DownloadIcon size="18" />
							{m["convert.panel.download_all"]()}
						</button>
					</div>
				{:else}
					<div class="flex items-center justify-between gap-3">
						<p class="text-sm text-muted">
							{m["seo.pair.failed"]()}
						</p>
						<button
							class="btn highlight p-2"
							aria-label={m["convert.tooltips.convert_file"]()}
							onclick={() => void file.convert()}
						>
							<RotateCwIcon size="18" />
						</button>
					</div>
				{/if}
			</div>
		{/each}
		<Uploader navigateAway={false} class="w-full min-h-32" />
	{/if}
</div>
