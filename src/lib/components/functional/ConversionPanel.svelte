<script lang="ts">
	import { effects, files } from "$lib/store/index.svelte";
	import type { VertFile } from "$lib/types";
	import { FolderArchiveIcon, RefreshCw, Trash2Icon } from "lucide-svelte";
	import Panel from "../visual/Panel.svelte";
	import Dropdown from "./Dropdown.svelte";
	import Tooltip from "../visual/Tooltip.svelte";
	import ProgressBar from "../visual/ProgressBar.svelte";
	import FormatDropdown from "./FormatDropdown.svelte";
	import { categories } from "$lib/converters";
	import { m } from "$lib/paraglide/messages";

	const length = $derived(files.files.length);
	const progress = $derived(files.files.filter((f) => f.result).length);

	// converters that can actually read the file - output-only formats don't
	// count (e.g. pdf-render lists .png as an output only, so it must not be
	// considered a .png input converter, otherwise .png and .jpg files that
	// both go through imagemagick would look "different")
	const readableConverters = (f: VertFile) =>
		f.converters
			.filter(
				(c) =>
					f.isZip() ||
					c.supportedFormats.find((x) => x.name === f.from)
						?.fromSupported,
			)
			.map((c) => c.name)
			.sort()
			.join(",");

	// check if all files have the same converters
	// video and audio together still have this dropdown disabled because audio has just ffmpeg (video has vertd & ffmpeg), even tho it can convert between video and audio
	const sameConverters = $derived(
		files.files.length > 0 &&
			files.files.every((f) => f.converters.length) &&
			files.files.every(
				(f) =>
					readableConverters(f) ===
					readableConverters(files.files[0]),
			),
	);

	// show the shared target format once every file agrees on one
	const setAllLabel = $derived(
		files.files.length > 0 &&
			files.files.every((f) => f.to === files.files[0].to)
			? files.files[0].to
			: "",
	);
</script>

<Panel
	class="flex flex-col gap-4 max-md:fixed max-md:bottom-36 max-md:left-4 max-md:right-4 max-md:z-40"
>
	<div
		class="w-full h-auto flex items-center justify-between flex-col md:flex-row gap-4"
	>
		<div class="flex items-center gap-2.5 max-md:w-full">
			<button
				onclick={() => files.convertAll()}
				class="btn {$effects
					? ''
					: '!scale-100'} highlight flex gap-3 max-md:flex-1 max-md:px-3 max-md:text-sm md:max-w-[15.5rem]"
				disabled={!files.ready}
			>
				<RefreshCw size="24" />
				<p>{m["convert.panel.convert_all"]()}</p>
			</button>
			<button
				class="btn {$effects
					? ''
					: '!scale-100'} flex gap-3 max-md:flex-1 max-md:px-3 max-md:text-sm md:max-w-[15.5rem]"
				disabled={!files.ready || !files.results}
				onclick={() => files.downloadAll()}
			>
				<FolderArchiveIcon size="24" />
				<p>{m["convert.panel.download_all"]()}</p>
			</button>
			<Tooltip text={m["convert.panel.remove_all"]()} position="top">
				<button
					class="btn p-4 {$effects
						? ''
						: '!scale-100'} flex gap-3 max-md:px-4"
					disabled={files.files.length === 0}
					onclick={() => (files.files = [])}
				>
					<Trash2Icon size="24" />
				</button>
			</Tooltip>
		</div>
		<div class="flex items-center gap-2 max-md:w-full">
			<p
				class="whitespace-normal text-xl text-right w-full max-md:hidden"
			>
				{m["convert.panel.set_all_to"]()}
			</p>
			<div class="max-md:w-full w-48 md:max-w-[6.5rem]">
				{#if sameConverters}
					<FormatDropdown
						onselect={(r) =>
							files.files.forEach((f) => {
								f.to = r;
								f.result = null;
							})}
						{categories}
						selected={setAllLabel}
						dropdownSize={"large"}
					/>
				{:else}
					<Dropdown options={[m["convert.panel.na"]()]} disabled />
				{/if}
			</div>
		</div>
		{#if files.files.length > 50}
			<div class="w-full px-2 flex gap-4 items-center">
				<div
					class="flex-shrink-0 -mt-0.5 font-normal text-sm text-muted"
				>
					{progress}/{length}
				</div>
				<div class="flex-grow">
					<ProgressBar min={0} max={length} {progress} />
				</div>
			</div>
		{/if}
	</div></Panel
>
