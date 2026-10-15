import { browser } from "$app/environment";
import { byNative, converters } from "$lib/converters";
import { MERGEABLE_IMAGE_EXTS } from "$lib/util/consts";
import { error, log } from "$lib/util/logger";
import { VertFile } from "$lib/types";
import { parseBlob, selectCover } from "music-metadata";
import { writable } from "svelte/store";
import { addDialog } from "./DialogProvider";
import PQueue from "p-queue";
import { getLocale, setLocale } from "$lib/paraglide/runtime";
import { m } from "$lib/paraglide/messages";
import sanitizeHtml from "sanitize-html";
import { ToastManager } from "$lib/util/toast.svelte";
import { GB } from "$lib/util/consts";
import { trackEvent, type AnalyticsVia } from "$lib/analytics/index";
import MuPDFWorker from "$lib/workers/mupdf?worker&url";

class Files {
	public files = $state<VertFile[]>([]);

	// multi-image -> single-pdf merge (session-scoped, not persisted)
	public mergePdf = $state(false);

	// result of a merged run: N image inputs produced ONE pdf
	public mergedResult = $state<VertFile | null>(null);
	public mergedProcessing = $state(false);

	private mergeCancel: (() => void) | null = null;

	// --- encrypted-PDF session unlock --------------------------------------
	// decrypted bytes per VertFile.id; memory-only, cleared on file removal.
	// Conversions read this through VertFile.convert's substitution so every
	// consumer (pdf-lib ops, mupdf, pdf-render, chains) sees plain bytes.
	private decryptedCache = new Map<string, ArrayBuffer>();

	// set while a locked PDF waits for the user's password (the modal on the
	// convert/organize pages binds to it); `data` carries the source bytes
	public pendingUnlock = $state<{
		name: string;
		wrongPassword: boolean;
		data: ArrayBuffer;
		id: string;
	} | null>(null);

	private unlockWaiter: { resolve: (ok: boolean) => void } | null = null;

	// decrypted bytes from the most recent modal unlock (for id-less callers
	// like the organizer's local file)
	private lastUnlocked: ArrayBuffer | null = null;

	public getDecryptedBytes(id: string): ArrayBuffer | undefined {
		return this.decryptedCache.get(id);
	}

	public clearDecrypted(id: string) {
		this.decryptedCache.delete(id);
	}

	/** Run the mupdf decrypt job: undefined password = probe (returns null
	 * when no password is needed), a password = decrypt or typed error. */
	private runDecryptWorker(
		data: ArrayBuffer,
		password: string | undefined,
	): Promise<ArrayBuffer | null> {
		return new Promise((resolve, reject) => {
			const worker = new Worker(MuPDFWorker, { type: "module" });
			worker.onmessage = (e: MessageEvent) => {
				worker.terminate();
				if (e.data.type === "error") {
					reject(new Error(e.data.error));
					return;
				}
				resolve((e.data.output as ArrayBuffer | null) ?? null);
			};
			worker.onerror = (e) => {
				worker.terminate();
				reject(new Error(e.message));
			};
			worker.postMessage({
				type: "decrypt",
				id: "decrypt",
				data: new Uint8Array(data),
				password,
			});
		});
	}

	/** Probe a newly added PDF: silently cache decrypted bytes for
	 * already-unlocked files, open the password modal for locked ones. */
	public async probePdfEncryption(file: File, id: string): Promise<void> {
		if (!browser || file.size > MAX_ARRAY_BUFFER_SIZE) return;
		const data = await file.arrayBuffer();
		try {
			const out = await this.runDecryptWorker(data, undefined);
			if (out) this.decryptedCache.set(id, out);
		} catch (err) {
			if (!String(err).includes("PASSWORD_REQUIRED")) {
				error(["files"], `pdf probe failed: ${err}`);
				return;
			}
			await this.awaitUnlock(file.name, id, data);
		}
	}

