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
		// No WASM; uses browser video decode + gifenc (GIF) / MediaRecorder (WebM) lazily.
		if (browser) this.status = "ready";
		this.clearTimeout();
	}

	private cancelledIds = new Set<string>();

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
		if (start > end) {
			throw new Error("Trim start must not be later than trim end.");
		}
		if (start < 0 || end < 0) {
			throw new Error("Trim times cannot be negative.");
		}
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
		this.cancelledIds.delete(input.id);

		if (target === "gif") return this.toGif(input, opts, start, end);
		if (target === "webm") return this.toWebM(input, opts, start, end);
		throw new Error(`Unsupported client-side output: ${target}`);
	}

	private async decodeVideo(file: File): Promise<{
		video: HTMLVideoElement;
		url: string;
		duration: number;
		width: number;
		height: number;
	}> {
		const url = URL.createObjectURL(file);
		const video = document.createElement("video");
		video.src = url;
		video.muted = true;
		video.playsInline = true;

		try {
			await new Promise<void>((resolve, reject) => {
				video.onloadedmetadata = () => resolve();
				video.onerror = () => reject(new Error("Failed to load video"));
			});
		} catch (err) {
			URL.revokeObjectURL(url);
			video.removeAttribute("src");
			video.load();
			throw err;
		}

		const duration = video.duration;
		const width = video.videoWidth;
		const height = video.videoHeight;
		return { video, url, duration, width, height };
	}

	private releaseMedia(
		video: HTMLVideoElement,
		url: string,
		canvas?: HTMLCanvasElement,
	) {
		video.pause();
		video.removeAttribute("src");
		video.load();
		URL.revokeObjectURL(url);
		video.remove();
		canvas?.remove();
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

	private isCancelled(id: string): boolean {
		return this.cancelledIds.has(id);
	}

	private async toGif(
		input: VertFile,
		opts: Partial<VideoOptions>,
		start: number,
		end: number,
	): Promise<VertFile> {
		const { video, url, duration } = await this.decodeVideo(input.file);
		const canvas = document.createElement("canvas");
		try {
			const srcW = video.videoWidth;
			const srcH = video.videoHeight;
			const fps = opts.fps ?? 12;
			const width =
				opts.width && opts.width > 0 ? opts.width : Math.min(480, srcW);
			const height = Math.max(1, Math.round((width * srcH) / srcW));

			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d")!;

			const { GIFEncoder, quantize, applyPalette } = await import(
				"gifenc"
			);
			const gif = GIFEncoder();

			const totalFrames = Math.max(
				1,
				Math.ceil(Math.min(end, duration) - start) * fps,
			);
			const step = 1 / fps;
			let t = start;
			let frame = 0;

			// gifenc delay is in 10ms units. round() of 1/fps*100 gives the
			// closest 10ms step; floor at 1 so 30+fps stays expressible.
			const frameDelay = Math.max(1, Math.round(step * 100));

			for (
				frame = 0;
				frame < totalFrames && t < Math.min(end, duration);
				frame++
			) {
				if (this.isCancelled(input.id)) {
					throw new Error("Conversion cancelled");
				}
				await this.seekTo(video, t);
				ctx.drawImage(video, 0, 0, width, height);
				const {
					data,
					width: w,
					height: h,
				} = ctx.getImageData(0, 0, width, height);
				const palette = quantize(data, 256);
				const index = applyPalette(data, palette);
				gif.writeFrame(index, w, h, { palette, delay: frameDelay });
				t += step;
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
		} finally {
			this.releaseMedia(video, url, canvas);
		}
	}

	private async toWebM(
		input: VertFile,
		opts: Partial<VideoOptions>,
		start: number,
		end: number,
	): Promise<VertFile> {
		const { video, url, duration } = await this.decodeVideo(input.file);
		const canvas = document.createElement("canvas");
		try {
			const srcW = video.videoWidth;
			const srcH = video.videoHeight;
			const fps = opts.fps ?? 24;
			const width =
				opts.width && opts.width > 0 ? opts.width : Math.min(640, srcW);
			const height = Math.max(1, Math.round((width * srcH) / srcW));

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
			try {
				for (
					let frame = 0;
					frame < totalFrames && t < Math.min(end, duration);
					frame++
				) {
					if (this.isCancelled(input.id)) {
						throw new Error("Conversion cancelled");
					}
					await this.seekTo(video, t);
					ctx.drawImage(video, 0, 0, width, height);
					t += step;
					input.progress = Math.round((frame / totalFrames) * 100);
					// captureStream has no internal clock; the MediaRecorder
					// stamps frames by real elapsed time, so sleep the real
					// frame interval to get a WebM whose duration matches the
					// clip instead of a 1s file containing all frames.
					await new Promise((r) =>
						setTimeout(r, Math.max(1, step * 1000)),
					);
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
		} finally {
			this.releaseMedia(video, url, canvas);
		}
	}

	public async cancel(input: VertFile): Promise<void> {
		// Mark the id so the frame loops abort on their next iteration.
		this.cancelledIds.add(input.id);
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
