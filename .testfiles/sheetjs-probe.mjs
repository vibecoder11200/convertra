// Round-trip probe for src/lib/workers/sheetjs.ts run in a real bun web
// worker: build a 2-sheet xlsx -> csv (expect zip of 2 csvs) -> read back ->
// xlsx; plus xlsx -> md/html/json single-shot checks.
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";

const work = mkdtempSync(join(tmpdir(), "sheetjs-probe-"));

// build test workbook with SheetJS directly
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
const xlsxBytes = new Uint8Array(
	XLSX.write(wb, { type: "array", bookType: "xlsx" }),
);
const xlsxPath = join(work, "test.xlsx");
writeFileSync(xlsxPath, xlsxBytes);

// csv -> xlsx round trip input
const csvBytes = new TextEncoder().encode("a,b\n1,2\n3,4\n");
const csvPath = join(work, "test.csv");
writeFileSync(csvPath, csvBytes);

const worker = new Worker(
	new URL("../src/lib/workers/sheetjs.ts", import.meta.url),
	{ type: "module" },
);
worker.addEventListener("error", (e) => {
	console.error("WORKER ERROR:", e.message ?? e);
	process.exit(1);
});

function run(data, from, to) {
	return new Promise((resolve, reject) => {
		const onMsg = (e) => {
			worker.removeEventListener("message", onMsg);
			resolve(e.data);
		};
		worker.addEventListener("message", onMsg);
		worker.postMessage({ type: "convert", id: "t", data, from, to });
		setTimeout(() => reject(new Error("timeout")), 30000);
	});
}

// 1) xlsx (2 sheets) -> csv -> expect zip with 2 entries
let res = await run(xlsxBytes, ".xlsx", ".csv");
if (res.type === "error") throw new Error(`csv: ${res.error}`);
if (!res.zip) throw new Error("expected zip for multi-sheet csv");
const entries = unzipSync(res.output);
console.log(
	"multi-sheet csv -> zip:",
	Object.keys(entries),
	JSON.stringify(new TextDecoder().decode(entries["Fruits.csv"])),
);

// 2) xlsx -> md
res = await run(xlsxBytes, ".xlsx", ".md");
if (res.type === "error") throw new Error(`md: ${res.error}`);
console.log("md:\n" + new TextDecoder().decode(res.output));

// 3) xlsx -> json (multi -> map)
res = await run(xlsxBytes, ".xlsx", ".json");
if (res.type === "error") throw new Error(`json: ${res.error}`);
console.log("json:", new TextDecoder().decode(res.output).slice(0, 120));

// 4) xlsx -> html
res = await run(xlsxBytes, ".xlsx", ".html");
if (res.type === "error") throw new Error(`html: ${res.error}`);
console.log("html head:", new TextDecoder().decode(res.output).slice(0, 90));

// 5) csv -> xlsx round trip
res = await run(csvBytes, ".csv", ".xlsx");
if (res.type === "error") throw new Error(`xlsx: ${res.error}`);
const back = XLSX.read(res.output, { type: "array" });
console.log(
	"csv -> xlsx sheets:",
	back.SheetNames,
	JSON.stringify(XLSX.utils.sheet_to_csv(back.Sheets[back.SheetNames[0]])),
);

// 6) csv -> tsv
res = await run(csvBytes, ".csv", ".tsv");
if (res.type === "error") throw new Error(`tsv: ${res.error}`);
console.log("tsv:", JSON.stringify(new TextDecoder().decode(res.output)));

// 7) xlsx -> ods
res = await run(xlsxBytes, ".xlsx", ".ods");
if (res.type === "error") throw new Error(`ods: ${res.error}`);
const odsBack = XLSX.read(res.output, { type: "array" });
console.log("ods round-trip sheets:", odsBack.SheetNames);

// 8) json records -> xlsx
const jsonBytes = new TextEncoder().encode(
	JSON.stringify([
		{ x: 1, y: "p" },
		{ x: 2, y: "q" },
	]),
);
res = await run(jsonBytes, ".json", ".xlsx");
if (res.type === "error") throw new Error(`json->xlsx: ${res.error}`);
const jback = XLSX.read(res.output, { type: "array" });
console.log(
	"json -> xlsx:",
	JSON.stringify(XLSX.utils.sheet_to_csv(jback.Sheets[jback.SheetNames[0]])),
);

worker.terminate();
console.log("ALL OK");
