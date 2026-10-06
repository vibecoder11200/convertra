import { VertFile } from "$lib/types";
import { Converter, FormatInfo } from "./converter.svelte";
import { browser } from "$app/environment";
import PdfRenderWorker from "$lib/workers/pdf-render?worker&url";
import { baseName } from "$lib/util/pdf";

export class PdfRenderConverter extends Converter {
	public name = "pdf-render";
	public ready = $state(false);

	private activeConversions = new Map<string, Worker>();

	constructor() {
		super(60);
		// No eager WASM; mupdf loads lazily inside the worker on first convert.
		if (browser) this.status = "ready";
		this.clearTimeout();
	}

	public async convert(
		input: VertFile,
		to: string,
		...args: unknown[]
	): Promise<VertFile> {
		const target = to.startsWith(".") ? to.slice(1) : to;
		const op =
			(args.at(0) as {
				scale?: number;
				range?: string;
				quality?: number;
			}) ?? {};
		const scale = op.scale ?? 2; // 144dpi default for crisp output
		const quality = op.quality ?? 85;
		// "all" or empty => render every page (pass the "all" sentinel through);
		// otherwise parse a 1-based inclusive "from-to" range into 0-based pages.
		const trimmed = op.range?.trim() ?? "";
		const range =
			trimmed === "" || trimmed.toLowerCase() === "all"
				? "all"
				: {
						from: Math.max(
							0,
							parseInt(trimmed.split("-")[0], 10) - 1,
						),
						to: Math.max(
							0,
							parseInt(trimmed.split("-").pop() ?? "1", 10) - 1,
						),
					};

		// mupdf opens documents by magic: pdf, epub and cbz (zip of images)
		const sourceType =
			input.from === ".epub"
				? "application/epub+zip"
				: input.from === ".cbz"
					? "application/vnd.comicbook+zip"
					: "application/pdf";

		const worker = new Worker(PdfRenderWorker, { type: "module" });
		this.activeConversions.set(input.id, worker);

		const data = new Uint8Array(await input.file.arrayBuffer());
		worker.postMessage({
			type: "render",
			id: input.id,
			data,
			sourceType,
			format: target as "png" | "jpeg" | "webp" | "pdf",
			quality,
			scale,
			range,
		});

		const result = await new Promise<{
			type: string;
			output?:
				| Uint8Array
				| { name: string; bytes: Uint8Array }[];
			zip?: boolean;
			single?: boolean;
			error?: string;
		}>((resolve) => {
			worker.onmessage = (e) => resolve(e.data);
			worker.onerror = (e) =>
				resolve({ type: "error", error: e.message });
		});

		worker.terminate();
		this.activeConversions.delete(input.id);

		if (result.type === "error") {
			// D11: fall back to pdfjs-dist rendering when mupdf fails.
			// pdfjs only speaks pdf; keep the original error for epub/cbz.
			if (sourceType === "application/pdf") {
				return this.renderWithPdfjs(input, target, scale, range);
			}
			throw new Error(result.error);
		}

		// single-buffer output: document -> one PDF (epub/cbz/pdf -> pdf)
		if (result.single) {
			return new VertFile(
				new File(
					[result.output as unknown as BlobPart],
					`${baseName(input.name)}.pdf`,
				),
				".pdf",
			);
		}

		const parts = result.output as { name: string; bytes: Uint8Array }[];
		if (parts.length === 0) throw new Error("No pages rendered");

		// mupdf emits PNG for the webp request (it has no WebP export), so
		// transcode to WebP via the browser's canvas encoder. png/jpeg bytes
		// come straight from the worker and only need correct naming.
		const files = await Promise.all(
			parts.map(async (p) => {
				const ext = p.name.split(".").pop() ?? target;
				const outName = p.name.replace(/\.[^.]+$/, `.${target}`);
				let blob: Blob;
				if (target === "webp" && ext !== "webp") {
					blob = await this.transcodeToWebP(p.bytes);
				} else {
					blob = new Blob([p.bytes as unknown as BlobPart], {
						type: `image/${target}`,
					});
				}
				return new File([blob as unknown as BlobPart], outName, {
					type: `image/${target}`,
				});
			}),
		);

		const { createZip } = await import("$lib/util/zip");
		const zipBytes = await createZip(files);

		// cbz is a plain zip of images — same payload, comic-reader naming
		if (target === "cbz") {
			return new VertFile(
				new File(
					[zipBytes as unknown as BlobPart],
					`${baseName(input.name)}.cbz`,
				),
				".cbz",
			);
		}

		return new VertFile(
			new File(
				[zipBytes as unknown as BlobPart],
				`${baseName(input.name)}_images.zip`,
			),
			".zip",
		);
	}