	/** Open the password modal and wait; caches decrypted bytes on success
	 * (id may be "" for organizer-local files — caller uses the return).
	 * Concurrent locked-file adds are serialized: one modal at a time, each
	 * waiter gets its own turn (a second pendingUnlock would otherwise
	 * orphan the first waiter forever). */
	public awaitUnlock(
		name: string,
		id: string,
		data: ArrayBuffer,
	): Promise<ArrayBuffer | null> {
		const run = this.unlockChain.then(() =>
			this._awaitUnlock(name, id, data),
		);
		this.unlockChain = run.catch(() => {});
		return run;
	}

	private unlockChain: Promise<unknown> = Promise.resolve();

	private async _awaitUnlock(
		name: string,
		id: string,
		data: ArrayBuffer,
	): Promise<ArrayBuffer | null> {
		this.pendingUnlock = { name, wrongPassword: false, data, id };
		const ok = await new Promise<boolean>((resolve) => {
			this.unlockWaiter = { resolve };
		});
		if (!ok) return null;
		if (id) return this.decryptedCache.get(id) ?? null;
		// organizer-local handoff: consume once so decrypted bytes for
		// files outside the store never linger past their only reader
		const dec = this.lastUnlocked;
		this.lastUnlocked = null;
		return dec;
	}

	/** Modal submit: try to decrypt; flip wrongPassword on failure. */
	public async submitUnlockPassword(password: string) {
		const pu = this.pendingUnlock;
		if (!pu) return;
		try {
			const dec = await this.runDecryptWorker(pu.data, password);
			if (pu.id) this.decryptedCache.set(pu.id, dec as ArrayBuffer);
			this.lastUnlocked = dec;
			this.closeUnlock(true);
		} catch (err) {
			if (String(err).includes("WRONG_PASSWORD")) {
				this.pendingUnlock = { ...pu, wrongPassword: true };
				return;
			}
			this.closeUnlock(false);
			ToastManager.add({
				type: "error",
				message: m["workers.errors.general"]({
					file: pu.name,
					message: String(err),
				}),
			});
		}
	}

	public cancelUnlock() {
		this.closeUnlock(false);
	}

	/** Dismiss the modal and settle the caller waiting in awaitUnlock. */
	private closeUnlock(ok: boolean) {
		this.pendingUnlock = null;
		this.unlockWaiter?.resolve(ok);
		this.unlockWaiter = null;
	}

	/** Merge is offerable iff every listed file is an image and every
	 * target is .pdf (the pdf-lib assembler is the only merge backend). */
	public canMerge = $derived(
		this.files.length > 1 &&
			this.files.every((f) => MERGEABLE_IMAGE_EXTS.includes(f.from)) &&
			this.files.every((f) => f.to === ".pdf"),
	);

	public requiredConverters = $derived(
		Array.from(new Set(files.files.map((f) => f.converters).flat())),
	);

	public ready = $derived(
		this.files.length === 0
			? false
			: this.requiredConverters.every((f) => f?.status === "ready") &&
					this.files.every((f) => !f.processing),
	);
	public results = $derived(
		this.files.length === 0
			? false
			: this.mergePdf && this.canMerge
				? !!this.mergedResult
				: this.files.every((f) => f.result),
	);

	/** Reorder the list: move the file with `id` to `index`. The visible
	 * order is the merge page order — no second hidden ordering exists. */
	public move(id: string, index: number) {
		const from = this.files.findIndex((f) => f.id === id);
		if (from === -1) return;
		const clamped = Math.max(0, Math.min(this.files.length - 1, index));
		if (clamped === from) return;
		const next = [...this.files];
		const [item] = next.splice(from, 1);
		next.splice(clamped, 0, item);
		this.files = next;
	}

	private thumbnailQueue = new PQueue({
		concurrency: browser ? navigator.hardwareConcurrency || 4 : 4,
	});

