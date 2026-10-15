import { browser } from "$app/environment";
import { log } from "$lib/util/logger";
import { m } from "$lib/paraglide/messages";
import { VertFile } from "$lib/types";
import ThreeWorker from "$lib/workers/three?worker&url";
import { Converter, FormatInfo } from "./converter.svelte";
import { Settings } from "$lib/sections/settings/index.svelte";
import { ToastManager } from "$lib/util/toast.svelte";

/**
 * GLB / self-contained glTF -> STL / OBJ via three.js in a worker. three
 * loads lazily inside the worker on first conversion (the main bundle never
 * imports it), so there is no wasm to download: the converter is ready
 * immediately.
 */
export class ThreeConverter extends Converter {
	public name = "three";

	private activeConversions = new Map<string, Worker>();

	public supportedFormats = [
		new FormatInfo("glb", true, false),
		new FormatInfo("gltf", true, false),
		new FormatInfo("stl", false, true),
		new FormatInfo("obj", false, true),
	];

	constructor() {
		super();
		log(["converters", this.name], `created converter`);
		if (browser) {
			this.status = "ready";
			this.clearTimeout();
		}
	}

	public async convert(input: VertFile, to: string): Promise<VertFile> {
		const from = input.from.replace(/^\./, "");
		const target = to.startsWith(".") ? to.slice(1) : to;
		if (from !== "glb" && from !== "gltf") {
			throw new Error(
				`3D conversion source must be glb/gltf, got ${from}`,
			);
		}
		if (target !== "stl" && target !== "obj") {
			throw new Error(
				`3D conversion target must be stl/obj, got ${target}`,
			);
		}

		const worker = new Worker(ThreeWorker, { type: "module" });
		this.activeConversions.set(input.id, worker);

		try {
			worker.postMessage({
				type: "convert",
				id: input.id,
				data: new Uint8Array(await input.file.arrayBuffer()),
				from,
				to: target,
				units: Settings.instance.settings.threeUnits,
				// OOM guard for huge models (phase plan: default 5M)
				maxVertices: 5_000_000,
			});

			let scan: { meshes: number; vertices: number } | null = null;
			const result = await new Promise<{
				type: string;
				output?: Uint8Array;
				error?: string;
			}>((resolve) => {
				worker.onmessage = (e) => {
					// the pre-export sanity scan arrives before "finished";
					// stash it and surface with the result toast
					if (e.data.type === "scan") {
						scan = {
							meshes: e.data.meshes,
							vertices: e.data.vertices,
						};
						log(
							["converters", this.name],
							`scan: ${e.data.meshes} meshes / ${e.data.vertices} vertices`,
						);
						return;
					}
					resolve(e.data);
				};
				worker.onerror = (e) =>
					resolve({ type: "error", error: e.message });
			});

			if (result.type === "error") throw new Error(result.error);

			// scan is assigned inside the onmessage callback, which TS's
			// control-flow analysis can't see — re-read through an alias
			const scanInfo = scan as {
				meshes: number;
				vertices: number;
			} | null;
			if (scanInfo) {
				ToastManager.add({
					type: "info",
					message: m["convert.three.scan_result"]({
						meshes: String(scanInfo.meshes),
						vertices: scanInfo.vertices.toLocaleString(),
						units: Settings.instance.settings.threeUnits,
					}),
				});
			}

			return new VertFile(
				new File([result.output! as BlobPart], input.name),
				to,
			);
		} finally {
			worker.terminate();
			this.activeConversions.delete(input.id);
		}
	}

	public async cancel(input: VertFile): Promise<void> {
		const worker = this.activeConversions.get(input.id);
		if (worker) {
			worker.terminate();
			this.activeConversions.delete(input.id);
		}
	}
}
