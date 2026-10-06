import { PDFDocument } from "pdf-lib";

interface MergeRequest {
	type: "merge";
	id: string;
	files: { name: string; data: Uint8Array }[];
}

interface SplitRequest {
	type: "split";
	id: string;
	data: Uint8Array;
	mode: "all" | { from: number; to: number };
}

interface CompressRequest {
	type: "compress";
	id: string;
	data: Uint8Array;
	quality: number; // 0-100
}

interface ImageToPdfRequest {
	type: "img2pdf";
	id: string;
	files: { name: string; data: Uint8Array }[];
}

type PdfJob = MergeRequest | SplitRequest | CompressRequest | ImageToPdfRequest;

self.onmessage = async (e: MessageEvent<PdfJob>) => {
	const job = e.data;
	try {
		switch (job.type) {
			case "merge":
				await handleMerge(job);
				break;
			case "split":
				await handleSplit(job);
				break;
			case "compress":
				await handleCompress(job);
				break;
			case "img2pdf":
				await handleImageToPdf(job);
				break;
		}
	} catch (err) {
		self.postMessage({ type: "error", error: String(err), id: job.id });
	}
};

async function handleMerge(job: MergeRequest) {
	const merged = await PDFDocument.create();
	for (const file of job.files) {
		const src = await PDFDocument.load(file.data, {
			ignoreEncryption: true,
		});
		const pages = await merged.copyPages(src, src.getPageIndices());
		pages.forEach((p) => merged.addPage(p));
	}
	const bytes = await merged.save();
	self.postMessage({
		type: "finished",
		output: bytes,
		zip: false,
		id: job.id,
	});
}

async function handleSplit(job: SplitRequest) {
	const src = await PDFDocument.load(job.data, { ignoreEncryption: true });
	const total = src.getPageCount();

	const ranges: [number, number][] =
		job.mode === "all"
			? Array.from({ length: total }, (_, i) => [i, i])
			: [[Math.max(0, job.mode.from), Math.min(total - 1, job.mode.to)]];

	const outputs: { name: string; bytes: Uint8Array }[] = [];
	for (let i = 0; i < ranges.length; i++) {
		const [from, to] = ranges[i];
		const doc = await PDFDocument.create();
		const pages = await doc.copyPages(
			src,
			Array.from({ length: to - from + 1 }, (_, j) => from + j),
		);
		pages.forEach((p) => doc.addPage(p));
		const bytes = await doc.save();
		const label = ranges.length === 1 ? "pages" : `page_${from + 1}`;
		outputs.push({ name: `split_${label}.pdf`, bytes });
	}
	self.postMessage({
		type: "finished",
		output: outputs,
		zip: true,
		zipPrefix: "pdf",
		id: job.id,
	});
}

async function handleCompress(job: CompressRequest) {
	const src = await PDFDocument.load(job.data, { ignoreEncryption: true });
	// Object-level re-serialization: use the compress option. pdf-lib cannot
	// re-encode images, so this is best-effort ("fast"/object-level mode).
	const bytes = await src.save({ useObjectStreams: true });
	self.postMessage({
		type: "finished",
		output: bytes,
		zip: false,
		id: job.id,
	});
}

const isJpeg = (d: Uint8Array) =>
	d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff;
const isPng = (d: Uint8Array) =>
	d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47;

async function handleImageToPdf(job: ImageToPdfRequest) {
	const doc = await PDFDocument.create();
	for (const file of job.files) {
		let image;
		if (isJpeg(file.data)) {
			// embed JPEG bytes as-is (no re-encode loss)
			image = await doc.embedJpg(file.data);
		} else if (isPng(file.data)) {
			image = await doc.embedPng(file.data);
		} else {
			// any browser-decodable format (webp, gif, avif, bmp, ...)
			// goes through a canvas re-encode to png
			const blob = new Blob([file.data as unknown as BlobPart]);
			const bitmap = await createImageBitmap(blob);
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
			bitmap.close();
			const png = await canvas.convertToBlob({ type: "image/png" });
			image = await doc.embedPng(new Uint8Array(await png.arrayBuffer()));
		}
		// normalize pixel dimensions to pdf points at 96 dpi — otherwise a
		// 4000px photo produces a ~1.4m-wide page
		const pt = (px: number) => (px * 72) / 96;
		const page = doc.addPage([pt(image.width), pt(image.height)]);
		page.drawImage(image, {
			x: 0,
			y: 0,
			width: pt(image.width),
			height: pt(image.height),
		});
	}
	const bytes = await doc.save();
	self.postMessage({
		type: "finished",
		output: bytes,
		zip: false,
		id: job.id,
	});
}
