// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).$libmupdf_wasm_Module = {
	locateFile: () => "/mupdf-wasm.wasm",
};

import { structuredTextToMarkdown } from "$lib/util/structured-markdown";

let mupdf: typeof import("mupdf") | null = null;

interface StBlock {
	type: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	lines?: any[];
}

function pageText(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	doc: any,
	mode: "text" | "html",
): string[] {
	const parts: string[] = [];
	const pageCount = doc.countPages();
	for (let i = 0; i < pageCount; i++) {
		const page = doc.loadPage(i);
		const st = page.toStructuredText("preserve-whitespace");
		parts.push(mode === "html" ? st.asHTML(i) : st.asText());
		page.destroy();
	}
	return parts;
}

function pageStructuredBlocks(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	doc: any,
): StBlock[] {
	const blocks: StBlock[] = [];
	const pageCount = doc.countPages();
	for (let i = 0; i < pageCount; i++) {
		const page = doc.loadPage(i);
		const st = page.toStructuredText("preserve-whitespace");
		try {
			const parsed = JSON.parse(st.asJSON());
			blocks.push(...(parsed.blocks ?? []));
		} catch {
			// no structured text on this page; skip
		}
		page.destroy();
	}
	return blocks;
}

self.onmessage = async (e: MessageEvent) => {
	const { file, to, id } = e.data as { file: File; to: string; id: string };
	try {
		if (!mupdf) mupdf = await import("mupdf");

		const buf = new Uint8Array(await file.arrayBuffer());
		const doc = mupdf.Document.openDocument(buf, "application/pdf");
		const target = (to || ".txt").toLowerCase();

		let output: Uint8Array;
		if (target === ".html") {
			// per-page asHTML already carries positioning + font styling
			const parts = pageText(doc, "html");
			output = new TextEncoder().encode(
				`<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n${parts.join("\n")}\n</body></html>`,
			);
		} else if (target === ".md") {
			// structured markdown (headings from relative font size, list
			// bullets); scanned documents carry no text blocks, so fall back
			// to plain text (which is empty for those) rather than failing
			const md = structuredTextToMarkdown(pageStructuredBlocks(doc));
			output = new TextEncoder().encode(
				md !== "" ? md : pageText(doc, "text").join("\n\n"),
			);
		} else {
			// .txt (default)
			output = new TextEncoder().encode(
				pageText(doc, "text").join("\n\n"),
			);
		}

		doc.destroy();

		self.postMessage({ type: "finished", output, id });
	} catch (err) {
		self.postMessage({ type: "error", error: String(err), id });
	}
};
