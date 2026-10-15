// OCR worker: owns the tesseract.js instance for one recognition job.
// Every asset is same-origin under /tessdata/ (core wasm variants, the
// nested tesseract worker script, and the language data) — the air-gapped
// build makes no request beyond the app origin. Cancellation is handled by
// the converter terminating this worker (which kills the nested tesseract
// worker with it).

import { createWorker } from "tesseract.js";

interface OcrRequest {
	type: "recognize";
	id: string;
	images: { name: string; data: Uint8Array }[];
	lang: string; // "eng" | "vie" | "eng+vie"
}

self.onmessage = async (e: MessageEvent<OcrRequest>) => {
	const req = e.data;
	if (req.type !== "recognize") return;
	const post = (msg: unknown) => self.postMessage(msg);
	try {
		const worker = await createWorker(req.lang, 1, {
			workerPath: "/tessdata/worker.min.js",
			corePath: "/tessdata",
			langPath: "/tessdata",
			workerBlobURL: false,
			logger: (m: { status: string; progress: number }) => {
				if (m.status === "recognizing text") {
					post({
						type: "page-progress",
						id: req.id,
						value: m.progress,
					});
				}
			},
		});
		try {
			const parts: string[] = [];
			for (let i = 0; i < req.images.length; i++) {
				post({
					type: "page",
					id: req.id,
					index: i,
					total: req.images.length,
				});
				const { data } = await worker.recognize(
					// tesseract's ImageLike wants Buffer|Blob|ImageData etc. —
					// hand it a Blob view of the raw bytes
					new Blob([req.images[i].data as unknown as BlobPart]),
				);
				parts.push(data.text);
			}
			post({
				type: "finished",
				id: req.id,
				pages: parts,
			});
		} finally {
			await worker.terminate();
		}
	} catch (err) {
		post({ type: "error", id: req.id, error: String(err) });
	}
};
