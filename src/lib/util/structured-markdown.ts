interface StLine {
	text: string;
	font?: { size?: number; weight?: string; style?: string };
}

interface StBlock {
	type: string;
	lines?: StLine[];
}

const BULLET_RE = /^[•‣⁃·▪○◦*\-–—]\s+/;

/**
 * Build markdown from mupdf structured-text blocks. Heading levels come from
 * the ratio of a line's font size to the document's body size (the most
 * common size), so it adapts to any base point size. Returns "" when the
 * document carries no text blocks (e.g. scanned pages).
 */
export function structuredTextToMarkdown(blocks: StBlock[]): string {
	const textBlocks = blocks.filter(
		(b) => b.type === "text" && b.lines && b.lines.length > 0,
	);
	if (textBlocks.length === 0) return "";

	// body size = most common rounded font size across all lines
	const sizeCounts = new Map<number, number>();
	for (const b of textBlocks) {
		for (const line of b.lines ?? []) {
			if (typeof line.font?.size === "number") {
				const s = Math.round(line.font.size);
				sizeCounts.set(s, (sizeCounts.get(s) ?? 0) + 1);
			}
		}
	}
	let bodySize = 0;
	let bodyCount = 0;
	for (const [size, count] of sizeCounts) {
		if (count > bodyCount) {
			bodySize = size;
			bodyCount = count;
		}
	}

	const out: string[] = [];
	let prevWasBullet = false;
	// every entry is separated by a blank line except consecutive bullets,
	// which form one tight list (a list directly after a paragraph line is
	// read as lazy continuation by pandoc's markdown reader)
	const push = (entry: string, isBullet: boolean) => {
		if (out.length > 0 && !(isBullet && prevWasBullet)) out.push("");
		out.push(entry);
		prevWasBullet = isBullet;
	};

	for (const block of textBlocks) {
		const lines = block.lines ?? [];
		const first = lines[0];
		const text = lines
			.map((l) => l.text)
			.join(" ")
			.trim();
		if (text === "") continue;

		const size = first.font?.size ?? bodySize;
		const weight = first.font?.weight ?? "normal";
		const ratio = bodySize > 0 ? size / bodySize : 1;
		const isWholeLineBold =
			weight === "bold" && (lines.length === 1 || ratio >= 1.1);

		if (ratio >= 1.5) {
			push(`# ${text}`, false);
		} else if (ratio >= 1.3) {
			push(`## ${text}`, false);
		} else if (ratio >= 1.15 || isWholeLineBold) {
			push(`### ${text}`, false);
		} else if (BULLET_RE.test(text)) {
			for (const line of lines) {
				push(`- ${line.text.replace(BULLET_RE, "").trim()}`, true);
			}
		} else {
			push(text, false);
		}
	}
	return `${out.join("\n")}\n`;
}
