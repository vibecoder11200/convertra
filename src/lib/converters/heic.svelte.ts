import { browser } from "$app/environment";
import { error, log } from "$lib/util/logger";
import { m } from "$lib/paraglide/messages";
import { VertFile } from "$lib/types";
import HeicWorker from "$lib/workers/heic?worker&url";
import PdfLibWorker from "$lib/workers/pdf-lib?worker&url";
import { Converter, FormatInfo } from "./converter.svelte";
import { ToastManager } from "$lib/util/toast.svelte";

const LIBHEIF_WASM_URL = "/libheif.wasm";

/**
 * HEIC/HEIF input support. magick-wasm cannot decode HEIF (no libheif
 * delegate in the wasm builds), so this converter owns decoding: native
 * createImageBitmap where the browser supports it (Safari), libheif-wasm
 * otherwise.
 *
 * Resolution contract: .png and .pdf MUST be declared as outputs — without
 * toSupported entries the runtime resolver (VertFile.findConverter) can
 * never select this converter, neither directly nor via the 2-step
 * auto-chain. Image targets resolve as chains (heic -> png -> jpg style);
 * .pdf resolves as a direct match so all frames can become pages.
 */
export class HeicConverter extends Converter {
	public name = "heic";

	public override readonly reportsProgress = true;

	public supportedFormats = [
		new FormatInfo("heic", true, false),
		new FormatInfo("heif", true, false),
		// decode-only inputs become png intermediates; pdf handled internally
		// via the pdf-lib worker's multi-image api
		new FormatInfo("png", false, true),
		new FormatInfo("pdf", false, true),
	];

	private wasm: ArrayBuffer = null!;
	private wasmPromise: Promise<void> | null = null;

	private activeConversions = new Map<string, Worker>();

	constructor() {
		super(30);
		if (browser) this.status = "not-ready";
	}

	/** Warm the wasm engine ahead of use (e.g. when a heic file is added). */
	public override warm(): void {
		void this.ensureWasm();
	}

	private ensureWasm(): Promise<void> {
		if (this.status === "ready") return Promise.resolve();
		if (this.wasmPromise) return this.wasmPromise;

		this.wasmPromise = (async () => {
			try {
				this.status = "downloading";
				const response = await fetch(LIBHEIF_WASM_URL);
				if (!response.ok) {
					throw new Error(
						`Failed to fetch libheif WASM: ${response.status} ${response.statusText}`,
					);
				}
				this.wasm = await response.arrayBuffer();
				this.status = "ready";
			} catch (err) {
				this.status = "error";
				error(
					["converters", this.name],
					`Failed to load libheif WASM: ${err}`,
				);
				ToastManager.add({
					type: "error",
					message: m["workers.errors.heic"](),
				});
			}
		})();

		return this.wasmPromise;
	}

	public override async convert(
		input: VertFile,
		to: string,
	): Promise<VertFile> {
		await this.ensureWasm();
		if (this.status !== "ready") {
			throw new Error(`HEIC decoder not ready (status: ${this.status})`);
		}
		log(["converters", this.name], `converting ${input.name} to ${to}`);

		const allFrames = to === ".pdf";
		const worker = new Worker(HeicWorker, { type: "module" });
		this.activeConversions.set(input.id, worker);

		let frames: { data: Uint8Array; width: number; height: number }[];
		try {
			frames = await new Promise((resolve, reject) => {
				worker.onmessage = (e: MessageEvent) => {
					const msg = e.data;
					if (msg.type === "progress") {
						input.progress = msg.value;
						return;
					}
					if (msg.type === "finished") resolve(msg.frames);
					else if (msg.type === "error") reject(new Error(msg.error));
				};
				worker.onerror = (e: ErrorEvent) =>
					reject(new Error(`Worker error: ${e.message}`));
				worker.postMessage({
					type: "decode",
					id: input.id,
					file: input.file,
					wasm: this.wasm,
					allFrames,
				});
			});
		} finally {
			this.activeConversions.delete(input.id);
			worker.terminate();
		}

		if (!frames || frames.length === 0) {
			throw new Error("No images decoded from HEIC/HEIF file");
		}

		const base = input.name.replace(/\.[^/.]+$/, "");
		if (to === ".pdf") {
			return await this.framesToPdf(frames, base);
		}

		// single image target: primary frame as lossless png (the chain's
		// next step or the direct .png target)
		return new VertFile(
			new File([frames[0].data as unknown as BlobPart], `${base}.png`, {
				type: "image/png",
			}),
			".png",
		);
	}

	/** Assemble decoded frames into one multi-page pdf via the pdf-lib worker. */
	private async framesToPdf(
		frames: { data: Uint8Array; width: number; height: number }[],
		base: string,
	): Promise<VertFile> {
		const worker = new Worker(PdfLibWorker, { type: "module" });
		try {
			worker.postMessage({
				type: "img2pdf",
				id: base,
				files: frames.map((f: { data: Uint8Array }, i: number) => ({
					name: `${base}-${i + 1}.png`,
					data: f.data,
				})),
			});
			const result = await new Promise<{
				type: string;
				output?: Uint8Array;
				error?: string;
			}>((resolve) => {
				worker.onmessage = (e) => resolve(e.data);
				worker.onerror = (e: ErrorEvent) =>
					resolve({ type: "error", error: e.message });
			});
			if (result.type === "error") throw new Error(result.error);
			return new VertFile(
				new File(
					[result.output as unknown as BlobPart],
					`${base}.pdf`,
					{ type: "application/pdf" },
				),
				".pdf",
			);
		} finally {
			worker.terminate();
		}
	}

	public override async cancel(input: VertFile): Promise<void> {
		const worker = this.activeConversions.get(input.id);
		if (!worker) {
			log(
				["converters", this.name],
				`no active conversion found for file ${input.name}`,
			);
			return;
		}
		worker.terminate();
		this.activeConversions.delete(input.id);
	}
}
