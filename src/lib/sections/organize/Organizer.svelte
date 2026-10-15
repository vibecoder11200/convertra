<script lang="ts">
	import { DownloadIcon, Redo2Icon, RotateCwIcon, Trash2Icon, UploadIcon } from "lucide-svelte";
	import { m } from "$lib/paraglide/messages";
	import { ToastManager } from "$lib/util/toast.svelte";
	import { organize } from "./store.svelte";
	import Panel from "$lib/components/visual/Panel.svelte";
	import ProgressBar from "$lib/components/visual/ProgressBar.svelte";

	let fileInput = $state<HTMLInputElement>();
	let focusIndex = $state(-1);
	let dragIndex = $state<number | null>(null);

	// export() bypasses VertFile.convert's toast handling, so surface
	// worker failures here
	const exportPdf = () =>
		organize.export().catch((err: unknown) => {
			ToastManager.add({
				type: "error",
				message: m["workers.errors.general"]({
					file: organize.fileName || "PDF",
					message: String(err),
				}),
			});
		});

	const onInput = async (e: Event) => {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) await organize.load(file);
		input.value = "";
	};

	const onDrop = async (e: DragEvent) => {
		e.preventDefault();
		const file = e.dataTransfer?.files?.[0];
		if (file) await organize.load(file);
	};

	// removing shifts the tail left — clamp focus onto the new last page
	const removeAt = (index: number) => {
		organize.remove(index);
		focusIndex = Math.min(focusIndex, organize.pages.length - 1);
	};

	// keyboard a11y on the grid: arrows reorder the focused page,
	// r rotates, delete removes
	const onGridKeydown = (e: KeyboardEvent) => {
		if (focusIndex < 0 || focusIndex >= organize.pages.length) return;
		switch (e.key) {
			case "ArrowLeft":
				organize.moveTo(focusIndex, focusIndex - 1);
				focusIndex -= 1;
				e.preventDefault();
				break;
			case "ArrowRight":
				organize.moveTo(focusIndex, focusIndex + 1);
				focusIndex += 1;
				e.preventDefault();
				break;
			case "r":
			case "R":
				organize.rotate(focusIndex);
				e.preventDefault();
				break;
			case "Delete":
			case "Backspace":
				removeAt(focusIndex);
				e.preventDefault();
				break;
		}
	};
</script>

