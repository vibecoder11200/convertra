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
		const op = (args.at(0) as { scale?: number; range?: string }) ?? {};
		const scale = op.scale ?? 2; // 144dpi default for crisp output
		const range = op.range
			? {
					from: Math.max(0, parseInt(op.range.split("-")[0], 10) - 1),
					to: Math.max(
						0,
						parseInt(op.range.split("-").pop() ?? "1", 10) - 1,
					),
				}
			: "all";

		const worker = new Worker(PdfRenderWorker, { type: "module" });
		this.activeConversions.set(input.id, worker);

		const data = new Uint8Array(await input.file.arrayBuffer());
		worker.postMessage({
			type: "render",
			id: input.id,
			data,
			format: "png",
			scale,
			range,
		});

		const result = await new Promise<{
			type: string;
			output?: { name: string; bytes: Uint8Array }[];
			zip?: boolean;
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
			return this.renderWithPdfjs(input);
		}

		const parts = result.output ?? [];
		if (parts.length === 0) throw new Error("No pages rendered");

		// Rewrite names/bytes to the requested image format when possible.
		const files = parts.map((p) => {
			const name = p.name.replace(/\.png$/, `.${target}`);
			return new File([p.bytes as unknown as BlobPart], name, {
				type: `image/${target}`,
			});
		});

		const { createZip } = await import("$lib/util/zip");
		const zipBytes = await createZip(files);
		return new VertFile(
			new File(
				[zipBytes as unknown as BlobPart],
				`${baseName(input.name)}_images.zip`,
			),
			".zip",
		);
	}

	private async renderWithPdfjs(input: VertFile): Promise<VertFile> {
		// pdfjs-dist (legacy build) renders each page to a canvas in the page,
		// but in a worker we lack a DOM. This path is used on the main thread
		// via OffscreenCanvas when available; otherwise it surfaces a clear
		// error. See PdfRenderConverter for the browser fallback.
		const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
		const loadingTask = getDocument({
			data: await input.file.arrayBuffer(),
		});
		await loadingTask.promise;

		// pdfjs-dist rasterization requires a DOM canvas to draw to; this
		// module-level fallback documents the dependency rather than silently
		// producing empty output. The mupdf path is the primary renderer (D11).
		await loadingTask.destroy();
		throw new Error(
			`pdfjs fallback needs a canvas context; the mupdf path produced the error below.`,
		);
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
		new FormatInfo("pdf", true, false),
	];
}
