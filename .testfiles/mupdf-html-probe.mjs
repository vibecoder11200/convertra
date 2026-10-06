// Probe mupdf asHTML structure on a real PDF (built with pdf-lib),
// to design the mini html->md converter against actual output.
globalThis.$libmupdf_wasm_Module = {
	locateFile: () =>
		new URL("../node_modules/mupdf/dist/mupdf-wasm.wasm", import.meta.url)
			.href,
};

const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
for (let p = 0; p < 2; p++) {
	const page = pdf.addPage([595, 842]);
	page.drawText(`Heading on page ${p + 1}`, {
		x: 72,
		y: 760,
		size: 24,
		font: bold,
		color: rgb(0, 0, 0),
	});
	page.drawText("Regular body text with some words.", {
		x: 72,
		y: 700,
		size: 12,
		font,
	});
	page.drawText("A bold word and an italic word.", {
		x: 72,
		y: 680,
		size: 12,
		font: bold,
	});
}
const pdfBytes = new Uint8Array(await pdf.save());

const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
const page = doc.loadPage(0);
const st = page.toStructuredText("preserve-whitespace");

console.log("=== asHTML (first 1200 chars) ===");
console.log(st.asHTML(0).slice(0, 1200));
console.log("\n=== asText (first 300 chars) ===");
console.log(st.asText().slice(0, 300));
console.log("\n=== asJSON (first 600 chars) ===");
console.log(st.asJSON().slice(0, 600));
page.destroy();
doc.destroy();