	private async transcodeToWebP(pngBytes: Uint8Array): Promise<Blob> {
		const blob = new Blob([pngBytes as unknown as BlobPart], {
			type: "image/png",
		});
		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext("2d")!;
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();

		return new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(b) => {
					canvas.remove();
					if (b) resolve(b);
					else reject(new Error("Failed to encode WebP"));
				},
				"image/webp",
				0.85,
			);
		});
	}

	private async renderWithPdfjs(
		input: VertFile,
		to: string,
		scale: number,
		range: "all" | { from: number; to: number },
	): Promise<VertFile> {
		// D11 fallback: pdfjs-dist rasterization needs a DOM canvas, so this
		// runs on the browser main thread (not in a worker) when the mupdf path
		// failed on a complex PDF. Produces the same zipped-image output shape.
		const target = to.startsWith(".") ? to.slice(1) : to;
		const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
		const loadingTask = getDocument({
			data: await input.file.arrayBuffer(),
		});
		const pdf = await loadingTask.promise;
		this.activeConversions.delete(input.id);

		try {
			const pageNums =
				range === "all"
					? Array.from({ length: pdf.numPages }, (_, i) => i + 1)
					: Array.from(
							{ length: range.to - range.from + 1 },
							(_, i) => range.from + 1 + i,
						);

			const outFiles: File[] = [];
			const width = Math.max(2, String(pdf.numPages).length);
			const outName = (p: number) =>
				`page_${String(p).padStart(width, "0")}.${target}`;

			for (const pageNum of pageNums) {
				const page = await pdf.getPage(pageNum);
				const viewport = page.getViewport({ scale });
				const canvas = document.createElement("canvas");
				canvas.width = viewport.width;
				canvas.height = viewport.height;
				const ctx = canvas.getContext("2d")!;
				await page.render({ canvas, canvasContext: ctx, viewport })
					.promise;
				page.cleanup();

				const blob = await new Promise<Blob>((resolve, reject) => {
					canvas.toBlob(
						(b) =>
							b
								? resolve(b)
								: reject(
										new Error(`Failed to encode ${target}`),
									),
						`image/${target}`,
						0.85,
					);
				});
				outFiles.push(
					new File([blob as unknown as BlobPart], outName(pageNum), {
						type: `image/${target}`,
					}),
				);
				canvas.remove();
			}

			await loadingTask.destroy();
			const { createZip } = await import("$lib/util/zip");
			const zipBytes = await createZip(outFiles);
			return new VertFile(
				new File(
					[zipBytes as unknown as BlobPart],
					`${baseName(input.name)}_images.zip`,
				),
				".zip",
			);
		} catch (err) {
			await loadingTask.destroy().catch(() => {});
			throw err;
		}
	}

	public async cancel(input: VertFile): Promise<void> {
		const worker = this.activeConversions.get(input.id);
		if (worker) {
			worker.terminate();
			this.activeConversions.delete(input.id);
		}
	}

	public supportedFormats = [
		new FormatInfo("png", false, true),
		new FormatInfo("jpeg", false, true),
		new FormatInfo("webp", false, true),
		// inputs: pdf, epub and cbz lay out via mupdf and render to
		// image/cbz/pdf targets
		new FormatInfo("pdf", true, true),
		new FormatInfo("epub", true, false),
		new FormatInfo("cbz", true, true),
	];
}
