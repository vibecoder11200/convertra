import * as XLSX from "xlsx";
import * as zip from "client-zip";

interface ConvertRequest {
	type: "convert";
	id: string;
	data: Uint8Array;
	from: string; // source extension (".xlsx" | ".json" | ...)
	to: string; // ".csv" | ".tsv" | ".json" | ".html" | ".md" | ".xlsx" | ".ods"
}

const sanitizeSheetName = (name: string) =>
	name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "Sheet";

async function readWorkbook(
	data: Uint8Array,
	from: string,
): Promise<XLSX.WorkBook> {
	// JSON never sniffs correctly (it parses as garbage csv), so build the
	// sheet explicitly; everything else (xlsx/xls/ods/csv/tsv/html) goes
	// through SheetJS's container sniffing
	if (from === ".json") {
		const parsed = JSON.parse(new TextDecoder().decode(data));
		const wb = XLSX.utils.book_new();
		if (Array.isArray(parsed)) {
			const sheet =
				parsed.length > 0 && Array.isArray(parsed[0])
					? XLSX.utils.aoa_to_sheet(parsed)
					: XLSX.utils.json_to_sheet(parsed);
			XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
		} else if (parsed && typeof parsed === "object") {
			// { sheetName: records[] } -> one sheet per key
			for (const [name, records] of Object.entries(parsed)) {
				if (!Array.isArray(records)) {
					throw new Error(
						"JSON must be an array of records, an array of arrays, or an object of sheet-name -> array",
					);
				}
				XLSX.utils.book_append_sheet(
					wb,
					XLSX.utils.json_to_sheet(records),
					sanitizeSheetName(name),
				);
			}
			if (!wb.SheetNames.length)
				throw new Error("JSON object has no sheet arrays");
		} else {
			throw new Error(
				"JSON must be an array of records, an array of arrays, or an object of sheet-name -> array",
			);
		}
		return wb;
	}
	const wb = XLSX.read(data, { type: "array" });
	if (!wb.SheetNames.length) throw new Error("Workbook has no sheets");
	return wb;
}

function aoaToMarkdown(aoa: unknown[][]): string {
	if (aoa.length === 0) return "";
	const cell = (v: unknown) =>
		String(v ?? "").replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
	const rows = aoa.map((row) => row.map(cell));
	const width = Math.max(...rows.map((r) => r.length));
	const lines: string[] = [];
	const header = rows[0];
	while (header.length < width) header.push("");
	lines.push(`| ${header.join(" | ")} |`);
	lines.push(`| ${Array.from({ length: width }, () => "---").join(" | ")} |`);
	for (const row of rows.slice(1)) {
		while (row.length < width) row.push("");
		lines.push(`| ${row.join(" | ")} |`);
	}
	return `${lines.join("\n")}\n`;
}

async function handleConvert(req: ConvertRequest) {
	const wb = await readWorkbook(req.data, (req.from || "").toLowerCase());
	const to = req.to.toLowerCase();
	const multi = wb.SheetNames.length > 1;

	// spreadsheet -> spreadsheet: re-save the whole workbook (all sheets)
	if (to === ".xlsx" || to === ".ods") {
		const bookType = to === ".ods" ? "ods" : "xlsx";
		const out = XLSX.write(wb, { type: "array", bookType });
		self.postMessage({
			type: "finished",
			output: new Uint8Array(out),
			id: req.id,
		});
		return;
	}

	// tabular text targets: one sheet -> plain file, several sheets -> zip
	if (to === ".csv" || to === ".tsv") {
		const fs = to === ".tsv" ? "\t" : ",";
		const parts = wb.SheetNames.map((name) => ({
			name: `${sanitizeSheetName(name)}${to}`,
			text: XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: fs }),
		}));
		if (multi) {
			const zipped = zip.makeZip(
				parts.map((p) => ({
					name: p.name,
					input: new TextEncoder().encode(p.text),
				})),
			);
			const buf = new Uint8Array(await new Response(zipped).arrayBuffer());
			self.postMessage({
				type: "finished",
				output: buf,
				zip: true,
				id: req.id,
			});
			return;
		}
		self.postMessage({
			type: "finished",
			output: new TextEncoder().encode(parts[0].text),
			id: req.id,
		});
		return;
	}

	if (to === ".json") {
		if (multi) {
			const map: Record<string, unknown[]> = {};
			for (const name of wb.SheetNames) {
				map[name] = XLSX.utils.sheet_to_json(wb.Sheets[name]);
			}
			self.postMessage({
				type: "finished",
				output: new TextEncoder().encode(JSON.stringify(map, null, 2)),
				id: req.id,
			});
			return;
		}
		const records = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
		self.postMessage({
			type: "finished",
			output: new TextEncoder().encode(JSON.stringify(records, null, 2)),
			id: req.id,
		});
		return;
	}

	if (to === ".html") {
		const tables = wb.SheetNames.map((name) => {
			const title = multi
				? `<h2>${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h2>\n`
				: "";
			// sheet_to_html emits a full <html> document per sheet — keep
			// only its <table> so the sheets nest inside one document
			const full = XLSX.utils.sheet_to_html(wb.Sheets[name]);
			const table = full.match(/<table[\s\S]*<\/table>/i)?.[0] ?? full;
			return title + table;
		});
		self.postMessage({
			type: "finished",
			output: new TextEncoder().encode(
				`<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n${tables.join("\n")}\n</body></html>`,
			),
			id: req.id,
		});
		return;
	}

	if (to === ".md") {
		const tables = wb.SheetNames.map((name) => {
			const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], {
				header: 1,
			}) as unknown[][];
			const title = multi ? `## ${name}\n\n` : "";
			return title + aoaToMarkdown(aoa);
		});
		self.postMessage({
			type: "finished",
			output: new TextEncoder().encode(tables.join("\n")),
			id: req.id,
		});
		return;
	}

	throw new Error(`Unsupported spreadsheet target: ${to}`);
}

self.onmessage = async (e: MessageEvent<ConvertRequest>) => {
	try {
		await handleConvert(e.data);
	} catch (err) {
		self.postMessage({
			type: "error",
			error: String(err),
			id: e.data?.id,
		});
	}
};
