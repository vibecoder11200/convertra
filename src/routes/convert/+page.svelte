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
		Box,
		ChevronDownIcon,
		ChevronUpIcon,
		DownloadIcon,
		FileMusicIcon,
		FileQuestionIcon,
		FileVideo2,
		FilmIcon,
		GripVerticalIcon,
		ImageIcon,
		ImageOffIcon,
		RotateCwIcon,
		XIcon,
	} from "lucide-svelte";
	import { m } from "$lib/paraglide/messages";
	import { Settings } from "$lib/sections/settings/index.svelte";
	import { MAX_ARRAY_BUFFER_SIZE } from "$lib/store/index.svelte";
	import { GB } from "$lib/util/consts";
	import { ToastManager } from "$lib/util/toast.svelte";
	import { readShareStash } from "$lib/util/sw";
	import { untrack } from "svelte";
	import { browser } from "$app/environment";
	import UnlockModal from "$lib/components/functional/UnlockModal.svelte";

	let processedFileIds = $state(new Set<string>());

	// multi-image merge: which card is being dragged (html5 dnd handle)
	let dragId = $state<string | null>(null);

	// Per-file PDF options (split range, compress quality, render scale,
	// epub page size).
	const PDF_OPTION_DEFAULTS = {
		range: "",
		quality: 75,
		scale: 2,
		pageSize: "",
		password: "",
	};
	const pdfOptions = $state<
		Record<
			string,
			{
				range: string;
				quality: number;
				scale: number;
				pageSize: string;
				password: string;
			}
		>
	>({});

	// pure read: getters run inside template expressions ({@const ...}),
	// where Svelte forbids state writes (state_unsafe_mutation). Entries
	// are pre-created by the sync effect below instead.
	const getPdfOptions = (id: string) => pdfOptions[id] ?? PDF_OPTION_DEFAULTS;

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
	const VIDEO_OPTION_DEFAULTS = { start: 0, end: 60, fps: 12, width: 480 };
	const videoOptions = $state<
		Record<
			string,
			{ start: number; end: number; fps: number; width: number }
		>
	>({});

	const getVideoOptions = (id: string) =>
		videoOptions[id] ?? VIDEO_OPTION_DEFAULTS;

	// Per-file image ops (max long-edge px, target size KB). Session-scoped;
	// empty string = off. Applicable when the resolved path ends in an
	// imagemagick encode (direct magick, heic chains) or the heic converter.
	const IMAGE_OPTION_DEFAULTS = { maxEdge: "", targetSizeKB: "" };
	const imageOptions = $state<
		Record<string, { maxEdge: string; targetSizeKB: string }>
	>({});

	const getImageOptions = (id: string) =>
		imageOptions[id] ?? IMAGE_OPTION_DEFAULTS;

	// pre-create per-file option entries outside of template evaluation:
	// {#if}-branch bodies can run as deriveds, and a lazily-created entry
	// there throws state_unsafe_mutation, which kills the whole effect
	// flush and freezes every reactive update on the page
	$effect(() => {
		for (const file of files.files) {
			untrack(() => {
				if (!(file.id in pdfOptions))
					pdfOptions[file.id] = { ...PDF_OPTION_DEFAULTS };
				if (!(file.id in videoOptions))
					videoOptions[file.id] = { ...VIDEO_OPTION_DEFAULTS };
				if (!(file.id in imageOptions))
					imageOptions[file.id] = { ...IMAGE_OPTION_DEFAULTS };
			});
		}
		// prune entries for removed files — covers every removal path
		// (X button, remove-all) so typed encrypt passwords never outlive
		// their file
		const live = new Set(files.files.map((f) => f.id));
		for (const id of Object.keys(pdfOptions))
			if (!live.has(id)) delete pdfOptions[id];
		for (const id of Object.keys(videoOptions))
			if (!live.has(id)) delete videoOptions[id];
		for (const id of Object.keys(imageOptions))
			if (!live.has(id)) delete imageOptions[id];
	});

	const hasImageOps = (file: VertFile): boolean => {
		const name = file.findConverter()?.name ?? "";
		return (
			name === "imagemagick" ||
			name === "heic" ||
			name.endsWith("+imagemagick")
		);
	};

	const getImageOpsArgs = (file: VertFile) => {
		if (!hasImageOps(file)) return [];
		const opts = getImageOptions(file.id);
		const args: { maxEdge?: number; targetSizeBytes?: number } = {};
		const maxEdge = parseInt(opts.maxEdge, 10);
		if (!Number.isNaN(maxEdge) && maxEdge > 0) args.maxEdge = maxEdge;
		const targetKB = parseFloat(opts.targetSizeKB);
		if (!Number.isNaN(targetKB) && targetKB > 0) {
			args.targetSizeBytes = Math.round(targetKB * 1024);
		}
		return [args];
	};

	const showTargetSize = (file: VertFile): boolean =>
		[".jpg", ".jpeg", ".webp"].includes(file.to);

	// Convert all can't run convertPdf's branch dispatch, so pdf→pdf ops are
	// encoded here (mirrors convertPdf): password wins, then range, else
	// compress. .zip targets are split-all (no args needed).
	const getPdfConvertArgs = (file: VertFile) => {
		const opts = getPdfOptions(file.id);
		if (file.to === ".pdf" && opts.password)
			return [{ op: "encrypt", password: opts.password }];
		if (file.to === ".pdf" && opts.range)
			return [{ op: "split", range: opts.range }];
		if (file.to === ".pdf")
			return [{ op: "compress", quality: opts.quality }];
		return [];
	};

	// mirrors convertVideo: trim/fps/width reach the webcodecs card in
	// batch runs too
	const getVideoConvertArgs = (file: VertFile) => {
		const opts = getVideoOptions(file.id);
		return [
			{
				start: opts.start,
				end: opts.end,
				fps: opts.fps,
				width: opts.width,
			},
		];
	};

	// PWA intake: shared files arrive via the service worker's stash handoff
	// (?fromShare=<id>, see sw.js handleSharePost) and desktop "Open with"
	// via the File Handling API (launchQueue). Both funnel into files.add so
	// analytics/conversion behave exactly like a manual pick.
	if (browser) {
		const fromShare = new URLSearchParams(window.location.search).get(
			"fromShare",
		);
		if (fromShare) {
			// strip the param first so a reload never double-hydrates; the
			// stash is cleared as it is read
			window.history.replaceState({}, "", "/convert/");
			readShareStash(fromShare).then((shared) => {
				if (shared.length) files.add(shared, "share");
			});
		}

		if ("launchQueue" in window) {
			window.launchQueue!.setConsumer(async (launchParams) => {
				if (!launchParams.files?.length) return;
				const opened: File[] = [];
				for (const handle of launchParams.files) {
					try {
						opened.push(await handle.getFile());
					} catch {
						// handle permission revoked between launch and read
					}
				}
				if (opened.length) files.add(opened, "open-with");
			});
		}
	}

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
		// pdf-lib ops only exist for pdf SOURCES: compress (->.pdf), split-all
		// (->.zip), split-range (->.pdf with range). epub/cbz -> .pdf must fall
		// through to pdf-render below, which ignores {op:...} and would lose
		// scale/pageSize if it took this branch
		if (file.from === ".pdf" && (to === ".pdf" || to === ".zip")) {
			// a set password wins: encrypt instead of compress/split
			if (to === ".pdf" && opts.password) {
				await file.convert({ op: "encrypt", password: opts.password });
				// one-shot secret: drop it once it's been applied
				opts.password = "";
				return;
			}
			const isCompress = to === ".pdf" && opts.range === "";
			await file.convert(
				isCompress
					? { op: "compress", quality: opts.quality }
					: { op: "split", range: opts.range || "all" },
			);
			return;
		}
		// pdf-render: pdf/epub/cbz -> png/jpeg/webp/pdf/cbz (epub inputs also
		// take a page size)
		await file.convert({
			scale: opts.scale,
			range: opts.range || "all",
			pageSize: opts.pageSize,
		});
		// a native-text extraction that came back (nearly) empty on a pdf
		// source almost always means a scan: point at the scanned toggle
		if (
			file.from === ".pdf" &&
			!file.forceOcr &&
			(to === ".txt" || to === ".md") &&
			file.result
		) {
			const text = await file.result.file.text();
			if (text.trim().length < 20) {
				ToastManager.add({
					type: "warning",
					message: m["convert.pdf.scan_hint"](),
				});
			}
		}
	};

	$effect(() => {
		if (!Settings.instance.settings || files.files.length === 0) return;

		files.files.forEach((file) => {
			const settings = Settings.instance.settings;
			if (processedFileIds.has(file.id)) return;

			const converter = file.findConverter();
			if (!converter) return;
			// warm the RESOLVED path (direct converter or chain): chains reach
			// engines beyond file.converters (e.g. heic->jpg resolves through
			// magick), and an unwarmed step leaves the chain stuck "not-ready"
			converter.warm?.();

			let category: string | undefined;
			const isImage = converter.name === "imagemagick";
			const isAudio = converter.name === "ffmpeg";
			const isVideo = converter.name === "vertd";
			const isDocument = converter.name === "pandoc";
			const is3d = converter.name === "three";

			if (isImage) category = "image";
			else if (isAudio) category = "audio";
			else if (isVideo) category = "video";
			else if (isDocument) category = "doc";
			else if (is3d) category = "3d";
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
				else if (category === "3d") defaultFormat = df.threeD;

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

	const handleSelect = (file: VertFile) => {
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

{#snippet errorCard(message: string)}
	<div class="h-full flex flex-col text-center justify-center text-failure">
		<p class="font-body font-bold">{m["convert.errors.cant_convert"]()}</p>
		<p class="font-normal">{message}</p>
	</div>
{/snippet}

{#snippet fileItem(file: VertFile, index: number)}
	{@const currentConverter = file.findConverter()}
	{@const isImage = currentConverter?.name === "imagemagick"}
	{@const isAudio = currentConverter?.name === "ffmpeg"}
	{@const isVideo = currentConverter?.name === "vertd"}
	{@const isDocument = currentConverter?.name === "pandoc"}
	{@const is3d = currentConverter?.name === "three"}
	{@const kindLabel = isAudio
		? m["convert.errors.audio"]()
		: isVideo
			? "Video"
			: isDocument
				? m["convert.errors.doc"]()
				: m["convert.errors.image"]()}
	<div
		class="relative min-w-0"
		role="listitem"
		ondragover={(e) => {
			if (dragId && dragId !== file.id) e.preventDefault();
		}}
		ondrop={(e) => {
			e.preventDefault();
			if (dragId && dragId !== file.id) files.move(dragId, index);
			dragId = null;
		}}
	>
		<Panel
			class="p-5 flex flex-col min-w-0 gap-4 relative min-h-[16rem] h-full {dragId ===
			file.id
				? 'opacity-50'
				: ''}"
		>
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
				{:else if is3d}
					<Tooltip
						text={m["convert.tooltips.model_file"]()}
						position="bottom"
					>
						<Box size="24" class="flex-shrink-0" />
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
				{#if files.canMerge}
					<span
						draggable="true"
						role="button"
						tabindex="0"
						aria-label={m["convert.tooltips.drag_handle"]()}
						class="flex-shrink-0 w-6 h-8 flex items-center justify-center cursor-grab active:cursor-grabbing text-muted hover:text-foreground"
						ondragstart={(e) => {
							dragId = file.id;
							e.dataTransfer?.setData("text/plain", file.id);
						}}
						ondragend={() => (dragId = null)}
						onkeydown={(e) => {
							if (e.key === "ArrowUp") {
								e.preventDefault();
								files.move(file.id, index - 1);
							} else if (e.key === "ArrowDown") {
								e.preventDefault();
								files.move(file.id, index + 1);
							}
						}}
					>
						<GripVerticalIcon size="20" />
					</span>
					<div class="flex-shrink-0 flex flex-col h-8 justify-center">
						<button
							class="h-4 flex items-center justify-center rounded hover:bg-panel-alt disabled:opacity-30"
							aria-label={m["convert.tooltips.move_up"]()}
							disabled={index === 0}
							onclick={() => files.move(file.id, index - 1)}
						>
							<ChevronUpIcon size="16" class="text-muted" />
						</button>
						<button
							class="h-4 flex items-center justify-center rounded hover:bg-panel-alt disabled:opacity-30"
							aria-label={m["convert.tooltips.move_down"]()}
							disabled={index === files.files.length - 1}
							onclick={() => files.move(file.id, index + 1)}
						>
							<ChevronDownIcon size="16" class="text-muted" />
						</button>
					</div>
				{/if}
				<button
					class="flex-shrink-0 w-8 rounded-full hover:bg-panel-alt h-full flex items-center justify-center"
					onclick={async () => {
						if (files.mergedProcessing) {
							await files.cancelMerged();
						} else {
							await file.cancel();
						}
						files.files = files.files.filter(
							(f) => f.id !== file.id,
						);
						// drop any session-decrypted bytes with the file
						files.clearDecrypted(file.id);
						// a merged result spanning the removed file is stale
						files.mergedResult = null;
					}}
				>
					<XIcon size="24" class="text-muted" />
				</button>
			</div>
			{#if !currentConverter}
				{#if file.name.startsWith("vertd")}
					{@render errorCard(m["convert.errors.vertd_server"]())}
				{:else}
					{@render errorCard(
						m["convert.errors.unsupported_format"](),
					)}
				{/if}
			{:else}
				{@const formatInfo = currentConverter.supportedFormats.find(
					(f) => f.name === file.from,
				)}
				{@const isLarge = file.isLarge()}
				{#if formatInfo && !formatInfo.fromSupported}
					{@render errorCard(
						m["convert.errors.format_output_only"](),
					)}
				{:else if isLarge && !file.supportsStreaming()}
					{@render errorCard(
						m["workers.errors.file_too_large"]({
							limit: (MAX_ARRAY_BUFFER_SIZE / GB).toFixed(2),
						}),
					)}
				{:else if currentConverter.status === "downloading"}
					{@render errorCard(
						m["convert.errors.worker_downloading"]({
							type: kindLabel,
						}),
					)}
				{:else if currentConverter.status === "error"}
					{@render errorCard(
						m["convert.errors.worker_error"]({ type: kindLabel }),
					)}
				{:else if currentConverter.status === "not-ready"}
					{@render errorCard(
						m["convert.errors.worker_timeout"]({ type: kindLabel }),
					)}
				{:else if isVideo && !$vertdLoaded && !isAudio && !isImage && !isDocument}
					{@render errorCard(m["convert.errors.vertd_not_found"]())}
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
								onselect={() => handleSelect(file)}
								{file}
							/>
							{#if file.from === ".pdf"}
								<label
									class="flex items-center justify-center gap-2 text-xs text-muted cursor-pointer select-none"
								>
									<input
										type="checkbox"
										class="accent-accent w-3.5 h-3.5"
										bind:checked={file.forceOcr}
										onchange={() => (file.result = null)}
									/>
									{m["convert.pdf.scanned_toggle"]()}
								</label>
							{/if}
							{#if file.from === ".pdf" && PDF_REFLOW_TARGETS.includes(file.to)}
								<p
									class="text-xs text-muted text-center w-full"
								>
									{m["convert.pdf.reflow_note"]()}
								</p>
							{/if}
							{#if currentConverter?.name === "pandoc+pdf-render"}
								<p
									class="text-xs text-muted text-center w-full"
								>
									{m["convert.pdf.raster_note"]()}
								</p>
							{/if}
							{#if file.from === ".pdf" && file.to === ".md"}
								<p
									class="text-xs text-muted text-center w-full"
								>
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
											<label class="text-muted">
												{m[
													"convert.pdf.encrypt_password"
												]()}
												<input
													class="w-full input"
													type="password"
													autocomplete="new-password"
													placeholder={m[
														"convert.pdf.encrypt_no_password"
													]()}
													bind:value={opts.password}
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
													<option value="a4"
														>A4</option
													>
													<option value="letter">
														Letter
													</option>
													<option value="a5"
														>A5</option
													>
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
												<option value={2}>144dpi</option
												>
												<option value={3}>216dpi</option
												>
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
							{:else if hasImageOps(file)}
								{@const iopts = getImageOptions(file.id)}
								<div
									class="w-full flex flex-col gap-1.5 items-stretch text-sm"
								>
									<label class="text-muted">
										{m["convert.image_ops.max_edge"]()}
										<input
											class="w-full input"
											type="number"
											min="16"
											placeholder={m[
												"convert.image_ops.no_limit"
											]()}
											value={iopts.maxEdge}
											onchange={(e) =>
												(iopts.maxEdge = (
													e.currentTarget as HTMLInputElement
												).value)}
										/>
									</label>
									{#if showTargetSize(file)}
										<label class="text-muted">
											{m[
												"convert.image_ops.target_size"
											]()}
											<input
												class="w-full input"
												type="number"
												min="1"
												step="0.1"
												placeholder={m[
													"convert.image_ops.no_target"
												]()}
												value={iopts.targetSizeKB}
												onchange={(e) =>
													(iopts.targetSizeKB = (
														e.currentTarget as HTMLInputElement
													).value)}
											/>
										</label>
										<p class="text-xs text-muted">
											{m[
												"convert.image_ops.target_hint"
											]()}
										</p>
									{/if}
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
											file.from === ".pdf"
												? convertPdf(file)
												: currentConverter?.name ===
													  "webcodecs"
													? convertVideo(file)
													: file.convert(
															...getImageOpsArgs(
																file,
															),
														)}
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
	</div>
{/snippet}

<div
	class="flex flex-col justify-center items-center gap-8 -mt-4 px-4 md:p-0 max-md:pb-80"
>
	<div class="max-w-6xl w-full">
		<ConversionPanel
			getConvertArgs={(f) =>
				f.from === ".pdf"
					? getPdfConvertArgs(f)
					: f.findConverter()?.name === "webcodecs"
						? getVideoConvertArgs(f)
						: getImageOpsArgs(f)}
			onBatchDone={() => {
				// one-shot secrets: any applied encrypt password doesn't
				// outlive the batch run
				for (const opts of Object.values(pdfOptions))
					opts.password = "";
			}}
		/>
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

<UnlockModal />