	private _addThumbnail = async (file: VertFile) => {
		this.thumbnailQueue.add(async () => {
			// archives and zip-container formats (epub/cbz/xlsx/ods) have no
			// meaningful thumbnail - skip instead of failing to decode the
			// zip blob as an image (noisy console error)
			if (
				file.isZip() ||
				[".cbz", ".epub", ".xlsx", ".ods", ".xls"].includes(file.from)
			)
				return;

			const isAudio = converters
				.find((c) => c.name === "ffmpeg")
				?.supportedFormats.filter((f) => f.isNative)
				.map((f) => f.name)
				?.includes(file.from.toLowerCase());
			const isVideo = converters
				.find((c) => c.name === "vertd")
				?.supportedFormats.filter((f) => f.isNative)
				.map((f) => f.name)
				?.includes(file.from.toLowerCase());

			try {
				if (isAudio) {
					// try to get the thumbnail from the audio via music-metadata
					const { common } = await parseBlob(file.file, {
						skipPostHeaders: true,
					});
					const cover = selectCover(common.picture);
					if (cover) {
						const arrayBuffer =
							cover.data.buffer instanceof ArrayBuffer
								? cover.data.buffer
								: new Uint8Array(cover.data).buffer;
						const blob = new Blob([new Uint8Array(arrayBuffer)], {
							type: cover.format,
						});
						file.blobUrl = URL.createObjectURL(blob);
					}
				} else if (isVideo) {
					// video
					file.blobUrl = await this._generateThumbnailFromMedia(
						file.file,
						true,
					);
				} else {
					// image
					file.blobUrl = await this._generateThumbnailFromMedia(
						file.file,
						false,
					);
				}
			} catch {
				error(
					["files"],
					`thumbnail generation failed for ${file.name}`,
				);
			}
		});
	};

	private async _generateThumbnailFromMedia(
		file: File,
		isVideo: boolean,
	): Promise<string | undefined> {
		const maxSize = 180;
		const mediaElement = isVideo
			? document.createElement("video")
			: new Image();
		const mediaUrl = URL.createObjectURL(file);
		mediaElement.src = mediaUrl;

		try {
			await new Promise((resolve, reject) => {
				if (isVideo) {
					const video = mediaElement as HTMLVideoElement;
					// seek to 10% of video time or 2 seconds in
					video.onloadeddata = () => {
						const seekTime = Math.min(video.duration * 0.1, 2);
						video.currentTime = seekTime;
					};
					video.onseeked = resolve;
					video.onerror = reject;
				} else {
					(mediaElement as HTMLImageElement).onload = resolve;
					(mediaElement as HTMLImageElement).onerror = reject;
				}
			});

			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d");
			if (!ctx) return undefined;

			const width = isVideo
				? (mediaElement as HTMLVideoElement).videoWidth
				: (mediaElement as HTMLImageElement).width;
			const height = isVideo
				? (mediaElement as HTMLVideoElement).videoHeight
				: (mediaElement as HTMLImageElement).height;

			const scale = Math.max(maxSize / width, maxSize / height);
			canvas.width = width * scale;
			canvas.height = height * scale;
			ctx.drawImage(mediaElement, 0, 0, canvas.width, canvas.height);

			// check if completely transparent
			const imageData = ctx.getImageData(
				0,
				0,
				canvas.width,
				canvas.height,
			);
			const isTransparent = Array.from(imageData.data).every(
				(value, index) => {
					return (index + 1) % 4 !== 0 || value === 0;
				},
			);
			if (isTransparent) {
				canvas.remove();
				return undefined;
			}

			const url = canvas.toDataURL();
			canvas.remove();
			return url;
		} finally {
			URL.revokeObjectURL(mediaUrl);
			mediaElement.removeAttribute("src");
			if (isVideo) (mediaElement as HTMLVideoElement).load();
		}
	}

