// Static routing simulation: re-implements findConverter (step 1 + chain)
// and the store _add default pick against the FormatInfo tables extracted
// from the converter sources, to verify the direction-aware fixes.
import { readFileSync } from "node:fs";

const FILES = {
	magick: "src/lib/converters/magick.svelte.ts",
	ffmpeg: "src/lib/converters/ffmpeg.svelte.ts",
	pandoc: "src/lib/converters/pandoc.svelte.ts",
	mupdf: "src/lib/converters/mupdf.svelte.ts",
	"pdf-lib": "src/lib/converters/pdf-lib.svelte.ts",
	"pdf-render": "src/lib/converters/pdf-render.svelte.ts",
	webcodecs: "src/lib/converters/video.svelte.ts",
	sheetjs: "src/lib/converters/sheetjs.svelte.ts",
};

const registry = []; // registry order = converters array order
for (const [name, path] of Object.entries(FILES)) {
	const src = readFileSync(path, "utf8");
	const re =
		/new FormatInfo\("([a-z0-9]+)"\s*,\s*(true|false)\s*,\s*(true|false)(?:\s*,\s*(true|false))?/g;
	const formats = [];
	let m;
	while ((m = re.exec(src))) {
		formats.push({
			name: `.${m[1]}`,
			from: m[2] === "true",
			to: m[3] === "true",
			native: m[4] === undefined ? true : m[4] === "true",
		});
	}
	registry.push({ name, formats });
}
// vertd disabled by default (PUB_DISABLE_ALL_EXTERNAL_REQUESTS=false but URL
// empty => valid() false; findConverter includes it only when added — skip)

function formatStrings(c) {
	return c.formats.map((f) => f.name);
}

// findConverter step 1 (direction-aware, post-fix)
function single(from, to) {
	return registry.find((c) => {
		if (!formatStrings(c).includes(from) || !formatStrings(c).includes(to))
			return false;
		const theirFrom = c.formats.find((f) => f.name === from && f.from);
		const theirTo = c.formats.find((f) => f.name === to && f.to);
		if (!theirFrom || !theirTo) return false;
		if (!theirFrom.native && !theirTo.native) return false;
		return true;
	});
}

// chain loop (unchanged upstream logic)
function chain(from, to) {
	const sourceClaimers = registry.filter((c) =>
		formatStrings(c).includes(from),
	);
	for (const a of sourceClaimers) {
		for (const fmt of a.formats) {
			if (!fmt.to) continue;
			const b = registry.find((c) => {
				const cFrom = c.formats.find(
					(f) => f.name === fmt.name && f.from,
				);
				const cTo = c.formats.find((f) => f.name === to && f.to);
				return cFrom && cTo;
			});
			if (b) return `${a.name}(->${fmt.name})+${b.name}`;
		}
	}
	return null;
}

function route(from, to) {
	const s = single(from, to);
	if (s) return `SINGLE:${s.name}`;
	const c = chain(from, to);
	return c ? `CHAIN:${c}` : "NONE";
}

const byNative = (format) => (a, b) => {
	const af = a.formats.find((f) => f.name === format);
	const bf = b.formats.find((f) => f.name === format);
	if (af && bf) {
		if (af.native === bf.native) return 0;
		return af.native ? -1 : 1;
	}
	return 0;
};

// store _add default pick (post-fix)
function defaultPick(format) {
	const readable = registry.filter((c) =>
		c.formats.find((f) => f.name === format && f.from),
	);
	const conv =
		readable.sort(byNative(format)).at(0) ??
		registry
			.slice()
			.sort(byNative(format))
			.find((c) => formatStrings(c).includes(format));
	if (!conv) return "none";
	const to = conv.formats.find((f) => f.name !== format && f.to)?.name;
	return `${conv.name} -> ${to}`;
}

let fail = 0;
const expect = (actual, prefix, label) => {
	const ok = actual.startsWith(prefix);
	if (!ok) fail++;
	console.log(
		`${ok ? "PASS" : "FAIL"}  ${label.padEnd(14)} = ${actual}${ok ? "" : `   (expected prefix ${prefix})`}`,
	);
};

// P0 regression: pdf -> image must hit pdf-render (not pdf-lib split)
expect(route(".pdf", ".png"), "SINGLE:pdf-render", "pdf->png");
expect(route(".pdf", ".jpeg"), "SINGLE:pdf-render", "pdf->jpeg");
expect(route(".pdf", ".webp"), "SINGLE:pdf-render", "pdf->webp");
// intended new routes
expect(route(".pdf", ".docx"), "CHAIN:mupdf", "pdf->docx");
expect(route(".pdf", ".pptx"), "CHAIN:mupdf", "pdf->pptx");
expect(route(".jpg", ".pdf"), "SINGLE:pdf-lib", "jpg->pdf");
expect(route(".png", ".pdf"), "SINGLE:pdf-lib", "png->pdf");
expect(route(".epub", ".pdf"), "SINGLE:pdf-render", "epub->pdf");
expect(route(".epub", ".png"), "SINGLE:pdf-render", "epub->png");
expect(route(".cbz", ".pdf"), "SINGLE:pdf-render", "cbz->pdf");
expect(route(".pdf", ".cbz"), "SINGLE:pdf-render", "pdf->cbz");
expect(route(".xlsx", ".csv"), "SINGLE:sheetjs", "xlsx->csv");
expect(route(".xlsx", ".md"), "SINGLE:sheetjs", "xlsx->md");
expect(route(".csv", ".xlsx"), "SINGLE:sheetjs", "csv->xlsx");
expect(route(".xls", ".json"), "SINGLE:sheetjs", "xls->json");
// must not change pre-existing routes
expect(route(".md", ".docx"), "SINGLE:pandoc", "md->docx");
expect(route(".md", ".pptx"), "SINGLE:pandoc", "md->pptx");
expect(route(".html", ".docx"), "SINGLE:pandoc", "html->docx");
expect(route(".csv", ".md"), "SINGLE:pandoc", "csv->md");
expect(route(".json", ".csv"), "SINGLE:pandoc", "json->csv");
expect(route(".png", ".jpg"), "SINGLE:magick", "png->jpg");
expect(route(".pdf", ".txt"), "SINGLE:mupdf", "pdf->txt");
expect(route(".pdf", ".md"), "SINGLE:mupdf", "pdf->md");
expect(route(".pdf", ".pdf"), "SINGLE:pdf-lib", "pdf->pdf (unchanged)");
expect(route(".mp4", ".gif"), "SINGLE:webcodecs", "mp4->gif");
expect(route(".webm", ".webm"), "SINGLE:webcodecs", "webm identity");
// phantoms must stay dead
expect(route(".png", ".cbz"), "CHAIN:pdf-lib", "png->cbz raster chain");
expect(route(".html", ".txt"), "NONE", "html->txt no route");

// store defaults (post-fix): md/html must go to pandoc, pdf to mupdf
expect(defaultPick(".md"), "pandoc -> .docx", "default .md");
expect(defaultPick(".html"), "pandoc -> .docx", "default .html");
expect(defaultPick(".pdf"), "mupdf ->", "default .pdf");
expect(defaultPick(".png"), "magick ->", "default .png");
expect(defaultPick(".xlsx"), "sheetjs ->", "default .xlsx");
expect(defaultPick(".epub"), "pandoc ->", "default .epub");
expect(defaultPick(".cbz"), "pdf-render ->", "default .cbz");

console.log(fail === 0 ? "\nROUTING OK" : `\n${fail} ROUTING FAILURES`);
process.exit(fail === 0 ? 0 : 1);
