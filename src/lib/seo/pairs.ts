/**
 * Curated conversion-pair registry driving the programmatic SEO landing
 * pages (/convert/[pair]), the generated sitemap, and the related-pairs
 * internal links.
 *
 * Wave discipline (phase plan): this is a curated list, not every resolvable
 * combination — each entry is a real search intent, and pairs that have no
 * client-side path yet are gated behind `requires` so they stay out of
 * routes and the sitemap until the capability ships.
 */

export interface PairFaq {
	q: string;
	a: string;
}

export interface ConversionPair {
	/** URL segment, e.g. "heic-to-jpg" */
	slug: string;
	/** source extension without the dot */
	from: string;
	/** target extension without the dot */
	to: string;
	/** meta description override (titles are composed from format names) */
	description?: string;
	/** hand-written FAQ entries appended before the generic ones */
	faq?: PairFaq[];
	/** capability gate: excluded from routes + sitemap until shipped */
	requires?: "phase9";
}

/** Human display names for titles/FAQ copy. */
export const FORMAT_NAMES: Record<string, string> = {
	heic: "HEIC",
	heif: "HEIF",
	jpg: "JPG",
	jpeg: "JPG",
	jpe: "JPE",
	jfif: "JFIF",
	png: "PNG",
	webp: "WebP",
	avif: "AVIF",
	gif: "GIF",
	jxl: "JPEG XL",
	bmp: "BMP",
	tiff: "TIFF",
	svg: "SVG",
	pdf: "PDF",
	docx: "Word (DOCX)",
	html: "HTML",
	md: "Markdown",
	txt: "plain text",
	rtf: "RTF",
	odt: "ODT",
	epub: "EPUB",
	cbz: "CBZ",
	zip: "ZIP",
	xlsx: "Excel (XLSX)",
	ods: "ODS",
	csv: "CSV",
	tsv: "TSV",
	json: "JSON",
	mp4: "MP4",
	webm: "WebM",
	mov: "MOV",
	mkv: "MKV",
	avi: "AVI",
	mp3: "MP3",
	wav: "WAV",
	ogg: "OGG",
	opus: "Opus",
	flac: "FLAC",
	m4a: "M4A",
	aac: "AAC",
};

export const formatName = (ext: string): string =>
	FORMAT_NAMES[ext.toLowerCase()] ?? ext.toUpperCase();

