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
		try {
			const st = page.toStructuredText("preserve-whitespace");
			parts.push(mode === "html" ? st.asHTML(i) : st.asText());
		} finally {
			page.destroy();
		}
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
		try {
			const st = page.toStructuredText("preserve-whitespace");
			const parsed = JSON.parse(st.asJSON());
			blocks.push(...(parsed.blocks ?? []));
		} catch {
			// no structured text on this page; skip
		} finally {
			page.destroy();
		}
	}
	return blocks;
}

self.onmessage = async (e: MessageEvent) => {
	const job = e.data as {
		file?: File;
		to?: string;
		id: string;
		type?: "decrypt";
		data?: Uint8Array;
		password?: string;
	};
	const id = job.id;
	try {
		if (!mupdf) mupdf = await import("mupdf");

		// decrypt job: authenticate + produce decrypted PDF bytes for the
		// session cache (see store.decryptPdfBytes). password=undefined is a
		// probe: it only reports pageCount / throws PASSWORD_REQUIRED.
		if (job.type === "decrypt") {
			const bytes = new Uint8Array(job.data!);
			// openDocument is typed to return the base Document; for the pdf
			// mime it is always the PDF subclass (saveToBuffer lives there)
			const doc = mupdf.PDFDocument.openDocument(
				bytes,
				"application/pdf",
			) as import("mupdf").PDFDocument;
			try {
				if (doc.needsPassword()) {
					if (
						!job.password ||
						doc.authenticatePassword(job.password) === 0
					) {
						throw new Error(
							job.password
								? "WRONG_PASSWORD"
								: "PASSWORD_REQUIRED",
						);
					}
				}
				if (!job.password) {
					// probe only: readable without a password
					self.postMessage({
						type: "finished",
						output: null,
						pageCount: doc.countPages(),
						id: job.id,
					});
					return;
				}
				// mupdf write option: drop the encryption dictionary
				const out = doc.saveToBuffer("decrypt=1,garbage=1");
				self.postMessage({
					type: "finished",
					output: new Uint8Array(out.asUint8Array()),
					pageCount: doc.countPages(),
					id: job.id,
				});
			} finally {
				doc.destroy();
			}
			return;
		}

		const { file, to } = job as { file: File; to: string };
		const buf = new Uint8Array(await file.arrayBuffer());
		const doc = mupdf.Document.openDocument(buf, "application/pdf");
		const target = (to || ".txt").toLowerCase();

		let output: Uint8Array;
		try {
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
		} finally {
			doc.destroy();
		}

		self.postMessage({ type: "finished", output, id });
	} catch (err) {
		self.postMessage({ type: "error", error: String(err), id });
	}
};
