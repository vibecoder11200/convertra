declare module "gifenc" {
	export interface GifFrameOptions {
		transparent?: boolean;
		transparentIndex?: number;
		delay?: number;
		palette?: Uint8Array | number[][];
		repeat?: number;
		colorDepth?: number;
		dispose?: number;
	}

	export interface GifEncoder {
		writeFrame(
			index: Uint8Array,
			width: number,
			height: number,
			opts?: GifFrameOptions,
		): void;
		finish(): void;
		bytes(): Uint8Array;
		bytesView(): Uint8Array;
		writeHeader(): void;
		reset(): void;
	}

	export function GIFEncoder(opts?: {
		initialCapacity?: number;
		auto?: boolean;
	}): GifEncoder;

	export function quantize(
		data: Uint8Array | Uint8ClampedArray,
		maxColors: number,
		opts?: unknown,
	): Uint8Array;

	export function applyPalette(
		data: Uint8Array | Uint8ClampedArray,
		palette: Uint8Array,
		format?: unknown,
	): Uint8Array;
}
