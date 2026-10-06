// Probe which INPUT document types the installed mupdf wasm build can open
// (pdf render worker hardcodes application/pdf today).
import { readFileSync, writeFileSync } from "node:fs";
import { zipSync } from "fflate";

globalThis.$libmupdf_wasm_Module = {
	locateFile: () => new URL("../node_modules/mupdf/dist/mupdf-wasm.wasm", import.meta.url).href.replace("file:///", "file:///"),
};

const mupdf = await import("mupdf");
console.log("mupdf loaded:", typeof mupdf.Document.openDocument === "function");

const png = readFileSync(new URL("../static/favicon.png", import.meta.url));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><text x="0" y="20">hello svg</text></svg>`;
const cbz = zipSync({ "1.png": new Uint8Array(png) });

const cases = [
	["pdf  ", new Uint8Array(png.subarray(0, 0)), null], // placeholder, replaced below
].slice(0, 0);
const tests = [
	["cbz  ", new Uint8Array(cbz), "application/vnd.comicbook+zip"],
	["svg  ", new TextEncoder().encode(svg), "image/svg+xml"],
	["epub ", null, "application/epub+zip"],
	["mobi ", null, "application/x-mobipocket-ebook"],
];

// build a minimal epub (mimetype must be first & stored)
const xhtml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>hello epub</p></body></html>`;
const container = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>t</dc:title><dc:identifier id="id">x</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c1"/></spine></package>`;
const epubBuf = zipSync(
	{
		"mimetype": new TextEncoder().encode("application/epub+zip"),
		"META-INF/container.xml": new TextEncoder().encode(container),
		"OEBPS/content.opf": new TextEncoder().encode(opf),
		"OEBPS/c1.xhtml": new TextEncoder().encode(xhtml),
		"OEBPS/nav.xhtml": new TextEncoder().encode(xhtml),
	},
	{ level: 0 },
);
const inputs = new Map(tests.map((t) => [t[0], t]));
inputs.get("epub ")[1] = new Uint8Array(epubBuf);

for (const [label, buf, magic] of tests) {
	if (!buf) {
		console.log(`${label} SKIP (no test data)`);
		continue;
	}
	try {
		const doc = mupdf.Document.openDocument(buf, magic);
		const n = doc.countPages();
		// try pulling text off the first page to prove the pipeline end-to-end
		let text = "";
		try {
			const page = doc.loadPage(0);
			text = page.toStructuredText("preserve-whitespace").asText().trim().slice(0, 40);
			page.destroy();
		} catch {}
		console.log(`${label} OPEN-OK pages=${n} text=${JSON.stringify(text)}`);
		doc.destroy();
	} catch (e) {
		console.log(`${label} FAIL ${String(e).slice(0, 90)}`);
	}
}
