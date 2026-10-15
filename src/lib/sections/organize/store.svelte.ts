import { browser } from "$app/environment";
import { log } from "$lib/util/logger";
import { files } from "$lib/store/index.svelte";
import { VertFile } from "$lib/types";
import MuPDFWorker from "$lib/workers/mupdf?worker&url";
import PdfRenderWorker from "$lib/workers/pdf-render?worker&url";

export interface OrganizePage {
	/** zero-based index in the SOURCE pdf */
	src: number;
	/** clockwise degrees stored on the page (0/90/180/270) */
	rotation: number;
}

type OrganizeOp =
	| { type: "move"; from: number; to: number }
	| { type: "rotate"; index: number; prev: number }
	| { type: "delete"; index: number; page: OrganizePage };

const THUMB_SCALE = 0.35; // ~100-160px wide thumbnails at 72dpi
// coalesce window for thumbnail requests (one document clone per batch)
const THUMB_BATCH_MS = 120;
const MAX_UNDO = 50;

class OrganizeStore {
	public fileName = $state("");
	/** source pdf bytes (already decrypted when the file was locked) */
	public data = $state<ArrayBuffer | null>(null);
	public pageCount = $state(0);
	/** visible page plan — reorder/rotate/delete state */
	public pages = $state<OrganizePage[]>([]);
	/** object URLs per source page index (rendered lazily) */
	public thumbs = $state<Record<number, string>>({});
	public processing = $state(false);
	public result = $state<VertFile | null>(null);

	private undoStack: OrganizeOp[] = [];
	private thumbWorker: Worker | null = null;
	private requested = new Set<number>();

	public get canUndo() {
		return this.undoStack.length > 0;
	}

	/** Load a PDF (probing encryption through the shared unlock flow). */
	public async load(file: File): Promise<boolean> {
		this.reset();
		if (!browser) return false;
		let data: ArrayBuffer = await file.arrayBuffer();
		let pageCount: number | null = null;
		try {
			pageCount = await this.probe(data);
		} catch (err) {
			if (!String(err).includes("PASSWORD_REQUIRED")) {
				log(["organize"], `probe failed: ${err}`);
				return false;
			}
			// locked pdf opens the shared password modal (store flow)
			const dec = await files.awaitUnlock(file.name, "", data);
			if (!dec) return false; // user cancelled
			data = dec;
			try {
				pageCount = await this.probe(data);
			} catch (err2) {
				log(["organize"], `probe failed: ${err2}`);
				return false;
			}
		}
		if (!pageCount) return false;
		this.fileName = file.name;
		this.data = data;
		this.pageCount = pageCount;
		this.pages = Array.from({ length: pageCount }, (_, i) => ({
			src: i,
			rotation: 0,
		}));
		return true;
	}

	/**
	 * decrypted-or-plain probe: opens the doc and returns its page count.
	 * Rejects with the worker error string (PASSWORD_REQUIRED for locked
	 * pdfs probed without a password).
	 */
	private probe(data: ArrayBuffer): Promise<number | null> {
		return new Promise((resolve, reject) => {
			const worker = new Worker(MuPDFWorker, { type: "module" });
			const timeout = setTimeout(() => {
				worker.terminate();
				resolve(null);
			}, 30000);
			const done = (fn: () => void) => {
				clearTimeout(timeout);
				worker.terminate();
				fn();
			};
			worker.onmessage = (e: MessageEvent) => {
				if (e.data.type === "error") {
					log(["organize"], `probe failed: ${e.data.error}`);
					done(() => reject(new Error(String(e.data.error))));
					return;
				}
				done(() => resolve((e.data.pageCount as number) ?? null));
			};
			worker.onerror = () => {
				done(() => reject(new Error("worker crashed")));
			};
			worker.postMessage({
				type: "decrypt",
				id: "probe",
				data: new Uint8Array(data),
				password: undefined,
			});
		});
	}

	/** Queue one thumbnail for lazy rendering (IntersectionObserver).
	 * Requests landing in the same frame are flushed as ONE render job with
	 * an explicit page list — each job structured-clones the document once
	 * instead of once per page. */
	public requestThumb(src: number) {
		if (
			!browser ||
			!this.data ||
			this.thumbs[src] ||
			this.requested.has(src)
		)
			return;
		this.requested.add(src);
		this.thumbBatch.add(src);
		if (this.thumbFlush !== null) return;
		this.thumbFlush = window.setTimeout(() => {
			this.thumbFlush = null;
			this.flushThumbBatch();
		}, THUMB_BATCH_MS);
	}

	private thumbBatch = new Set<number>();
	private thumbFlush: number | null = null;

