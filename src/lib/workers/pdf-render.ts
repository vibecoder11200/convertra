// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).$libmupdf_wasm_Module = {
	locateFile: () => "/mupdf-wasm.wasm",
};

interface RenderRequest {
	type: "render";
	id: string;
	data: Uint8Array;
	sourceType:
		| "application/pdf"
		| "application/epub+zip"
		| "application/vnd.comicbook+zip";
	// "cbz" behaves like "png" (comic archives hold png pages)
	format: "png" | "jpeg" | "webp" | "pdf" | "cbz";
	scale: number; // render scale (1 = 72dpi, 2 = 144dpi, ...)
	quality?: number; // JPEG quality (0-100), default 85
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
			req.sourceType ?? "application/pdf",
		);
		const total = doc.countPages();
		const pages = resolvePages(req.range, total);

		const outputs: { name: string; bytes: Uint8Array }[] = [];
		const matrix = mupdf.Matrix.scale(req.scale, req.scale);

		// mupdf exports PNG and JPEG natively. WebP is not supported, so the
		// worker emits PNG and the converter transcodes to WebP via canvas.
		// The "pdf" target renders PNG pages and reassembles them into a
		// single PDF (one full-bleed page per source page).
		const emitFormat = req.format === "jpeg" ? "jpeg" : "png";

		for (const p of pages) {
			const page = doc.loadPage(p);
			try {
				const pixmap = page.toPixmap(
					matrix,
					mupdf.ColorSpace.DeviceRGB,
					false,
				);
				let bytes: Uint8Array;
				try {
					if (emitFormat === "jpeg") {
						bytes = new Uint8Array(
							pixmap.asJPEG(req.quality ?? 85),
						);
					} else {
						bytes = new Uint8Array(pixmap.asPNG());
					}
				} finally {
					pixmap.destroy();
				}
				// a failed page decode renders blank and encodes to nothing —
				// feeding zero bytes to pdf-lib/images produces cryptic
				// downstream errors, so fail with the page number instead
				if (bytes.length === 0) {
					throw new Error(
						`Page ${p + 1} could not be rendered to an image (undecodable or empty page content)`,
					);
				}
				outputs.push({
					name: `page_${p + 1}.${emitFormat}`,
					bytes,
				});
			} finally {
				page.destroy();
			}
		}
		doc.destroy();

		if (req.format === "pdf") {
			// assemble rendered pages into a single PDF
			const { PDFDocument } = await import("pdf-lib");
			const out = await PDFDocument.create();
			for (const part of outputs) {
				const img = await out.embedPng(part.bytes);
				const page = out.addPage([img.width, img.height]);
				page.drawImage(img, {
					x: 0,
					y: 0,
					width: img.width,
					height: img.height,
				});
			}
			const pdfBytes = await out.save();
			self.postMessage({
				type: "finished",
				output: pdfBytes,
				single: true,
				id: req.id,
			});
			return;
		}

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
