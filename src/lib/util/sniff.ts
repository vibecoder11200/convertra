// Shared magic-byte sniffing: verifies a file's true container format at
// upload time so renamed or corrupt files fail fast with a clear error
// instead of dying deep inside a wasm decoder. Extensible per format family
// (HEIF brands here; the GLB magic check lives in workers/three.ts).

/** Read the first `bytes` of a file as a Uint8Array. */
export async function readFileHeader(
	file: File | Blob,
	bytes = 16,
): Promise<Uint8Array> {
	return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
}

/**
 * HEIF/HEIC brands as declared at ISO-BMFF offset 8 (right after "ftyp").
 * mif1/msf1 cover still-image and sequence containers whose major brand is
 * generic; heic/heix/hevm/hevs/heim/heis are Apple's specific brands.
 */
const HEIF_BRANDS = new Set([
	"heic",
	"heix",
	"hevm",
	"hevs",
	"heim",
	"heis",
	"mif1",
	"msf1",
]);

/** Whether a file header carries an ISO-BMFF `ftyp` box at offset 4. */
export function hasFtypBox(head: Uint8Array): boolean {
	return (
		head.length >= 12 &&
		head[4] === 0x66 &&
		head[5] === 0x74 &&
		head[6] === 0x79 &&
		head[7] === 0x70 // "ftyp"
	);
}

/** Whether a file header is a HEIF/HEIC container (any known brand). */
export function isHeifBytes(head: Uint8Array): boolean {
	if (!hasFtypBox(head)) return false;
	const brand = String.fromCharCode(
		head[8],
		head[9],
		head[10],
		head[11],
	).toLowerCase();
	return HEIF_BRANDS.has(brand);
}

/** Sniff whether a File is really a HEIF/HEIC container. */
export async function sniffIsHeif(file: File): Promise<boolean> {
	return isHeifBytes(await readFileHeader(file));
}