	/** Returns the number of VertFiles actually added (zip-as-one: 1;
	 * extracted archives: the summed results of `_add` — never entries.length,
	 * since entries can be dropped). Throws on processing errors. */
	private async _handleZipFile(
		file: File,
		via: AnalyticsVia,
	): Promise<number> {
		try {
			log(["files"], `extracting zip file: ${file.name}`);
			ToastManager.add({
				type: "info",
				message: m["convert.archive_file.extracting"]({
					filename: file.name,
				}),
			});

			const { extractZip } = await import("$lib/util/zip");
			const entries = await extractZip(file);

			const totalEntries = entries.length;
			log(["files"], `extracted ${totalEntries} files from zip`);

			// check if all files in zip use the same converter and are compatible
			const convertersUsed = new Set<string>();
			let incompatibleFiles = false;

			for (const { filename } of entries) {
				const format = "." + filename.split(".").pop()?.toLowerCase();
				if (!format || format === ".zip") {
					incompatibleFiles = true;
					continue;
				}

				const converter = converters
					.sort(byNative(format))
					.find((c) => c.formatStrings().includes(format));

				if (converter) convertersUsed.add(converter.name);
				else incompatibleFiles = true;
			}

			const converterCount = convertersUsed.size;
			const canConvertAsOne = converterCount === 1 && !incompatibleFiles;

			log(
				["files"],
				`extracted ${entries.length} files from zip (converters: ${converterCount}, compatible: ${canConvertAsOne})`,
			);

			if (canConvertAsOne) {
				// all files use same converter - add zip as a single VertFile file
				const vf = new VertFile(file, ".zip");
				vf.converters = converters.filter(
					(c) => c.name === Array.from(convertersUsed)[0],
				);

				const converterName = vf.converters[0].name;
				const type =
					converterName === "imagemagick"
						? "image"
						: converterName === "ffmpeg"
							? "audio"
							: converterName === "pandoc"
								? "doc"
								: "video";

				this.files.push(vf);
				this._addThumbnail(vf);

				// warm the converter engine like the regular file path in _add(),
				// otherwise the zip can never be converted (stuck on "not ready")
				vf.converters[0].warm?.();

				ToastManager.add({
					type: "success",
					message: m["convert.archive_file.detected"]({
						type: m[`convert.archive_file.${type}`](),
						filename: file.name,
					}),
				});
				return 1;
			} else {
				// mixed converters/incompatible files - extract all individually
				let added = 0;
				for (const { filename, data } of entries) {
					added += await this._add(
						new File([new Uint8Array(data)], filename, {
							type: "application/octet-stream",
						}),
						via,
					);
				}

				ToastManager.add({
					type: "success",
					message: m["convert.archive_file.extracted"]({
						filename: file.name,
						extract_count: entries.length,
						ignore_count: 0,
					}),
				});
				return added;
			}
		} catch (e) {
			error(["files"], `error processing zip file: ${e}`);
			throw e;
		}
	}

