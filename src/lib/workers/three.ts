// 3D model conversion worker: GLB / self-contained glTF -> STL / OBJ via
// three.js. three (~600KB min) enters only through this dynamic import, so
// the main bundle never pays for it.
import type * as THREE from "three";

interface ThreeConvertRequest {
	type: "convert";
	id: string;
	data: Uint8Array;
	from: "glb" | "gltf";
	to: "stl" | "obj";
	/** target unit for the exported model (glTF is meters by spec) */
	units: "mm" | "cm" | "m" | "in";
	/** hard vertex guard against OOM on huge models */
	maxVertices: number;
}

const UNIT_FACTOR: Record<ThreeConvertRequest["units"], number> = {
	m: 1,
	cm: 100,
	mm: 1000,
	in: 1000 / 25.4,
};

self.onmessage = async (e: MessageEvent<ThreeConvertRequest>) => {
	const req = e.data;
	// lib.dom types `self` as Window in this file; the transfer-list overload
	// only exists on DedicatedWorkerGlobalScope
	const ctx = self as unknown as {
		postMessage(message: unknown, transfer?: Transferable[]): void;
	};
	try {
		const magic = String.fromCharCode(
			req.data[0],
			req.data[1],
			req.data[2],
			req.data[3],
		);
		if (req.from === "glb" && magic !== "glTF") {
			throw new Error(
				"Not a GLB file (missing glTF magic bytes) — re-export the model as GLB or glTF",
			);
		}

		const { GLTFLoader } = await import(
			"three/examples/jsm/loaders/GLTFLoader.js"
		);
		const { DRACOLoader } = await import(
			"three/examples/jsm/loaders/DRACOLoader.js"
		);

		const loader = new GLTFLoader();
		// draco decoder is served same-origin from /draco/ (copied at
		// install time) so compressed GLBs work fully offline
		const draco = new DRACOLoader();
		draco.setDecoderPath("/draco/");
		loader.setDRACOLoader(draco);

		let payload: ArrayBuffer | string;
		if (req.from === "glb") {
			payload = new Uint8Array(req.data).buffer; // ensure plain buffer
		} else {
			const text = new TextDecoder().decode(req.data);
			try {
				JSON.parse(text);
			} catch {
				throw new Error(
					"Invalid .gltf file (JSON does not parse). Multi-file glTF (external .bin/textures) is not supported — export a self-contained .glb instead.",
				);
			}
			payload = text;
		}

		const gltf = await new Promise<{
			scene: THREE.Group;
		}>((resolve, reject) => {
			loader.parse(
				payload,
				"",
				(gltf) => resolve(gltf),
				(err) =>
					reject(err instanceof Error ? err : new Error(String(err))),
			);
		});

		const scene = gltf.scene;
		scene.updateMatrixWorld(true);

		let meshes = 0;
		let vertices = 0;
		scene.traverse((obj) => {
			const mesh = obj as {
				isMesh?: boolean;
				geometry?: THREE.BufferGeometry;
			};
			if (mesh.isMesh && mesh.geometry) {
				meshes++;
				vertices += mesh.geometry.attributes.position?.count ?? 0;
			}
		});
		if (meshes === 0 || vertices === 0) {
			throw new Error("No mesh geometry found in the model");
		}
		if (vertices > req.maxVertices) {
			throw new Error(
				`Model too large to convert: ${vertices.toLocaleString()} vertices (limit ${req.maxVertices.toLocaleString()})`,
			);
		}
		ctx.postMessage({
			type: "scan",
			id: req.id,
			meshes,
			vertices,
		});

		// glTF is meters by spec; STL/OBJ carry no units and 3D printers
		// assume mm — scale into the requested target unit
		const factor = UNIT_FACTOR[req.units];
		const scaled = scene.clone(true);
		scaled.scale.setScalar(factor);
		scaled.updateMatrixWorld(true);

		if (req.to === "stl") {
			const { STLExporter } = await import(
				"three/examples/jsm/exporters/STLExporter.js"
			);
			const dataView = new STLExporter().parse(scaled, {
				binary: true,
			}) as DataView;
			const bytes = new Uint8Array(
				dataView.buffer,
				dataView.byteOffset,
				dataView.byteLength,
			);
			ctx.postMessage({ type: "finished", output: bytes, id: req.id }, [
				bytes.buffer,
			]);
		} else {
			const { OBJExporter } = await import(
				"three/examples/jsm/exporters/OBJExporter.js"
			);
			const text = new OBJExporter().parse(scaled);
			ctx.postMessage({
				type: "finished",
				output: new TextEncoder().encode(text),
				id: req.id,
			});
		}
	} catch (err) {
		ctx.postMessage({
			type: "error",
			error: err instanceof Error ? err.message : String(err),
			id: req.id,
		});
	}
};