{#snippet ThumbLoader(src: number)}
	<!-- the microtask defers requestThumb off the render pass — it must not
	     run (or write state) while the snippet expression is evaluated -->
	{#await Promise.resolve().then(() => organize.requestThumb(src)) then}
		<div class="absolute inset-0 flex items-center justify-center">
			<div
				class="w-6 h-6 border-2 border-muted border-t-transparent rounded-full animate-spin"
			></div>
		</div>
	{/await}
{/snippet}

{#if !organize.data}
	<div
		class="w-full max-w-[860px]"
		role="group"
		aria-label={m["organize.drop"]()}
		ondragover={(e) => e.preventDefault()}
		ondrop={onDrop}
	>
		<button class="w-full" onclick={() => fileInput?.click()}>
			<Panel class="flex justify-center items-center w-full h-full flex-col min-h-64 pointer-events-none">
				<div class="w-16 h-16 bg-accent rounded-full flex items-center justify-center p-4">
					<UploadIcon class="w-full h-full text-on-accent" />
				</div>
				<h2 class="text-center text-2xl font-semibold mt-4">
					{m["organize.drop"]()}
				</h2>
				<p class="text-center text-sm text-muted mt-1">
					{m["organize.drop_hint"]()}
				</p>
			</Panel>
		</button>
		<input
			bind:this={fileInput}
			type="file"
			accept="application/pdf,.pdf"
			class="hidden"
			onchange={onInput}
		/>
	</div>
{:else}
	<div class="w-full max-w-[1100px] flex flex-col gap-4">
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<div class="min-w-0">
				<p class="font-medium truncate">{organize.fileName}</p>
				<p class="text-sm text-muted">
					{m["organize.page_count"]({ count: organize.pages.length })}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<button
					class="btn p-2 disabled:opacity-30"
					disabled={!organize.canUndo}
					aria-label={m["organize.undo"]()}
					onclick={() => organize.undo()}
				>
					<Redo2Icon size="18" class="rotate-180" />
				</button>
				<button
					class="btn highlight flex gap-2 items-center"
					disabled={organize.processing || organize.pages.length === 0}
					onclick={exportPdf}
				>
					<DownloadIcon size="18" />
					{m["organize.export"]()}
				</button>
			</div>
		</div>

		{#if organize.processing}
			<ProgressBar min={0} max={100} progress={null} />
		{:else if organize.result}
			<Panel class="p-4 flex items-center justify-between gap-3">
				<p class="text-sm text-muted truncate">
					{m["organize.done"]()}
				</p>
				<button class="btn highlight flex gap-2 items-center" onclick={() => organize.result?.download()}>
					<DownloadIcon size="18" />
					{m["organize.download"]()}
				</button>
			</Panel>
		{/if}

		<div
			class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
			role="listbox"
			aria-label={m["organize.pages_label"]()}
			tabindex="0"
			onkeydown={onGridKeydown}
		>
			{#each organize.pages as page, index (page.src)}
				<div
					class="bg-panel rounded-2xl shadow-panel p-2 flex flex-col gap-2 {focusIndex === index
						? 'ring-2 ring-accent'
						: ''} {dragIndex === index ? 'opacity-50' : ''}"
					role="option"
					aria-selected={focusIndex === index}
					aria-label={m["organize.page_label"]({ index: index + 1 })}
					tabindex="0"
					draggable="true"
					ondragover={(e) => {
						if (dragIndex !== null && dragIndex !== index) e.preventDefault();
					}}
					ondrop={(e) => {
						e.preventDefault();
						if (dragIndex !== null && dragIndex !== index)
							organize.moveTo(dragIndex, index);
						dragIndex = null;
					}}
					ondragstart={() => (dragIndex = index)}
					ondragend={() => (dragIndex = null)}
					onfocus={() => (focusIndex = index)}
				>
					<div
						class="relative w-full bg-panel-alt rounded-lg overflow-hidden aspect-[3/4] cursor-grab active:cursor-grabbing"
					>
						{#if organize.thumbs[page.src]}
							<img
								src={organize.thumbs[page.src]}
								alt={m["organize.page_label"]({ index: index + 1 })}
								class="absolute inset-0 w-full h-full object-contain transition-transform"
								style:transform="rotate({page.rotation}deg)"
								draggable="false"
								loading="lazy"
							/>
						{:else}
							{@render ThumbLoader(page.src)}
						{/if}
						<span
							class="absolute top-1 left-1 bg-black/60 text-white text-xs rounded px-1.5 py-0.5"
						>
							{index + 1}
						</span>
						{#if page.rotation !== 0}
							<span
								class="absolute top-1 right-1 bg-accent text-on-accent text-xs rounded px-1.5 py-0.5"
							>
								{page.rotation}°
							</span>
						{/if}
					</div>
					<div class="flex items-center justify-center gap-1">
						<button
							class="p-1.5 rounded hover:bg-panel-alt"
							aria-label={m["organize.rotate"]()}
							title={m["organize.rotate"]()}
							onclick={() => organize.rotate(index)}
						>
							<RotateCwIcon size="15" />
						</button>
						<button
							class="p-1.5 rounded hover:bg-panel-alt"
							aria-label={m["organize.move_left"]()}
							title={m["organize.move_left"]()}
							disabled={index === 0}
							onclick={() => organize.move(index, -1)}
						>
							←
						</button>
						<button
							class="p-1.5 rounded hover:bg-panel-alt"
							aria-label={m["organize.move_right"]()}
							title={m["organize.move_right"]()}
							disabled={index === organize.pages.length - 1}
							onclick={() => organize.move(index, 1)}
						>
							→
						</button>
							<button
							class="p-1.5 rounded hover:bg-panel-alt text-failure"
							aria-label={m["organize.remove"]()}
							title={m["organize.remove"]()}
							onclick={() => removeAt(index)}
						>
							<Trash2Icon size="15" />
						</button>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

