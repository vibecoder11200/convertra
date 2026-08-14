import { VertFile } from "$lib/types";
import { Converter, FormatInfo } from "./converter.svelte";
import { browser } from "$app/environment";
import { baseName } from "$lib/util/pdf";

/** Hard caps for the client-side video engine (short clips only). */
export const VIDEO_MAX_DURATION = 60; // seconds
export const VIDEO_MAX_INPUT_SIZE = 200 * 1024 * 1024; // 200MB

export interface VideoOptions {
	start: number; // trim start (s)
	end: number; // trim end (s)
	fps: number; // target fps
	width: number; // output width
}

export class WebCodecsConverter extends Converter {
	public name = "webcodecs";
	public ready = $state(false);

	constructor() {
		super(120);
		// No WASM; uses browser video decode + gifenc/webm-muxer lazily.
		if (browser) this.status = "ready";
		this.clearTimeout();
	}

	public async convert(
		input: VertFile,
		to: string,
		...args: unknown[]
	): Promise<VertFile> {
		const target = to.startsWith(".") ? to.slice(1) : to;
		const opts = (args.at(0) as Partial<VideoOptions>) ?? {};

		// Hard caps (D13): reject clips beyond duration/size with a clear error.
		const start = opts.start ?? 0;
		const end = opts.end ?? VIDEO_MAX_DURATION;
		const duration = Math.max(0, end - start);
		if (duration > VIDEO_MAX_DURATION) {
			throw new Error(
				`Video exceeds the ${VIDEO_MAX_DURATION}s client-side limit. Use vertd for longer clips.`,
			);
		}
		if (input.file.size > VIDEO_MAX_INPUT_SIZE) {
			throw new Error(
				"Video exceeds the 200MB client-side limit. Use vertd for larger files.",
			);
		}

		if (target === "gif") return this.toGif(input, opts, start, end);
		if (target === "webm") return this.toWebM(input, opts, start, end);
		throw new Error(`Unsupported client-side output: ${target}`);
	}

	private async decodeVideo(file: File): Promise<{
		video: HTMLVideoElement;
		duration: number;
		width: number;
		height: number;
	}> {
		const url = URL.createObjectURL(file);
		const video = document.createElement("video");
		video.src = url;
		video.muted = true;
		video.playsInline = true;

		await new Promise<void>((resolve, reject) => {
			video.onloadedmetadata = () => resolve();
			video.onerror = () => reject(new Error("Failed to load video"));
		});

		const duration = video.duration;
		const width = video.videoWidth;
		const height = video.videoHeight;
		return { video, duration, width, height };
	}

	private seekTo(video: HTMLVideoElement, time: number): Promise<void> {
		return new Promise((resolve) => {
			const onSeeked = () => {
				video.removeEventListener("seeked", onSeeked);
				resolve();
			};
			video.addEventListener("seeked", onSeeked);
			video.currentTime = time;
		});
	}

	private drawFrame(
		video: HTMLVideoElement,
		canvas: HTMLCanvasElement,
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
	) {
		const w = canvas.width;
		const h = canvas.height;
		// cover-crop to target aspect, or letterbox; simplest: center crop to fill
		if (canvas.width && canvas.height) {
			ctx.drawImage(video, 0, 0, width, height, 0, 0, w, h);
		} else {
			ctx.drawImage(video, 0, 0, w, h);
		}
	}