export const CONVERSION_PAIRS: ConversionPair[] = [
	// --- HEIC (Phase 1) ------------------------------------------------------
	{
		slug: "heic-to-jpg",
		from: "heic",
		to: "jpg",
		description:
			"Convert iPhone HEIC photos to JPG right in your browser. Free, no upload — files never leave your device.",
		faq: [
			{
				q: "Will converting HEIC to JPG reduce photo quality?",
				a: "JPG is a lossy format, so a small amount of compression is unavoidable. Convertra encodes at high quality by default, and for most photos the difference is invisible. Convert to PNG instead if you need a mathematically lossless copy.",
			},
			{
				q: "Why can't my Windows or Android phone open HEIC files?",
				a: "HEIC is Apple's default photo format. Windows 10/11 and most Android versions need a paid codec or a newer release to display it. JPG is the universal alternative — every device and app can read it.",
			},
		],
	},
	{ slug: "heic-to-png", from: "heic", to: "png" },
	{
		slug: "heic-to-pdf",
		from: "heic",
		to: "pdf",
		description:
			"Turn iPhone HEIC photos into a PDF document without uploading them. Multi-frame bursts become multi-page PDFs.",
		faq: [
			{
				q: "What happens to burst photos or Live Photos?",
				a: "A HEIC file can hold several frames. Convertra converts every frame and assembles them as one PDF page per frame, in order.",
			},
		],
	},
	{ slug: "heic-to-webp", from: "heic", to: "webp" },

	// --- image ⇄ image (ImageMagick) ----------------------------------------
	{ slug: "webp-to-jpg", from: "webp", to: "jpg" },
	{ slug: "webp-to-png", from: "webp", to: "png" },
	{ slug: "jpg-to-webp", from: "jpg", to: "webp" },
	{ slug: "jpg-to-png", from: "jpg", to: "png" },
	{ slug: "png-to-jpg", from: "png", to: "jpg" },
	{ slug: "png-to-webp", from: "png", to: "webp" },
	{ slug: "avif-to-jpg", from: "avif", to: "jpg" },
	{ slug: "avif-to-png", from: "avif", to: "png" },
	{ slug: "jpg-to-avif", from: "jpg", to: "avif" },
	{ slug: "png-to-avif", from: "png", to: "avif" },

	// --- image ⇄ pdf (pdf-lib / pdf-render) ----------------------------------
	{
		slug: "jpg-to-pdf",
		from: "jpg",
		to: "pdf",
		description:
			"Combine JPG photos into a PDF document locally in your browser — nothing is uploaded to a server.",
	},
	{ slug: "png-to-pdf", from: "png", to: "pdf" },
	{
		slug: "pdf-to-jpg",
		from: "pdf",
		to: "jpg",
		description:
			"Render every PDF page to a JPG image in your browser. Pages are rasterized locally with MuPDF — the document never leaves your device.",
	},
	{ slug: "pdf-to-png", from: "pdf", to: "png" },

	// --- pdf / document (mupdf → pandoc, pdf-render) -------------------------
	{
		slug: "pdf-to-word",
		from: "pdf",
		to: "docx",
		description:
			"Extract the text of a PDF into an editable Word document, entirely on your device. Best for text-first PDFs, not scans.",
		faq: [
			{
				q: "Why does my PDF converted to Word lose its layout?",
				a: 'PDF stores where each glyph sits, not the document structure, so the text must be re-typeset. Columns and complex tables may shift. For scanned PDFs there is no text to extract — enable the "Scanned document" option to run on-device OCR instead.',
			},
		],
	},
	{ slug: "pdf-to-text", from: "pdf", to: "txt" },
	{ slug: "pdf-to-epub", from: "pdf", to: "epub" },
	{
		slug: "epub-to-pdf",
		from: "epub",
		to: "pdf",
		description:
			"Convert EPUB ebooks to PDF with a selectable page size (A4, Letter, A5) — rendered locally, no upload.",
	},
	{ slug: "cbz-to-pdf", from: "cbz", to: "pdf" },
	{ slug: "pdf-to-cbz", from: "pdf", to: "cbz" },

	// --- documents (pandoc) ---------------------------------------------------
	{ slug: "docx-to-md", from: "docx", to: "md" },
	{ slug: "md-to-docx", from: "md", to: "docx" },
	{ slug: "docx-to-html", from: "docx", to: "html" },
	{ slug: "html-to-md", from: "html", to: "md" },

	// --- spreadsheets (sheetjs) ----------------------------------------------
	{
		slug: "xlsx-to-csv",
		from: "xlsx",
		to: "csv",
		description:
			"Export Excel workbooks to CSV in your browser — each sheet becomes a file, nothing is uploaded.",
	},
	{ slug: "xlsx-to-json", from: "xlsx", to: "json" },
	{ slug: "csv-to-xlsx", from: "csv", to: "xlsx" },

	// --- audio / video (ffmpeg, webcodecs, vertd) -----------------------------
	{
		slug: "mp4-to-gif",
		from: "mp4",
		to: "gif",
		description:
			"Turn a short MP4 clip into an animated GIF without uploading the video. Trim and set fps/width before converting.",
	},
	{ slug: "gif-to-mp4", from: "gif", to: "mp4" },
	{ slug: "mov-to-mp4", from: "mov", to: "mp4" },
	{ slug: "mp4-to-webm", from: "mp4", to: "webm" },
	{ slug: "wav-to-mp3", from: "wav", to: "mp3" },
	{ slug: "mp3-to-wav", from: "mp3", to: "wav" },
	{ slug: "opus-to-mp3", from: "opus", to: "mp3" },

	// --- gated until Phase 9 (LibreOffice server) ships a real path ----------
	{
		slug: "docx-to-pdf",
		from: "docx",
		to: "pdf",
		requires: "phase9",
	},
	{
		slug: "xlsx-to-pdf",
		from: "xlsx",
		to: "pdf",
		requires: "phase9",
	},
];

/** Pairs that have a shippable client-side path today. */
export const activePairs = (): ConversionPair[] =>
	CONVERSION_PAIRS.filter((p) => !p.requires);

export const getPair = (slug: string): ConversionPair | undefined =>
	CONVERSION_PAIRS.find((p) => p.slug === slug);

/** Sitemap-worthy pages: home, app, statics, then every active pair. */
export const sitemapPaths = (): { path: string; priority: string }[] => [
	{ path: "/", priority: "1.00" },
	{ path: "/convert/", priority: "0.80" },
	{ path: "/settings/", priority: "0.50" },
	{ path: "/about/", priority: "0.60" },
	{ path: "/privacy/", priority: "0.50" },
	...activePairs().map((p) => ({
		path: `/convert/${p.slug}/`,
		priority: "0.80",
	})),
];

export const composeTitle = (pair: ConversionPair): string =>
	`${formatName(pair.from)} to ${formatName(pair.to)} — Free online converter | Convertra`;

export const composeDescription = (pair: ConversionPair): string =>
	pair.description ??
	`Convert ${formatName(pair.from)} files to ${formatName(
		pair.to,
	)} instantly in your browser. Free and private — your files never leave your device.`;

/**
 * Related pairs: same source first (strongest internal-link signal), then
 * same target, capped.
 */
export const relatedPairs = (
	pair: ConversionPair,
	cap = 6,
): ConversionPair[] => {
	const active = activePairs().filter((p) => p.slug !== pair.slug);
	const sameFrom = active.filter((p) => p.from === pair.from);
	const sameTo = active.filter((p) => p.to === pair.to);
	const rest = active.filter((p) => p.from !== pair.from && p.to !== pair.to);
	return [...sameFrom, ...sameTo, ...rest].slice(0, cap);
};