	private _warningShown = false;
	/** Adds a file; returns an explicit count of VertFiles added on EVERY
	 * exit (0 on drop paths: extensionless entry, no output format, errors). */
	private async _add(
		file: VertFile | File,
		via: AnalyticsVia,
	): Promise<number> {
		if (file instanceof VertFile) {
			this.files.push(file);
			this._addThumbnail(file);
			return 1;
		} else {
			// if zip, extract and add contents
			const isZip =
				file.name.toLowerCase().endsWith(".zip") ||
				file.type === "application/zip" ||
				file.type === "application/x-zip-compressed";

			if (isZip) {
				try {
					return await this._handleZipFile(file, via);
				} catch (err) {
					error(["files"], `error extracting zip file: ${err}`);
					ToastManager.add({
						type: "error",
						message: m["convert.archive_file.extract_error"]({
							filename: file.name,
							error: String(err),
						}),
					});
					return 0;
				}
			}

			// regular files
			const format = "." + file.name.split(".").pop()?.toLowerCase();
			if (!format) {
				log(["files"], `no extension found for ${file.name}`);
				return 0;
			}
			// heic/heif: verify the ftyp brand before accepting — a renamed or
			// corrupt file would otherwise fail deep inside the decoder with a
			// generic error
			if (format === ".heic" || format === ".heif") {
				const { sniffIsHeif } = await import("$lib/util/sniff");
				if (!(await sniffIsHeif(file))) {
					log(["files"], `heic magic-byte mismatch for ${file.name}`);
					ToastManager.add({
						type: "error",
						message: m["convert.errors.heic_invalid"]({
							filename: file.name,
						}),
					});
					return 0;
				}
			}
			// prefer converters that can actually read the format (some list
			// a name as output-only, e.g. mupdf's .md); sort a copy so the
			// shared registry order is never mutated
			const readable = converters.filter((c) =>
				c.supportedFormats.find(
					(f) => f.name === format && f.fromSupported,
				),
			);
			const converter =
				readable.sort(byNative(format)).at(0) ??
				converters
					.slice()
					.sort(byNative(format))
					.find((c) => c.formatStrings().includes(format));
			if (!converter) {
				log(["files"], `no converter found for ${file.name}`);
				this.files.push(new VertFile(file, format));
				return 1;
			}
			const to = converter.supportedFormats.find(
				(f) => f.name !== format && f.toSupported,
			)?.name;
			if (!to) {
				log(["files"], `no output format found for ${file.name}`);
				return 0;
			}
			const vf = new VertFile(file, to);
			this.files.push(vf);
			this._addThumbnail(vf);

			// locked PDFs open the password modal (session decrypt cache);
			// fire-and-forget so adds stay fast
			if (format === ".pdf") {
				void this.probePdfEncryption(file, vf.id);
			}

			// Warm the converter engine (eager WASM download moved here, off
			// page-load, so the home page no longer fetches every engine).
			converter.warm?.();

			const convName = converter.name;
			if (file.size > MAX_ARRAY_BUFFER_SIZE && convName === "vertd") {
				ToastManager.add({
					type: "warning",
					message: m["convert.large_file_warning"]({
						limit: (MAX_ARRAY_BUFFER_SIZE / GB).toFixed(2),
					}),
					durations: {
						stay: 10000,
					},
				});
			}

			const isVideo = convName === "vertd";
			const acceptedExternalWarning =
				localStorage.getItem("acceptedExternalWarning") === "true";
			if (isVideo && !acceptedExternalWarning && !this._warningShown) {
				this._warningShown = true;
				const title = m["convert.external_warning.title"]();
				const message = m["convert.external_warning.text"]();
				const buttons = [
					{
						text: m["convert.external_warning.no"](),
						action: () => {
							this.files = [
								...this.files.filter(
									(f) =>
										!f.converters
											.map((c) => c.name)
											.includes("vertd"),
								),
							];
							this._warningShown = false;
						},
					},
					{
						text: m["convert.external_warning.yes"](),
						action: () => {
							localStorage.setItem(
								"acceptedExternalWarning",
								"true",
							);
							this._warningShown = false;
						},
					},
				];
				addDialog(title, message, buttons, "warning");
			}
			return 1;
		}
	}

	public add(
		file: VertFile | null | undefined,
		via?: AnalyticsVia,
	): Promise<void>;
	public add(
		file: File | null | undefined,
		via?: AnalyticsVia,
	): Promise<void>;
	public add(
		file: File[] | null | undefined,
		via?: AnalyticsVia,
	): Promise<void>;
	public add(
		file: VertFile[] | null | undefined,
		via?: AnalyticsVia,
	): Promise<void>;
	public add(
		file: FileList | null | undefined,
		via?: AnalyticsVia,
	): Promise<void>;
	public async add(
		file:
			| VertFile
			| File
			| VertFile[]
			| File[]
			| FileList
			| null
			| undefined,
		via: AnalyticsVia = "picker",
	) {
		if (!file) return; // null/undefined tolerance: callers pass e.dataTransfer?.files and fileInput.files
		const items: (VertFile | File)[] = Array.isArray(file)
			? [...file]
			: file instanceof FileList
				? Array.from(file)
				: [file];
		// single chokepoint: exactly one file_select per add() call, with the
		// true number of VertFiles added (zips: 1 zip-as-one, N extracted)
		const results = await Promise.all(items.map((f) => this._add(f, via)));
		const count = results.reduce((sum, n) => sum + n, 0);
		if (count > 0) trackEvent("file_select", { count, via });
	}

	public async convertAll(
		// per-file extra convert args (e.g. image-ops options resolved by the
		// convert page); omitted for files it doesn't apply to
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		perFileArgs?: (f: VertFile) => any[],
	) {
		if (this.mergePdf && this.canMerge) {
			await this.convertMerged();
			return;
		}
		this.mergedResult = null;
		const promiseFns = this.files.map(
			 
			(f) => () => f.convert(...(perFileArgs?.(f) ?? [])),
		);
		const coreCount = navigator.hardwareConcurrency || 4;
		const queue = new PQueue({ concurrency: coreCount });
		await Promise.all(promiseFns.map((fn) => queue.add(fn)));
	}

