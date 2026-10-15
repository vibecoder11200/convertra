// Probe: does doc.layout(w, h, em) actually reflow an EPUB in this mupdf
// wasm build, and what page sizes result? Run: node .testfiles/epub-layout-probe.mjs
import { zipSync } from "fflate";

globalThis.$libmupdf_wasm_Module = {
	locateFile: () =>
		new URL(
			"../node_modules/mupdf/dist/mupdf-wasm.wasm",
			import.meta.url,
		).href.replace("file:///", "file:///"),
};

const mupdf = await import("mupdf");

// long-ish epub so reflow visibly changes page count
const paras = Array.from(
	{ length: 12 },
	(_, i) => `<p>Paragraph ${i + 1} with some running text to lay out.</p>`,
).join("\n");
const xhtml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><h1>Big Heading</h1>${paras}</body></html>`;
const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>t</dc:title><dc:identifier id="id">x</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>`;
const epub = zipSync(
	{
		mimetype: new TextEncoder().encode("application/epub+zip"),
		"META-INF/container.xml": new TextEncoder().encode(container),
		"OEBPS/content.opf": new TextEncoder().encode(opf),
		"OEBPS/c1.xhtml": new TextEncoder().encode(xhtml),
		"OEBPS/nav.xhtml": new TextEncoder().encode(xhtml),
	},
	{ level: 0 },
);

const doc = mupdf.Document.openDocument(
	new Uint8Array(epub),
	"application/epub+zip",
);
console.log("default pages:", doc.countPages());
const p0 = doc.loadPage(0);
console.log("default bounds [x0 y0 x1 y1]:", p0.getBounds());
p0.destroy();

for (const [label, w, h] of [
	["A4", 595, 842],
	["Letter", 612, 792],
	["A5", 420, 595],
]) {
	doc.layout(w, h, 12);
	const n = doc.countPages();
	const page = doc.loadPage(0);
	const b = page.getBounds();
	page.destroy();
	console.log(`${label} (${w}x${h}) pages=${n} bounds=`, b);
}

// sanity: layout on a fixed-layout doc (cbz) should throw or no-op
const { readFileSync } = await import("node:fs");
const png = readFileSync(new URL("../static/favicon.png", import.meta.url));
const cbzDoc = mupdf.Document.openDocument(
	new Uint8Array(zipSync({ "1.png": new Uint8Array(png) })),
	"application/vnd.comicbook+zip",
);
try {
	cbzDoc.layout(595, 842, 12);
	console.log("cbz layout: no-op OK, pages:", cbzDoc.countPages());
} catch (e) {
	console.log("cbz layout THROWS:", String(e).slice(0, 80));
}
cbzDoc.destroy();
doc.destroy();
