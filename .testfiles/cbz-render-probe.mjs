// Reproduce cbz -> pdf pipeline headlessly: open cbz with mupdf, render
// pages to PNG, assemble with pdf-lib — same as workers/pdf-render.ts.
globalThis.$libmupdf_wasm_Module = {
	locateFile: () =>
		new URL("../node_modules/mupdf/dist/mupdf-wasm.wasm", import.meta.url)
			.href,
};
const { readFileSync } = await import("node:fs");
const mupdf = await import("mupdf");
const { PDFDocument } = await import("pdf-lib");

const buf = new Uint8Array(readFileSync(".testfiles/e2e/comics.cbz"));
const doc = mupdf.Document.openDocument(buf, "application/vnd.comicbook+zip");
const total = doc.countPages();
console.log("pages:", total);
const matrix = mupdf.Matrix.scale(2, 2);
const outputs = [];
for (let p = 0; p < total; p++) {
	const page = doc.loadPage(p);
	const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
	const bytes = new Uint8Array(pixmap.asPNG());
	console.log(
		`page ${p + 1}: ${bytes.length} bytes head=${JSON.stringify(bytes.subarray(0, 8).toString("latin1"))}`,
	);
	outputs.push(bytes);
	page.destroy();
}
doc.destroy();

const out = await PDFDocument.create();
for (const bytes of outputs) {
	const img = await out.embedPng(bytes);
	const page = out.addPage([img.width, img.height]);
	page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
}
const saved = await out.save();
console.log("assembled PDF bytes:", saved.length);
