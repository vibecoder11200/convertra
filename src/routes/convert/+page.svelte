<script lang="ts">
	import ConversionPanel from "$lib/components/functional/ConversionPanel.svelte";
	import FormatDropdown from "$lib/components/functional/FormatDropdown.svelte";
	import Uploader from "$lib/components/functional/Uploader.svelte";
	import Panel from "$lib/components/visual/Panel.svelte";
	import ProgressBar from "$lib/components/visual/ProgressBar.svelte";
	import Tooltip from "$lib/components/visual/Tooltip.svelte";
	import { categories } from "$lib/converters";
	import {
		effects,
		files,
		gradientColor,
		showGradient,
		vertdLoaded,
		dropdownStates,
	} from "$lib/store/index.svelte";
	import { VertFile } from "$lib/types";
	import {
		AudioLines,
		BookText,
		DownloadIcon,
		FileMusicIcon,
		FileQuestionIcon,
		FileVideo2,
		FilmIcon,
		ImageIcon,
		ImageOffIcon,
		RotateCwIcon,
		XIcon,
	} from "lucide-svelte";
	import { m } from "$lib/paraglide/messages";
	import { Settings } from "$lib/sections/settings/index.svelte";
	import { MAX_ARRAY_BUFFER_SIZE } from "$lib/store/index.svelte";
	import { GB } from "$lib/util/consts";

	let processedFileIds = $state(new Set<string>());

	// Per-file PDF options (split range, compress quality, render scale,
	// epub page size).
	const pdfOptions = $state<
		Record<
			string,
			{ range: string; quality: number; scale: number; pageSize: string }
		>
	>({});

	const getPdfOptions = (id: string) => {
		pdfOptions[id] ??= {
			range: "",
			quality: 75,
			scale: 2,
			pageSize: "",
		};
		return pdfOptions[id];
	};

	// pdf sources reflow into these targets: the text is extracted and
	// re-typeset by pandoc, so the original page layout is not preserved
	const PDF_REFLOW_TARGETS = [
		".docx",
		".odt",
		".rtf",
		".md",
		".html",
		".pptx",
		".epub",
	];

	// Per-file client-side video options (trim start/end, fps, width).
	const videoOptions = $state<
		Record<
			string,
			{ start: number; end: number; fps: number; width: number }
		>
	>({});

	const getVideoOptions = (id: string) => {
		videoOptions[id] ??= { start: 0, end: 60, fps: 12, width: 480 };
		return videoOptions[id];
	};

	const convertVideo = async (file: VertFile) => {
		const opts = getVideoOptions(file.id);
		await file.convert({
			start: opts.start,
			end: opts.end,
			fps: opts.fps,
			width: opts.width,
		});
	};

	const convertPdf = async (file: VertFile) => {
		const opts = getPdfOptions(file.id);
		const to = file.to;
		// pdf-lib: compress (->.pdf), split-all (->.zip), split-range (->.pdf with range)
		if (to === ".pdf" || to === ".zip") {
			const isCompress = to === ".pdf" && opts.range === "";
			await file.convert(
				isCompress
					? { op: "compress", quality: opts.quality }
					: { op: "split", range: opts.range || "all" },
			);
			return;
		}
		// pdf-render: pdf -> png/jpeg/webp (epub inputs also take a page size)
		await file.convert({
			scale: opts.scale,
			range: opts.range || "all",
			pageSize: opts.pageSize,
		});
	};

	$effect(() => {
		if (!Settings.instance.settings || files.files.length === 0) return;

		files.files.forEach((file) => {
			const settings = Settings.instance.settings;
			if (processedFileIds.has(file.id)) return;

			const converter = file.findConverter();
			if (!converter) return;

			let category: string | undefined;
			const isImage = converter.name === "imagemagick";
			const isAudio = converter.name === "ffmpeg";
			const isVideo = converter.name === "vertd";
			const isDocument = converter.name === "pandoc";

			if (isImage) category = "image";
			else if (isAudio) category = "audio";
			else if (isVideo) category = "video";
			else if (isDocument) category = "doc";
			if (!category) return;

			let targetFormat: string | undefined;

			// restore saved format (if navigated back to page for example)
			const savedFormat = $dropdownStates[file.name];
			if (
				savedFormat &&
				savedFormat !== file.from &&
				categories[category]?.formats.includes(savedFormat)
			) {
				targetFormat = savedFormat;
			} else if (settings.useDefaultFormat) {
				// else use default format if enabled
				let defaultFormat: string | undefined;
				const df = settings.defaultFormat;
				if (category === "image") defaultFormat = df.image;
				else if (category === "audio") defaultFormat = df.audio;
				else if (category === "video") defaultFormat = df.video;
				else if (category === "doc") defaultFormat = df.document;

				if (
					defaultFormat &&
					defaultFormat !== file.from &&
					categories[category]?.formats.includes(defaultFormat)
				) {
					targetFormat = defaultFormat;
				}
			}

			// or use first available format (or if default format is same as input)
			if (!targetFormat) {
				const firstDiff = categories[category]?.formats.find(
					(f) => f !== file.from,
				);
				targetFormat =
					firstDiff || categories[category]?.formats[0] || "";
			}

			file.to = targetFormat;
			processedFileIds.add(file.id);
		});
	});

	const handleSelect = (option: string, file: VertFile) => {
		file.result = null;
	};

	$effect(() => {
		// Set gradient color depending on the file types
		let type = "";
		if (files.files.length) {
			const converters = files.files.map(
				(file) => file.findConverter()?.name,
			);
			const uniqueTypes = new Set(converters);

			if (uniqueTypes.size === 1) {
				const onlyType = converters[0];
				if (onlyType === "imagemagick") type = "blue";
				else if (onlyType === "ffmpeg") type = "purple";
				else if (onlyType === "vertd") type = "coral";
				else if (onlyType === "pandoc") type = "amber";
			}
		}

		if (files.files.length === 0 || !type) {
			showGradient.set(false);
		} else showGradient.set(true);

		gradientColor.set(type);
	});
