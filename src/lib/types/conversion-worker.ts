import { VertFile } from "./file.svelte";

interface ConvertMessage {
	type: "convert";
	input:
		| {
				file: File;
				name: string;
				from: string;
				to: string;
		  }
		| VertFile;
	to: string;
	compression: number | null;
	keepMetadata?: boolean;
	/** clamp the long edge before encode (aspect preserved, never upscale) */
	resize?: { maxEdge: number };
	/** bounded quality binary search until output <= bytes (jpg/webp only) */
	targetSize?: { bytes: number };
}

interface FinishedMessage {
	type: "finished";
	output: ArrayBufferLike | Uint8Array;
	zip?: boolean;
	/** target-size runs report what they actually achieved */
	achievedBytes?: number;
	finalQuality?: number;
}

interface LoadMessage {
	type: "load";
	wasm: ArrayBuffer;
}

interface LoadedMessage {
	type: "loaded";
}

interface ReadyMessage {
	type: "ready";
}

interface ErrorMessage {
	type: "error";
	error: string;
}

export type WorkerMessage = (
	| ConvertMessage
	| FinishedMessage
	| LoadMessage
	| LoadedMessage
	| ReadyMessage
	| ErrorMessage
) & {
	id: string; // unused? rn just using file id, probably meant to be incrementing w/ every message posted?
};
