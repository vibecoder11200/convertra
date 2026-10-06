// Generate all e2e test fixtures into .testfiles/e2e/
import { writeFileSync, mkdirSync } from "node:fs";
import { zipSync } from "fflate";

const dir = ".testfiles/e2e";
mkdirSync(dir, { recursive: true });

// 1) EPUB: 2 pages of text
const xhtml = (title, body) =>
	`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;
const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const opf = (n) =>
	`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>E2E Book</dc:title><dc:identifier id="id">x</dc:identifier><dc:language>en</dc:language></metadata><manifest>${Array.from({ length: n }, (_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${Array.from({ length: n }, (_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`;
const epub = zipSync(
	{
		mimetype: new TextEncoder().encode("application/epub+zip"),
		"META-INF/container.xml": new TextEncoder().encode(container),
		"OEBPS/content.opf": new TextEncoder().encode(opf(2)),
		"OEBPS/nav.xhtml": new TextEncoder().encode(xhtml("nav", "toc")),
		"OEBPS/c0.xhtml": new TextEncoder().encode(
			xhtml("Chapter One", "Hello from epub chapter one."),
		),
		"OEBPS/c1.xhtml": new TextEncoder().encode(
			xhtml("Chapter Two", "Hello from epub chapter two."),
		),
	},
	{ level: 0 },
);
writeFileSync(`${dir}/sample.epub`, epub);

// 2) CBZ: two png pages (reuse repo test pngs, pad to valid minimal png)
const { PNG } = await import("pngjs").catch(() => ({ PNG: null }));
let png1, png2;
if (PNG) {
	// not installed in this repo — skip to fallback
}
// fallback: minimal 1x1 white PNGs (hardcoded valid png bytes)
const minPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
	"base64",
);
const cbz = zipSync({
	"page_1.png": new Uint8Array(minPng),
	"page_2.png": new Uint8Array(minPng),
});
writeFileSync(`${dir}/comics.cbz`, cbz);

// 3) XLSX: 2 sheets
const XLSX = await import("xlsx");
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
	wb,
	XLSX.utils.aoa_to_sheet([
		["name", "qty"],
		["apple", 3],
		["pear", 7],
	]),
	"Fruits",
);
XLSX.utils.book_append_sheet(
	wb,
	XLSX.utils.aoa_to_sheet([
		["city", "pop"],
		["Hanoi", 8],
	]),
	"Cities",
);
writeFileSync(
	`${dir}/book.xlsx`,
	new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })),
);

// 4) PDF: heading + body + bullets (for pdf->md/docx/pptx/png)
const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
const pdf = await PDFDocument.create();
const body = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const page = pdf.addPage([595, 842]);
page.drawText("Quarterly Report", { x: 72, y: 760, size: 26, font: bold, color: rgb(0, 0, 0) });
page.drawText("Summary of Results", { x: 72, y: 700, size: 15, font: bold, color: rgb(0, 0, 0) });
page.drawText("Revenue grew by twelve percent year over year.", { x: 72, y: 680, size: 11, font: body, color: rgb(0, 0, 0) });
page.drawText("- First bullet point", { x: 72, y: 650, size: 11, font: body, color: rgb(0, 0, 0) });
page.drawText("- Second bullet point", { x: 72, y: 635, size: 11, font: body, color: rgb(0, 0, 0) });
page.drawText("Next Steps", { x: 72, y: 600, size: 14, font: bold, color: rgb(0, 0, 0) });
page.drawText("Expand the pilot program to new markets.", { x: 72, y: 580, size: 11, font: body, color: rgb(0, 0, 0) });
writeFileSync(`${dir}/doc.pdf`, new Uint8Array(await pdf.save()));

// 5) CSV
writeFileSync(`${dir}/sheet.csv`, "a,b\n1,2\n3,4\n");

// 6) MD
writeFileSync(
	`${dir}/notes.md`,
	"# Talk Title\n\n## Point One\n\nSome words here.\n\n- alpha\n- beta\n",
);

console.log("fixtures written to", dir);
