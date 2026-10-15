// Copies the tesseract.js runtime assets (core wasm variants + nested
// worker script) from node_modules into static/tessdata/ and verifies the
// committed language data. Same pattern as the mupdf/libheif postinstall
// copies: assets are self-hosted same-origin, never fetched from a CDN.
// Fails loudly so CI catches upstream layout drift.
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = join(root, "static", "tessdata");

const CORE_FILES = [
	"tesseract-core-lstm.wasm.js",
	"tesseract-core-lstm.wasm",
	"tesseract-core-simd-lstm.wasm.js",
	"tesseract-core-simd-lstm.wasm",
	"tesseract-core-relaxedsimd-lstm.wasm.js",
	"tesseract-core-relaxedsimd-lstm.wasm",
];
const WORKER_FILE = "worker.min.js";

function fail(msg) {
	console.error(`[setup-tessdata] FATAL: ${msg}`);
	process.exit(1);
}

mkdirSync(dest, { recursive: true });

const coreDir = join(root, "node_modules", "tesseract.js-core");
if (!existsSync(coreDir)) fail("tesseract.js-core is not installed");
for (const f of CORE_FILES) {
	const src = join(coreDir, f);
	if (!existsSync(src)) fail(`missing core artifact: ${f}`);
	copyFileSync(src, join(dest, f));
}

const workerSrc = join(
	root,
	"node_modules",
	"tesseract.js",
	"dist",
	WORKER_FILE,
);
if (!existsSync(workerSrc)) fail(`missing ${WORKER_FILE} in tesseract.js`);
copyFileSync(workerSrc, join(dest, WORKER_FILE));

// langs.json: sha256 manifest of the language data actually shipped, so the
// client can verify what it cached/read
const langs = {};
for (const lang of ["eng", "vie"]) {
	const p = join(dest, `${lang}.traineddata.gz`);
	if (!existsSync(p)) fail(`missing language data: ${lang}.traineddata.gz`);
	const sha = createHash("sha256").update(readFileSync(p)).digest("hex");
	langs[lang] = { file: `${lang}.traineddata.gz`, sha256: sha };
}
writeFileSync(
	join(dest, "langs.json"),
	JSON.stringify(langs, null, "\t") + "\n",
);

console.log(
	`[setup-tessdata] ready: ${CORE_FILES.length + 1} runtime assets + ${Object.keys(langs).length} languages`,
);