</script>

{#snippet fileItem(file: VertFile, index: number)}
	{@const currentConverter = file.findConverter()}
	{@const isImage = currentConverter?.name === "imagemagick"}
	{@const isAudio = currentConverter?.name === "ffmpeg"}
	{@const isVideo = currentConverter?.name === "vertd"}
	{@const isDocument = currentConverter?.name === "pandoc"}
	<Panel class="p-5 flex flex-col min-w-0 gap-4 relative min-h-[16rem]">
		<div class="flex-shrink-0 h-8 w-full flex items-center gap-2">
			{#if !file.converters.length}
				<Tooltip
					text={m["convert.tooltips.unknown_file"]()}
					position="bottom"
				>
					<FileQuestionIcon size="24" class="flex-shrink-0" />
				</Tooltip>
			{:else if isAudio}
				<Tooltip
					text={m["convert.tooltips.audio_file"]()}
					position="bottom"
				>
					<AudioLines size="24" class="flex-shrink-0" />
				</Tooltip>
			{:else if isVideo}
				<Tooltip
					text={m["convert.tooltips.video_file"]()}
					position="bottom"
				>
					<FilmIcon size="24" class="flex-shrink-0" />
				</Tooltip>
			{:else if isDocument}
				<Tooltip
					text={m["convert.tooltips.document_file"]()}
					position="bottom"
				>
					<BookText size="24" class="flex-shrink-0" />
				</Tooltip>
			{:else}
				<Tooltip
					text={m["convert.tooltips.image_file"]()}
					position="bottom"
				>
					<ImageIcon size="24" class="flex-shrink-0" />
				</Tooltip>
			{/if}
			<div class="flex-grow overflow-hidden">
				{#if file.processing}
					<ProgressBar
						min={0}
						max={100}
						progress={currentConverter?.reportsProgress ||
						file.isZip()
							? file.progress
							: null}
					/>
				{:else}
					<h2
						class="text-xl font-body overflow-hidden text-ellipsis whitespace-nowrap"
						title={file.name}
					>
						{file.name}
					</h2>
				{/if}
			</div>
			<button
				class="flex-shrink-0 w-8 rounded-full hover:bg-panel-alt h-full flex items-center justify-center"
				onclick={async () => {
					await file.cancel();
					files.files = files.files.filter((_, i) => i !== index);
				}}
			>
				<XIcon size="24" class="text-muted" />
			</button>
		</div>
		{#if !currentConverter}
			{#if file.name.startsWith("vertd")}
				<div
					class="h-full flex flex-col text-center justify-center text-failure"
				>
					<p class="font-body font-bold">
						{m["convert.errors.cant_convert"]()}
					</p>
					<p class="font-normal">
						{m["convert.errors.vertd_server"]()}
					</p>
				</div>
			{:else}
				<div
					class="h-full flex flex-col text-center justify-center text-failure"
				>
					<p class="font-body font-bold">
						{m["convert.errors.cant_convert"]()}
					</p>
					<p class="font-normal">
						{m["convert.errors.unsupported_format"]()}
					</p>
				</div>
			{/if}
		{:else}
			{@const formatInfo = currentConverter.supportedFormats.find(
				(f) => f.name === file.from,
			)}
			{@const isLarge = file.isLarge()}
			{#if formatInfo && !formatInfo.fromSupported}
				<div
					class="h-full flex flex-col text-center justify-center text-failure"
				>
					<p class="font-body font-bold">
						{m["convert.errors.cant_convert"]()}
					</p>
					<p class="font-normal">
						{m["convert.errors.format_output_only"]()}
					</p>
				</div>
			{:else if isLarge && !file.supportsStreaming()}
				<div
					class="h-full flex flex-col text-center justify-center text-failure"
				>
					<p class="font-body font-bold">
						{m["convert.errors.cant_convert"]()}
					</p>
					<p class="font-normal">
						{m["workers.errors.file_too_large"]({
							limit: (MAX_ARRAY_BUFFER_SIZE / GB).toFixed(2),
						})}
					</p>
				</div>
			{:else if currentConverter.status === "downloading"}
				<div
					class="h-full flex flex-col text-center justify-center text-failure"
				>
					<p class="font-body font-bold">
						{m["convert.errors.cant_convert"]()}
					</p>
					<p class="font-normal">
						{m["convert.errors.worker_downloading"]({
							type: isAudio
								? m["convert.errors.audio"]()
								: isVideo
									? "Video"
									: isDocument
										? m["convert.errors.doc"]()
										: m["convert.errors.image"](),
						})}
					</p>
				</div>
			{:else if currentConverter.status === "error"}
				<div
					class="h-full flex flex-col text-center justify-center text-failure"
				>
					<p class="font-body font-bold">
						{m["convert.errors.cant_convert"]()}
					</p>
					<p class="font-normal">
						{m["convert.errors.worker_error"]({
							type: isAudio
								? m["convert.errors.audio"]()
								: isVideo
									? "Video"
									: isDocument
										? m["convert.errors.doc"]()
										: m["convert.errors.image"](),
						})}
					</p>
				</div>
			{:else if currentConverter.status === "not-ready"}
				<div
					class="h-full flex flex-col text-center justify-center text-failure"
				>
					<p class="font-body font-bold">
						{m["convert.errors.cant_convert"]()}
					</p>
					<p class="font-normal">
						{m["convert.errors.worker_timeout"]({
							type: isAudio
								? m["convert.errors.audio"]()
								: isVideo
									? "Video"
									: isDocument
										? m["convert.errors.doc"]()
										: m["convert.errors.image"](),
						})}
					</p>
				</div>
			{:else if isVideo && !$vertdLoaded && !isAudio && !isImage && !isDocument}
				<div
					class="h-full flex flex-col text-center justify-center text-failure"
				>
					<p class="font-body font-bold">
						{m["convert.errors.cant_convert"]()}
					</p>
					<p class="font-normal">
						{m["convert.errors.vertd_not_found"]()}
					</p>
				</div>
			{:else}
				<div class="flex flex-col items-center gap-4 flex-grow">
					<div class="w-full h-36 rounded-xl overflow-hidden">
						{#if file.blobUrl}
							<img
								class="object-cover w-full h-full"
								src={file.blobUrl}
								alt={file.name}
							/>
						{:else}
							<div
								class="w-full h-full flex items-center justify-center text-black"
								style="background: var({isAudio
									? '--bg-gradient-purple-alt'
									: isVideo
										? '--bg-gradient-coral-alt'
										: isDocument
											? '--bg-gradient-amber-alt'
											: '--bg-gradient-blue-alt'})"
							>
								{#if isAudio}
									<FileMusicIcon size="56" />
								{:else if isVideo}
									<FileVideo2 size="56" />
								{:else if isDocument}
									<BookText size="56" />
								{:else}
									<ImageOffIcon size="56" />
								{/if}
							</div>
						{/if}
					</div>
					<div class="flex flex-col items-center gap-2 w-full">
						<FormatDropdown
							{categories}
							from={file.from}
							bind:selected={file.to}
							onselect={(option) => handleSelect(option, file)}
							{file}
						/>
						{#if file.from === ".pdf" && PDF_REFLOW_TARGETS.includes(file.to)}
							<p class="text-xs text-muted text-center w-full">
								{m["convert.pdf.reflow_note"]()}
							</p>
						{/if}
						{#if currentConverter?.name === "pandoc+pdf-render"}
							<p class="text-xs text-muted text-center w-full">
								{m["convert.pdf.raster_note"]()}
							</p>
						{/if}
						{#if file.from === ".pdf" && file.to === ".md"}
							<p class="text-xs text-muted text-center w-full">
								{m["convert.pdf.scan_note"]()}
							</p>
						{/if}
						{#if (currentConverter?.name === "pdf-lib" && file.from === ".pdf") || currentConverter?.name === "pdf-render"}
							{@const opts = getPdfOptions(file.id)}
							<div
								class="w-full flex flex-col gap-1.5 items-stretch text-sm"
							>
								{#if currentConverter?.name === "pdf-lib"}
									<label class="text-muted">
										{m["convert.pdf.split_range"]()}
										<input
											class="w-full input"
											placeholder="e.g. 2-5"
											bind:value={opts.range}
										/>
									</label>
									{#if file.to === ".pdf"}
										<label class="text-muted">
											{m[
												"convert.pdf.compress_quality"
											]()}: {opts.quality}%
											<input
												class="w-full"
												type="range"
												min="30"
												max="100"
												bind:value={opts.quality}
											/>
										</label>
									{/if}
								{:else}
									{#if file.from === ".epub"}
										<label class="text-muted">
											{m["convert.pdf.page_size"]()}
											<select
												class="input w-full"
												bind:value={opts.pageSize}
											>
												<option value="">
													{m[
														"convert.pdf.page_size_default"
													]()}
												</option>
												<option value="a4">A4</option>
												<option value="letter">
													Letter
												</option>
												<option value="a5">A5</option>
											</select>
										</label>
									{/if}
									<label class="text-muted">
										{m["convert.pdf.render_scale"]()}
										<select
											class="input w-full"
											bind:value={opts.scale}
										>
											<option value={1}>72dpi</option>
											<option value={2}>144dpi</option>
											<option value={3}>216dpi</option>
										</select>
									</label>
								{/if}
							</div>
						{:else if currentConverter?.name === "webcodecs"}
							{@const vopts = getVideoOptions(file.id)}
							<div
								class="w-full flex flex-col gap-1.5 items-stretch text-sm"
							>
								<label class="text-muted">
									{m["convert.video.trim"]()}
									<div class="flex items-center gap-2">
										<input
											class="input w-full"
											type="number"
											min="0"
											max="60"
											value={vopts.start}
											onchange={(e) =>
												(vopts.start = Number(
													(
														e.currentTarget as HTMLInputElement
													).value,
												))}
										/>
										<span>–</span>
										<input
											class="input w-full"
											type="number"
											min="0"
											max="60"
											value={vopts.end}
											onchange={(e) =>
												(vopts.end = Number(
													(
														e.currentTarget as HTMLInputElement
													).value,
												))}
										/>
									</div>
								</label>
								<label class="text-muted">
									{m["convert.video.fps"]()}
									<input
										class="input w-full"
										type="number"
										min="1"
										max="30"
										value={vopts.fps}
										onchange={(e) =>
											(vopts.fps = Number(
												(
													e.currentTarget as HTMLInputElement
												).value,
											))}
									/>
								</label>
								<label class="text-muted">
									{m["convert.video.width"]()}
									<input
										class="input w-full"
										type="number"
										min="64"
										max="1920"
										step="16"
										value={vopts.width}
										onchange={(e) =>
											(vopts.width = Number(
												(
													e.currentTarget as HTMLInputElement
												).value,
											))}
									/>
								</label>
							</div>
						{/if}
						<div
							class="flex items-center justify-center gap-4 mt-auto"
						>
							<Tooltip
								text={m["convert.tooltips.convert_file"]()}
								position="bottom"
							>
								<button
									class="btn {$effects
										? ''
										: '!scale-100'} p-0 w-14 h-14 text-black {isAudio
										? 'bg-accent-purple'
										: isVideo
											? 'bg-accent-coral'
											: isDocument
												? 'bg-accent-amber'
												: 'bg-accent-blue'}"
									disabled={!files.ready}
									onclick={() =>
										currentConverter?.name === "pdf-lib" ||
										currentConverter?.name === "pdf-render"
											? convertPdf(file)
											: currentConverter?.name ===
												  "webcodecs"
												? convertVideo(file)
												: file.convert()}
								>
									<RotateCwIcon size="24" />
								</button>
							</Tooltip>
							<Tooltip
								text={m["convert.tooltips.download_file"]()}
								position="bottom"
							>
								<button
									class="btn {$effects
										? ''
										: '!scale-100'} p-0 w-14 h-14"
									onclick={file.download}
									disabled={!file.result}
								>
									<DownloadIcon size="24" />
								</button>
							</Tooltip>
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</Panel>
{/snippet}

<div
	class="flex flex-col justify-center items-center gap-8 -mt-4 px-4 md:p-0 max-md:pb-80"
>
	<div class="max-w-6xl w-full">
		<ConversionPanel />
	</div>

	<div
		class="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:p-0"
	>
		{#each files.files as file, i (file.id)}
			{@render fileItem(file, i)}
		{/each}
		{#if files.files.length === 0}
			<Uploader class="w-full h-full md:col-span-2 xl:col-span-3" />
		{:else}
			<Uploader class="w-full h-full" />
		{/if}
	</div>
</div>
