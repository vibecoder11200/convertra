// HEIC/HEIF decode worker. Tries the browser's native decoder first
// (createImageBitmap — Safari decodes HEIC natively and this is by far the
// fastest path there); falls back to libheif-wasm for everything else. The
// wasm binary is handed in by the converter (already fetched same-origin from
// /libheif.wasm) so this file never resolves URLs itself.
//
// Frame policy: single-frame requests (image targets) prefer the native path
// and use only the first decoded frame; all-frames requests (pdf target)
// skip the native shortcut because createImageBitmap cannot enumerate bursts.

interface DecodeRequest {
	type: "decode";
	id: string;
	file: File;
	wasm: ArrayBuffer;
	allFrames: boolean;
}

interface Frame {
	data: Uint8Array;
	width: number;
	height: number;
}

type WorkerResponse =
	| { type: "progress"; id: string; value: number }
	| { type: "finished"; id: string; frames: Frame[] }
	| { type: "error"; id: string; error: string };

// ~24MP decode budget: 48MP iPhone bursts downscale by default so the RGBA
// + PNG intermediates stay inside mobile memory ceilings (configurable
// long-edge override unifies with the image-ops setting later)
const MAX_PIXELS = 24_000_000;
// libheif cannot decode with downscaling — hard cap before the w*h*4
// allocation, above which the worker would OOM instead of failing cleanly
const MAX_DECODE_PIXELS = 64_000_000;

let libheifPromise: Promise<HeifLib> | null = null;

interface HeifLib {
	HeifDecoder: new () => {
		decode(data: Uint8Array): unknown[];
	};
}

async function ensureLib(wasm: ArrayBuffer): Promise<HeifLib> {
	if (!libheifPromise) {
		libheifPromise = (async () => {
			const mod = await import("libheif-js/libheif-wasm/libheif.js");
			return await mod.default({ wasmBinary: wasm });
		})();
	}
	return libheifPromise;
}

/** Encode a bitmap to PNG bytes, downscaling when over the pixel budget. */
async function bitmapToPng(
	bitmap: ImageBitmap | ImageData,
): Promise<{ data: Uint8Array; width: number; height: number }> {
	const srcW = bitmap.width;
	const srcH = bitmap.height;
	let dw = srcW;
	let dh = srcH;
	if (srcW * srcH > MAX_PIXELS) {
		const scale = Math.sqrt(MAX_PIXELS / (srcW * srcH));
		dw = Math.max(1, Math.floor(srcW * scale));
		dh = Math.max(1, Math.floor(srcH * scale));
	}
	const canvas = new OffscreenCanvas(dw, dh);
	const ctx = canvas.getContext("2d")!;
	ctx.drawImage(bitmap as CanvasImageSource, 0, 0, dw, dh);
	const blob = await canvas.convertToBlob({ type: "image/png" });
	return {
		data: new Uint8Array(await blob.arrayBuffer()),
		width: dw,
		height: dh,
	};
}

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
	const msg = e.data;
	if (msg.type !== "decode") return;
	const post = (res: WorkerResponse) => self.postMessage(res);
	try {
		const frames: Frame[] = [];

		if (!msg.allFrames) {
			// fast path: native browser decode (Safari HEIC support)
			try {
				const bitmap = await createImageBitmap(msg.file);
				frames.push(await bitmapToPng(bitmap));
				bitmap.close();
				post({ type: "finished", id: msg.id, frames });
				return;
			} catch {
				// not natively decodable — fall through to libheif-wasm
			}
		}

		const lib = await ensureLib(msg.wasm);
		const decoder = new lib.HeifDecoder();
		const data = new Uint8Array(await msg.file.arrayBuffer());
		const images = decoder.decode(data);
		if (!images || images.length === 0) {
			throw new Error("No decodable images found in HEIC/HEIF file");
		}

		const limit = msg.allFrames ? images.length : 1;
		for (let i = 0; i < limit; i++) {
			const image = images[i] as {
				get_width(): number;
				get_height(): number;
				display(
					imageData: ImageData,
					callback: (data: ImageData | null) => void,
				): void;
				free(): void;
			};
			const w = image.get_width();
			const h = image.get_height();
			if (w <= 0 || h <= 0) continue;
			if (w * h > MAX_DECODE_PIXELS) {
				image.free();
				throw new Error(
					`Image is too large to decode (${w}×${h}, limit ${MAX_DECODE_PIXELS / 1_000_000}MP)`,
				);
			}

			// display() fills the caller-provided RGBA buffer
			const buffer = new Uint8ClampedArray(w * h * 4);
			const imageData = new ImageData(buffer, w, h);
			const displayed = await new Promise<ImageData>(
				(resolve, reject) => {
					image.display(imageData, (d) =>
						d
							? resolve(d)
							: reject(new Error("HEIC decode failed")),
					);
				},
			);
			image.free();

			// decode -> encode -> release, one frame at a time so peak memory
			// stays at roughly one frame
			const bitmap = await createImageBitmap(displayed);
			frames.push(await bitmapToPng(bitmap));
			bitmap.close();

			post({
				type: "progress",
				id: msg.id,
				value: Math.round(((i + 1) / limit) * 100),
			});
		}

		if (frames.length === 0)
			throw new Error("No decodable frames in HEIC/HEIF file");
		post({ type: "finished", id: msg.id, frames });
	} catch (err) {
		post({ type: "error", id: msg.id, error: String(err) });
	}
};