	private flushThumbBatch() {
		if (!this.data || this.thumbBatch.size === 0) return;
		const pages = [...this.thumbBatch].sort((a, b) => a - b);
		this.thumbBatch.clear();
		try {
			if (!this.thumbWorker)
				this.thumbWorker = new Worker(PdfRenderWorker, {
					type: "module",
				});
			const worker = this.thumbWorker;
			const id = `thumb-${pages[0]}-${pages.at(-1)}`;
			worker.postMessage({
				type: "render",
				id,
				data: new Uint8Array(this.data),
				sourceType: "application/pdf",
				format: "png",
				scale: THUMB_SCALE,
				range: pages,
			});
			const onMessage = (e: MessageEvent) => {
				if (e.data.id !== id) return;
				worker.removeEventListener("message", onMessage);
				if (e.data.type === "error") {
					log(["organize"], `thumb batch failed: ${e.data.error}`);
					// allow retries on the next intersection
					for (const p of pages) this.requested.delete(p);
					return;
				}
				if (e.data.type === "finished") {
					const outputs = e.data.output as {
						name: string;
						bytes: Uint8Array;
					}[];
					// outputs arrive in request order; page N is named
					// page_N+1.png
					for (let i = 0; i < pages.length; i++) {
						const bytes = outputs[i]?.bytes;
						if (!bytes) continue;
						this.thumbs[pages[i]] = URL.createObjectURL(
							new Blob([bytes as unknown as BlobPart], {
								type: "image/png",
							}),
						);
					}
				}
			};
			worker.addEventListener("message", onMessage);
		} catch (err) {
			log(["organize"], `thumb batch failed: ${err}`);
			for (const p of pages) this.requested.delete(p);
		}
	}

	// --- page-plan mutations (each pushes an inverse op) -------------------

	public move(index: number, dir: -1 | 1) {
		this.moveTo(index, index + dir);
	}

	public moveTo(index: number, to: number) {
		if (to < 0 || to >= this.pages.length || to === index) return;
		const next = [...this.pages];
		const [page] = next.splice(index, 1);
		next.splice(to, 0, page);
		this.pages = next;
		this.push({ type: "move", from: to, to: index });
	}

	public rotate(index: number) {
		const prev = this.pages[index].rotation;
		const next = [...this.pages];
		next[index] = {
			...next[index],
			rotation: (next[index].rotation + 90) % 360,
		};
		this.pages = next;
		this.push({ type: "rotate", index, prev });
	}

	public remove(index: number) {
		const page = this.pages[index];
		this.pages = this.pages.filter((_, i) => i !== index);
		this.push({ type: "delete", index, page });
	}

	public undo() {
		const op = this.undoStack.pop();
		if (!op) return;
		const next = [...this.pages];
		if (op.type === "move") {
			const [page] = next.splice(op.from, 1);
			next.splice(op.to, 0, page);
		} else if (op.type === "rotate") {
			next[op.index] = { ...next[op.index], rotation: op.prev };
		} else {
			next.splice(op.index, 0, op.page);
		}
		this.pages = next;
	}

	private push(op: OrganizeOp) {
		this.undoStack.push(op);
		if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
	}

	public reset() {
		for (const url of Object.values(this.thumbs)) URL.revokeObjectURL(url);
		if (this.thumbFlush !== null) window.clearTimeout(this.thumbFlush);
		this.thumbFlush = null;
		this.thumbBatch.clear();
		this.undoStack = [];
		this.requested.clear();
		this.fileName = "";
		this.data = null;
		this.pageCount = 0;
		this.pages = [];
		this.thumbs = {};
		this.result = null;
		// also frees the (possibly decrypted) source bytes and the render
		// worker — safe on page teardown and at the start of a new load
		this.thumbWorker?.terminate();
		this.thumbWorker = null;
	}

	/** Export the plan: pdf-lib copyPages in visible order + rotations. */
	public async export(): Promise<VertFile | null> {
		if (!this.data || this.pages.length === 0) return null;
		this.processing = true;
		this.result = null;
		try {
			const { PdfLibConverter } = await import(
				"$lib/converters/pdf-lib.svelte"
			);
			const pdfLib = new PdfLibConverter();
			const src = new VertFile(
				new File([this.data], this.fileName || "document.pdf"),
				".pdf",
			);
			const result = await pdfLib.convert(src, ".pdf", {
				op: "organize",
				plan: this.pages.map((p) => ({
					index: p.src,
					rotation: p.rotation,
				})),
			});
			this.result = result;
			// VertFile.download() reads this.result — self-reference so the
			// result panel's Download button works like the convert flow's
			result.result = result;
			return result;
		} finally {
			this.processing = false;
		}
	}
}

export const organize = new OrganizeStore();
