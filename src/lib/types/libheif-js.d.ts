// Type declaration for the runtime-wasm build of libheif-js (the package
// ships its own .d.ts only for the raw emscripten exports, not the wrapper).
declare module "libheif-js/libheif-wasm/libheif.js" {
	const factory: (config?: {
		wasmBinary?: ArrayBuffer | Uint8Array;
	}) => Promise<{
		HeifDecoder: new () => {
			decode(data: Uint8Array): unknown[];
		};
	}>;
	export default factory;
}