	/** Merge every listed image into ONE multi-page pdf, in visible list
	 * order. HEIC/HEIF entries are pre-decoded to png (the pdf-lib worker's
	 * canvas path cannot decode heic outside Safari); everything else is
	 * handed to the worker as-is (jpg/png embed losslessly). */
	private async convertMerged() {
		const { PdfLibConverter } = await import(
			"$lib/converters/pdf-lib.svelte"
		);
		const pdfLib =
			converters.find((c) => c instanceof PdfLibConverter) ??
			new PdfLibConverter();

		this.mergedResult = null;
		this.mergedProcessing = true;
		for (const f of this.files) {
			f.progress = 0;
			f.result = null;
			f.processing = true;
		}

		try {
			// start BEFORE the decode loop so failed merges keep a proper
			// start → fail funnel (complete/fail are tracked below)
			trackEvent("convert_start", {
				from_format: "merge-images",
				pair: "merge-images-pdf",
				to_format: ".pdf",
				converter: "pdf-lib",
				size_bytes: this.files.reduce((s, f) => s + f.file.size, 0),
			});
			const images: { name: string; data: Uint8Array }[] = [];
			for (const [i, f] of this.files.entries()) {
				if (f.cancelled) throw new Error("Conversion cancelled");
				let entry: { name: string; data: Uint8Array };
				if (f.from === ".heic" || f.from === ".heif") {
					// pre-decode to lossless png via the phase-1 heic decoder
					const heic = converters.find((c) => c.name === "heic");
					if (!heic) throw new Error("HEIC decoder unavailable");
					const decoded = await heic.convert(f, ".png");
					entry = {
						name: f.name.replace(/\.[^/.]+$/, ".png"),
						data: new Uint8Array(await decoded.file.arrayBuffer()),
					};
				} else {
					entry = {
						name: f.name,
						data: new Uint8Array(await f.file.arrayBuffer()),
					};
				}
				images.push(entry);
				// decode phase = first half of the bar for each file
				const share = ((i + 1) / this.files.length) * 50;
				for (const f2 of this.files) f2.progress = Math.round(share);
			}

			const { promise, cancelMerge } = pdfLib.mergeImages(
				images,
				(index, total) => {
					// assemble phase: second half of each file's bar
					const share =
						50 + ((index + 1) / total) * 50;
					for (const f of this.files) f.progress = Math.round(share);
				},
			);
			this.mergeCancel = cancelMerge;
			const bytes = await promise;

			const firstName = this.files[0].name;
			const outName = `${firstName.replace(/\.[^/.]+$/, "")}.pdf`;
			const result = new VertFile(
				new File([bytes as unknown as BlobPart], outName, {
					type: "application/pdf",
				}),
				".pdf",
			);
			this.mergedResult = result;
			for (const f of this.files) {
				f.progress = 100;
				f.result = result;
			}
			trackEvent("convert_complete", {
				from_format: "merge-images",
				pair: "merge-images-pdf",
				to_format: ".pdf",
				converter: "pdf-lib",
				size_bytes: bytes.length,
			});
		} catch (err) {
			for (const f of this.files) {
				f.result = null;
				f.cancelled = String(err).includes("cancelled");
			}
			if (!String(err).includes("cancelled")) {
				ToastManager.add({
					type: "error",
					message: m["convert.merge.failed"]({
						message: String(err),
					}),
				});
				trackEvent("convert_fail", {
					from_format: "merge-images",
					pair: "merge-images-pdf",
					to_format: ".pdf",
					converter: "pdf-lib",
					reason: "error",
				});
			} else {
				trackEvent("convert_fail", {
					from_format: "merge-images",
					pair: "merge-images-pdf",
					to_format: ".pdf",
					converter: "pdf-lib",
					reason: "cancelled",
				});
			}
		} finally {
			this.mergedProcessing = false;
			this.mergeCancel = null;
			for (const f of this.files) f.processing = false;
		}
	}

	/** Cancel the in-flight merged run (any card's X during a merge). */
	public async cancelMerged() {
		if (!this.mergedProcessing) return;
		this.mergeCancel?.();
		// settled synchronously by convertMerged's catch; give it a microtask
		await Promise.resolve();
		for (const f of this.files) {
			f.processing = false;
			f.result = null;
		}
		this.mergedProcessing = false;
	}

