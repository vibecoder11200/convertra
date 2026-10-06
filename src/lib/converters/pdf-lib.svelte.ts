import { VertFile } from "$lib/types";
import { Converter, FormatInfo } from "./converter.svelte";
import { browser } from "$app/environment";
import PdfLibWorker from "$lib/workers/pdf-lib?worker&url";
import { baseName } from "$lib/util/pdf";

export class PdfLibConverter extends Converter {
	public name = "pdf-lib";
	public ready = $state(false);

	private activeConversions = new Map<string, Worker>();

	constructor() {
		super(30);
		// pdf-lib is pure JS, no WASM to warm.
		if (browser) this.status = "ready";
		this.clearTimeout();
	}

	public async convert(
		input: VertFile,
		to: string,
		...args: unknown[]
	): Promise<VertFile> {
		const worker = new Worker(PdfLibWorker, { type: "module" });
		this.activeConversions.set(input.id, worker);

		const data = new Uint8Array(await input.file.arrayBuffer());

		// image -> pdf: the input is an image, not a pdf document
		const IMAGE_EXTS = [
			".jpg",
			".jpeg",
			".jpe",
			".jfif",
			".png",
			".webp",
			".gif",
			".avif",
			".bmp",
		];
		let msg: Record<string, unknown>;
		if (IMAGE_EXTS.includes(input.from)) {
			msg = {
				type: "img2pdf",
				id: input.id,
				files: [{ name: input.name, data }],
			};
		} else {
			// to === ".zip" means split-all; ".pdf" with pageRange arg means
			// split-range or compress. Converters are single-input, so operations
			// are encoded via the target format + args:
			//   .pdf + { op: "compress", quality } -> compress
			//   .pdf + { op: "split", range }     -> split range -> pdf
			//   .zip                              -> split all -> zip
			const op =
				(args.at(0) as {
					op?: string;
					quality?: number;
					range?: string;
				}) ?? {};
			msg =
				to === ".zip"
					? { type: "split", id: input.id, data, mode: "all" }
					: op.op === "compress"
						? {
								type: "compress",
								id: input.id,
								data,
								quality: op.quality ?? 75,
							}
						: {
								type: "split",
								id: input.id,
								data,
								mode: op.range
									? parseRangeToMode(op.range)
									: "all",
							};
		}

		worker.postMessage(msg);

		const result = await new Promise<{
			type: string;
			output?: Uint8Array | { name: string; bytes: Uint8Array }[];
			zip?: boolean;
			zipPrefix?: string;
			error?: string;
		}>((resolve) => {
			worker.onmessage = (e) => resolve(e.data);
			worker.onerror = (e) =>
				resolve({ type: "error", error: e.message });
		});

		worker.terminate();
		this.activeConversions.delete(input.id);

		if (result.type === "error") throw new Error(result.error);

		const outTo = to.startsWith(".") ? to : `.${to}`;

		// zip output (split-all) -> build the zip client-side from returned parts
		if (result.zip) {
			const { createZip } = await import("$lib/util/zip");
			const parts = result.output as {
				name: string;
				bytes: Uint8Array;
			}[];
			const files = parts.map(
				(p) =>
					new File([p.bytes as unknown as BlobPart], p.name, {
						type: "application/pdf",
					}),
			);
			const zipBytes = await createZip(files);
			return new VertFile(
				new File(
					[zipBytes as unknown as BlobPart],
					`${baseName(input.name)}.zip`,
				),
				".zip",
			);
		}

		return new VertFile(
			new File([result.output as unknown as BlobPart], input.name),
			outTo,
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
		new FormatInfo("pdf", true, true),
		new FormatInfo("zip", false, true),
		// image -> pdf inputs (jpg/png embed losslessly; the rest are
		// canvas-decoded to png inside the worker)
		new FormatInfo("jpg", true, false),
		new FormatInfo("jpeg", true, false),
		new FormatInfo("jpe", true, false),
		new FormatInfo("jfif", true, false),
		new FormatInfo("png", true, false),
		new FormatInfo("webp", true, false),
		new FormatInfo("gif", true, false),
		new FormatInfo("avif", true, false),
		new FormatInfo("bmp", true, false),
	];
}

function parseRangeToMode(range: string): "all" | { from: number; to: number } {
	const m = range.match(/^(\d+)(?:-(\d+))?$/);
	if (!m) return "all";
	const from = Math.max(0, parseInt(m[1], 10) - 1);
	const to = m[2] ? Math.max(from, parseInt(m[2], 10) - 1) : from;
	return { from, to };
}