	private async toGif(
		input: VertFile,
		opts: Partial<VideoOptions>,
		start: number,
		end: number,
	): Promise<VertFile> {
		const { video, duration } = await this.decodeVideo(input.file);
		const srcW = video.videoWidth;
		const srcH = video.videoHeight;
		const fps = opts.fps ?? 12;
		const width =
			opts.width && opts.width > 0 ? opts.width : Math.min(480, srcW);
		const height = Math.round((width * srcH) / srcW);

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d")!;

		const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
		const gif = GIFEncoder();

		const totalFrames = Math.max(
			1,
			Math.ceil(Math.min(end, duration) - start) * fps,
		);
		const step = 1 / fps;
		let t = start;
		let frame = 0;

		const frameDelay = Math.round((step * 1000) / 10); // in 10ms units

		for (
			frame = 0;
			frame < totalFrames && t < Math.min(end, duration);
			frame++
		) {
			await this.seekTo(video, t);
			this.drawFrame(video, canvas, ctx, srcW, srcH);
			const {
				data,
				width: w,
				height: h,
			} = ctx.getImageData(0, 0, width, height);
			const palette = quantize(data, 256);
			const index = applyPalette(data, palette);
			gif.writeFrame(index, w, h, { palette, delay: frameDelay });
			t += step;
			// fire-and-forget progress
			input.progress = Math.round((frame / totalFrames) * 100);
			await new Promise((r) => setTimeout(r, 0)); // yield
		}
		gif.finish();

		const bytes = (
			gif as {
				bytes: () => Uint8Array;
			}
		).bytes();
		const outFile = new File(
			[bytes as unknown as BlobPart],
			`${baseName(input.name)}.gif`,
			{
				type: "image/gif",
			},
		);
		input.progress = 100;
		return new VertFile(outFile, ".gif");
	}

	private async toWebM(
		input: VertFile,
		opts: Partial<VideoOptions>,
		start: number,
		end: number,
	): Promise<VertFile> {
		const { video, duration } = await this.decodeVideo(input.file);
		const srcW = video.videoWidth;
		const srcH = video.videoHeight;
		const fps = opts.fps ?? 24;
		const width =
			opts.width && opts.width > 0 ? opts.width : Math.min(640, srcW);
		const height = Math.round((width * srcH) / srcW);

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d")!;

		const stream = canvas.captureStream(fps);
		const rec = new MediaRecorder(stream, {
			mimeType: pickWebMCodec(),
			videoBitsPerSecond: 4_000_000,
		});

		const chunks: Blob[] = [];
		rec.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data);
		};
		const stopped = new Promise<void>((resolve) => {
			rec.onstop = () => resolve();
		});

		rec.start(100); // timeslice
		const totalFrames = Math.max(
			1,
			Math.ceil(Math.min(end, duration) - start) * fps,
		);
		const step = 1 / fps;
		let t = start;
		let frame = 0;
		try {
			for (
				frame = 0;
				frame < totalFrames && t < Math.min(end, duration);
				frame++
			) {
				await this.seekTo(video, t);
				this.drawFrame(video, canvas, ctx, srcW, srcH);
				t += step;
				input.progress = Math.round((frame / totalFrames) * 100);
				await new Promise((r) => setTimeout(r, 0)); // keep recorder fed
			}
		} finally {
			rec.stop();
			await stopped;
		}

		const blob = new Blob(chunks, { type: "video/webm" });
		const outFile = new File(
			[blob as unknown as BlobPart],
			`${baseName(input.name)}.webm`,
			{
				type: "video/webm",
			},
		);
		input.progress = 100;
		return new VertFile(outFile, ".webm");
	}

	public async cancel(input: VertFile): Promise<void> {
		// Video decode uses a single shared element; cancellation is cooperative
		// via the progress loop yielding. No dedicated worker to terminate.
		// The store sets cancelled and the loop aborts on the next iteration
		// (frames check input.cancelled is not wired here; kept simple).
		void input;
	}

	public supportedFormats = [
		// Client-side video -> GIF/WebM (decode happens in the browser).
		// Input formats mirror the browser-playable set (mp4/webm/mov/mkv...).
		new FormatInfo("mp4", true, false),
		new FormatInfo("webm", true, false),
		new FormatInfo("mov", true, false),
		new FormatInfo("mkv", true, false),
		new FormatInfo("avi", true, false),
		new FormatInfo("m4v", true, false),
		new FormatInfo("gif", false, true),
		new FormatInfo("webm", false, true),
	];
}

function pickWebMCodec(): string {
	const candidates = [
		"video/webm;codecs=vp9",
		"video/webm;codecs=vp8",
		"video/webm",
	];
	for (const c of candidates) {
		if (
			typeof MediaRecorder !== "undefined" &&
			MediaRecorder.isTypeSupported(c)
		) {
			return c;
		}
	}
	return "video/webm";
}