	public async downloadAll() {
		if (files.files.length === 0) return;

		// merged run: one pdf, downloaded directly (no zip wrapper)
		if (this.mergePdf && this.canMerge && this.mergedResult) {
			const outTo = ".pdf";
			const settings = JSON.parse(
				localStorage.getItem("settings") ?? "{}",
			);
			const filenameFormat = settings.filenameFormat || "Convertra_%name%";
			const baseName = files.files[0].name.replace(/\.[^/.]+$/, "");
			const blob = URL.createObjectURL(
				new Blob([await this.mergedResult.file.arrayBuffer()], {
					type: "application/octet-stream",
				}),
			);
			const a = document.createElement("a");
			a.href = blob;
			a.download = `${filenameFormat.replace(/%name%/g, baseName).replace(/%extension%/g, "").replace(/%date%/g, new Date().toISOString())}${outTo}`;
			a.target = "_blank";
			a.style.display = "none";
			a.click();
			URL.revokeObjectURL(blob);
			a.remove();
			trackEvent("download_click", {
				from_format: "merge-images",
				to_format: outTo,
			});
			return;
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dlFiles: any[] = [];
		for (let i = 0; i < files.files.length; i++) {
			const file = files.files[i];
			const result = file.result;

			if (!result) {
				error(["files"], "No result found");
				continue;
			}

			let to = result.to;
			if (!to.startsWith(".")) to = `.${to}`;

			dlFiles.push({
				name: file.file.name.replace(/\.[^/.]+$/, "") + to,
				lastModified: Date.now(),
				input: await result.file.arrayBuffer(),
			});
		}
		const { downloadZip } = await import("client-zip");
		const blob = await downloadZip(dlFiles, "converted.zip").blob();
		const url = URL.createObjectURL(blob);

		const settings = JSON.parse(localStorage.getItem("settings") ?? "{}");
		const filenameFormat = settings.filenameFormat || "Convertra_%name%";

		const format = (name: string) => {
			const date = new Date().toISOString();
			return name
				.replace(/%date%/g, date)
				.replace(/%name%/g, "Multi")
				.replace(/%extension%/g, "");
		};

		const a = document.createElement("a");
		a.href = url;
		a.download = `${format(filenameFormat)}.zip`;
		a.click();
		URL.revokeObjectURL(url);
		a.remove();
		// downloadAll() builds its own zip and never goes through
		// VertFile.download(); a.click() has no success callback
		if (dlFiles.length > 0)
			trackEvent("download_click", { count: dlFiles.length });
	}
}

export function setTheme(themeTo: "light" | "dark") {
	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(themeTo);
	localStorage.setItem("theme", themeTo);
	log(["theme"], `set to ${themeTo}`);
	theme.set(themeTo);

	// Lock dark reader if it's set to dark mode
	if (themeTo === "dark") {
		const lock = document.createElement("meta");
		lock.name = "darkreader-lock";
		document.head.appendChild(lock);
	} else {
		const lock = document.querySelector('meta[name="darkreader-lock"]');
		if (lock) lock.remove();
	}
}

export function setEffects(effectsEnabled: boolean) {
	localStorage.setItem("effects", effectsEnabled.toString());
	log(["effects"], `set to ${effectsEnabled}`);
	effects.set(effectsEnabled);
}

export const files = new Files();
export const showGradient = writable(true);
export const gradientColor = writable("");
export const goingLeft = writable(false);
export const dropping = writable(false);
export const vertdLoaded = writable(false);
export const dropdownStates = writable<Record<string, string>>({});

export const isMobile = writable(false);
export const effects = writable(true);
export const theme = writable<"light" | "dark">("light");
export const locale = writable(getLocale());
export const availableLocales = {
	vi: "Tiếng Việt",
	cs: "Čeština",
	en: "English",
	es: "Español",
	fr: "Français",
	de: "Deutsch",
	it: "Italiano",
	ba: "Bosanski",
	hr: "Hrvatski",
	id: "Bahasa Indonesia",
	tr: "Türkçe",
	ru: "Русский",
	uk: "Українська",
	ja: "日本語",
	ko: "한국어",
	no: "Norsk",
	el: "Ελληνικά",
	"zh-Hans": "简体中文",
	"zh-Hant": "繁體中文",
	"pt-BR": "Português (Brasil)",
	pl: "Polski",
};

export function updateLocale(newLocale: string) {
	if (!Object.keys(availableLocales).includes(newLocale)) newLocale = "en";

	log(["locale"], `set to ${newLocale}`);
	localStorage.setItem("locale", newLocale);
	// @ts-expect-error shush
	setLocale(newLocale, { reload: false });
	// @ts-expect-error shush
	locale.set(newLocale);
}

export function link(
	tag: string | string[],
	text: string,
	links: string | string[],
	newTab?: boolean | boolean[],
	className?: string | string[],
) {
	if (!text) return "";

	const tags = Array.isArray(tag) ? tag : [tag];
	const linksArr = Array.isArray(links) ? links : [links];
	const newTabArr = Array.isArray(newTab) ? newTab : [newTab];
	const classArr = Array.isArray(className) ? className : [className];

	let result = text;

	tags.forEach((t, i) => {
		const link = linksArr[i] ?? "#";
		const target = newTabArr[i]
			? 'target="_blank" rel="noopener noreferrer"'
			: "";
		const cls = classArr[i] ? `class="${classArr[i]}"` : "";

		const regex = new RegExp(`\\[${t}\\](.*?)\\[\\/${t}\\]`, "g");
		result = result.replace(
			regex,
			(_, inner) => `<a href="${link}" ${target} ${cls} >${inner}</a>`,
		);
	});

	return result;
}

export function sanitize(
	html: string,
	allowedTags: string[] = ["a", "b", "code", "br"],
): string {
	return sanitizeHtml(html, {
		allowedTags: allowedTags,
		allowedAttributes: {
			a: ["href", "target", "rel", "class"],
			"*": ["class"],
		},
		allowedSchemes: ["http", "https", "mailto", "blob"],
	});
}

/**
 * Binary search for a max value without knowing the exact value, only that it
 * can be under or over It dose not test every number but instead looks for
 * 1,2,4,8,16,32,64,128,96,95 to figure out that you thought about #96 from
 * 0-infinity
 *
 * @example findFirstPositive(x => matchMedia(`(max-resolution: ${x}dpi)`).matches)
 * @author Jimmy Wärting
 * @see {@link https://stackoverflow.com/a/72124984/1008999}
 * @param {function} f The function to run the test on (should return truthy or falsy values)
 * @param {bigint} [b=1] Where to start looking from
 * @param {function} d privately used to calculate the next value to test
 * @returns {bigint} Integer
 */
function findFirstPositive(
	f: (x: bigint) => number,
	b = 1n,
	d = (e: bigint, g: bigint, c?: bigint): bigint =>
		g < e
			? -1n
			: 0 < f((c = (e + g) >> 1n))
				? c == e || 0 >= f(c - 1n)
					? c
					: d(e, c - 1n)
				: d(c + 1n, g),
): bigint {
	for (; 0 >= f(b); b <<= 1n);
	return d(b >> 1n, b) - 1n;
}

export const getMaxArrayBufferSize = (): number => {
	if (typeof window === "undefined") return 2 * GB; // default for SSR

	// check cache first
	const cached = localStorage.getItem("maxArrayBufferSize");
	if (cached) {
		const parsed = Number(cached);
		log(
			["converters"],
			`using cached max ArrayBuffer size: ${parsed} bytes`,
		);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}

	// detect max size using binary search
	const maxSize = findFirstPositive((x) => {
		try {
			new ArrayBuffer(Number(x));
			return 0; // false = can allocate
		} catch {
			return 1; // true = cannot allocate
		}
	});

	const result = Number(maxSize);
	localStorage.setItem("maxArrayBufferSize", result.toString());
	log(["converters"], `detected max ArrayBuffer size: ${result} bytes`);

	return result;
};

export const MAX_ARRAY_BUFFER_SIZE = getMaxArrayBufferSize();
