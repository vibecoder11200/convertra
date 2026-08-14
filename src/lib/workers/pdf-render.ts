// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).$libmupdf_wasm_Module = {
	locateFile: () => "/mupdf-wasm.wasm",
};

interface RenderRequest {
	type: "render";
	id: string;
	data: Uint8Array;
	format: "png" | "jpeg" | "webp";
	scale: number; // render scale (1 = 72dpi, 2 = 144dpi, ...)
	range: "all" | { from: number; to: number };
}

function resolvePages(
	range: "all" | { from: number; to: number },
	total: number,
): number[] {
	if (range === "all") return Array.from({ length: total }, (_, i) => i);
	const from = Math.max(0, range.from);
	const to = Math.min(total - 1, range.to);
	return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

self.onmessage = async (e: MessageEvent<RenderRequest>) => {
	const req = e.data;
	try {
		let mupdf: typeof import("mupdf") | null = null;
		const loaded = (await import("mupdf")) as typeof import("mupdf");
		mupdf = loaded;

		const doc = mupdf.Document.openDocument(
			new Uint8Array(req.data),
			"application/pdf",
		);
		const total = doc.countPages();
		const pages = resolvePages(req.range, total);

		const outputs: { name: string; bytes: Uint8Array }[] = [];
		const matrix = mupdf.Matrix.scale(req.scale, req.scale);

		for (const p of pages) {
			const page = doc.loadPage(p);
			try {
				const pixmap = page.toPixmap(
					matrix,
					mupdf.ColorSpace.DeviceRGB,
					false,
				);
				const bytes = pixmap.asPNG();
				pixmap.destroy();
				outputs.push({
					name: `page_${p + 1}.png`,
					bytes: new Uint8Array(bytes),
				});
			} finally {
				page.destroy();
			}
		}
		doc.destroy();

		self.postMessage({
			type: "finished",
			output: outputs,
			zip: true,
			zipPrefix: "pdf",
			id: req.id,
		});
	} catch (err) {
		self.postMessage({ type: "error", error: String(err), id: req.id });
	}
};
