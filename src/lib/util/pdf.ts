export function parsePageRange(range: string, totalPages: number): number[] {
	// Supports "1-5", "1,3,7", "1-3,5", or "all"
	const trimmed = range.trim().toLowerCase();
	if (trimmed === "" || trimmed === "all") {
		return Array.from({ length: totalPages }, (_, i) => i + 1);
	}

	const pages = new Set<number>();
	for (const part of trimmed.split(",")) {
		const m = part.match(/^(\d+)(?:-(\d+))?$/);
		if (!m) continue;
		const start = Math.max(1, parseInt(m[1], 10));
		const end = m[2] ? Math.min(totalPages, parseInt(m[2], 10)) : start;
		for (let p = start; p <= end; p++) pages.add(p);
	}
	return Array.from(pages).sort((a, b) => a - b);
}

export function baseName(filename: string): string {
	return filename.replace(/\.[^/.]+$/, "");
}

export function toArrayBuffer(input: File): Promise<ArrayBuffer> {
	return input.arrayBuffer();
}
