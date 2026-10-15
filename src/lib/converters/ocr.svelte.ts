import { VertFile } from "$lib/types";
import { Converter, FormatInfo } from "./converter.svelte";
import { browser } from "$app/environment";
import OcrWorker from "$lib/workers/ocr?worker&url";
import PdfRenderWorker from "$lib/workers/pdf-render?worker&url";
import { Settings } from "$lib/sections/settings/store.svelte";
import { baseName } from "$lib/util/pdf";
import { log } from "$lib/util/logger";

const MAX_OCR_PAGES = 200;
// ~300dpi render for tesseract accuracy (pdf user-space is 72dpi)
const OCR_SCALE = 300 / 72;

/**
 * Client-side OCR (tesseract.js). Raster images are recognized directly;
 * PDFs are rendered to page PNGs internally by driving the pdf-render
 * (mupdf) worker — no zip intermediate, one worker per page loop.
 *
 * Registered AFTER mupdf on purpose: digital PDFs keep the fast native-text
 * path by default; a per-file "Scanned document" flag (VertFile.forceOcr)
 * forces this converter for scanned/hybrid inputs.
 */
export class OcrConverter extends Converter {
	public name = "tesseract";

	public override readonly reportsProgress = true;

	public supportedFormats = [
		// outputs first for clarity: text targets
		new FormatInfo("txt", false, true),
		new FormatInfo("md", false, true),
		// raster inputs recognized directly
		new FormatInfo("jpg", true, false),
		new FormatInfo("jpeg", true, false),
		new FormatInfo("jpe", true, false),
		new FormatInfo("jfif", true, false),
		new FormatInfo("png", true, false),
		new FormatInfo("webp", true, false),
		new FormatInfo("bmp", true, false),
		new FormatInfo("gif", true, false),
		// pdf input: rendered to page images internally
		new FormatInfo("pdf", true, false),
	];

	private activeConversions = new Map<string, Worker>();

	constructor() {
		super(60);
		// pure JS + lazily fetched assets; nothing to preload at construction
		if (browser) this.status = "ready";
		this.clearTimeout();
	}

	public async convert(input: VertFile, to: string): Promise<VertFile> {
		log(["converters", this.name], `converting ${input.name} to ${to}`);
		const lang = Settings.instance.settings.ocrLang || "eng";

		let images: { name: string; data: Uint8Array }[];
		if (input.from === ".pdf") {
			images = await this.renderPdfPages(input);
		} else {
			images = [
				{
					name: input.name,
					data: new Uint8Array(await input.file.arrayBuffer()),
				},
			];
		}
		if (images.length > MAX_OCR_PAGES) {
			throw new Error(
				`PDF has ${images.length} pages; OCR is capped at ${MAX_OCR_PAGES} pages`,
			);
		}

		const worker = new Worker(OcrWorker, { type: "module" });
		this.activeConversions.set(input.id, worker);

		let pages: string[];
		try {
			pages = await new Promise<string[]>((resolve, reject) => {
				let page = 0;
				const total = images.length;
				worker.onmessage = (e: MessageEvent) => {
					const msg = e.data;
					if (msg.type === "page") {
						page = msg.index;
						input.progress = Math.round(
							((page + 0.5) / total) * 100,
						);
						return;
					}
					if (msg.type === "page-progress") {
						// recognize progress within the current page
						input.progress = Math.round(
							((page + msg.value) / total) * 100,
						);
						return;
					}
					if (msg.type === "finished") resolve(msg.pages);
					else if (msg.type === "error") reject(new Error(msg.error));
				};
				worker.onerror = (e: ErrorEvent) =>
					reject(new Error(`Worker error: ${e.message}`));
				worker.postMessage({
					type: "recognize",
					id: input.id,
					images,
					lang,
				});
			});
		} finally {
			this.activeConversions.delete(input.id);
			worker.terminate();
		}

		const target = to.startsWith(".") ? to.slice(1) : to;
		const ext = target === "md" ? "md" : "txt";
		const separator = ext === "md" ? "\n\n---\n\n" : "\n\n";
		const outText = pages.join(separator);
		return new VertFile(
			new File([outText], `${baseName(input.name)}.${ext}`, {
				type: "text/plain",
			}),
			`.${ext}`,
		);
	}

	/** Render pdf pages to PNGs via the pdf-render worker (raw array — no
	 * zip intermediate). */
	private async renderPdfPages(
		input: VertFile,
	): Promise<{ name: string; data: Uint8Array }[]> {
		const data = new Uint8Array(await input.file.arrayBuffer());
		const worker = new Worker(PdfRenderWorker, { type: "module" });
		this.activeConversions.set(`render-${input.id}`, worker);
		try {
			worker.postMessage({
				type: "render",
				id: input.id,
				data,
				sourceType: "application/pdf",
				format: "png",
				scale: OCR_SCALE,
				range: "all",
			});
			const result = await new Promise<{
				type: string;
				output?: { name: string; bytes: Uint8Array }[];
				error?: string;
			}>((resolve) => {
				worker.onmessage = (e) => resolve(e.data);
				worker.onerror = (e: ErrorEvent) =>
					resolve({ type: "error", error: e.message });
			});
			if (result.type === "error") throw new Error(result.error);
			return (result.output ?? []).map((p) => ({
				name: p.name,
				data: p.bytes,
			}));
		} finally {
			this.activeConversions.delete(`render-${input.id}`);
			worker.terminate();
		}
	}

	public async cancel(input: VertFile): Promise<void> {
		for (const key of [input.id, `render-${input.id}`]) {
			const worker = this.activeConversions.get(key);
			if (worker) {
				worker.terminate();
				this.activeConversions.delete(key);
			}
		}
	}
}
