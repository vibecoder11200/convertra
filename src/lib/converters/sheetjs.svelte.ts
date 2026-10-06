import { VertFile } from "$lib/types";
import { Converter, FormatInfo } from "./converter.svelte";
import { browser } from "$app/environment";
import SheetjsWorker from "$lib/workers/sheetjs?worker&url";
import { baseName } from "$lib/util/pdf";

/**
 * Spreadsheet conversion via SheetJS (community edition). Pure JS — no WASM,
 * ready immediately; the worker chunk only downloads on first conversion.
 */
export class SheetjsConverter extends Converter {
	public name = "sheetjs";
	public ready = $state(false);

	private activeConversions = new Map<string, Worker>();

	constructor() {
		super(30);
		if (browser) this.status = "ready";
		this.clearTimeout();
	}

	public async convert(input: VertFile, to: string): Promise<VertFile> {
		const worker = new Worker(SheetjsWorker, { type: "module" });
		this.activeConversions.set(input.id, worker);

		const data = new Uint8Array(await input.file.arrayBuffer());
		worker.postMessage({
			type: "convert",
			id: input.id,
			data,
			from: input.from,
			to: to.startsWith(".") ? to : `.${to}`,
		});

		const result = await new Promise<{
			type: string;
			output?: Uint8Array;
			zip?: boolean;
			error?: string;
		}>((resolve) => {
			worker.onmessage = (e) => resolve(e.data);
			worker.onerror = (e) =>
				resolve({ type: "error", error: e.message });
		});

		worker.terminate();
		this.activeConversions.delete(input.id);

		if (result.type === "error") throw new Error(result.error);

		// multi-sheet csv/tsv arrives as a zip of per-sheet files
		const outTo = result.zip ? ".zip" : to.startsWith(".") ? to : `.${to}`;
		const name = `${baseName(input.name)}${outTo}`;
		return new VertFile(
			new File([result.output! as BlobPart], name),
			outTo,
		);
	}

	public async cancel(input: VertFile): Promise<void> {
		const worker = this.activeConversions.get(input.id);
		if (worker) {
			worker.terminate();
			this.activeConversions.delete(input.id);
		}
	}

	public supportedFormats = [
		// read + write (xlsx/ods re-save keeps every sheet)
		new FormatInfo("xlsx", true, true),
		new FormatInfo("ods", true, true),
		new FormatInfo("csv", true, true),
		new FormatInfo("tsv", true, true),
		// read-only sources
		new FormatInfo("xls", true, false),
		new FormatInfo("html", true, false), // html table input
		new FormatInfo("json", true, false), // array of records/arrays
		// output-only targets
		new FormatInfo("md", false, true), // markdown table
	];
}
