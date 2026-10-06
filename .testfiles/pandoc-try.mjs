// Probe which writers actually work in static/pandoc.wasm, using the exact
// same shim + fd layout as src/lib/workers/pandoc.ts (browser_wasi_shim).
import { readFileSync } from "node:fs";
import * as wasiShim from "@bjorn3/browser_wasi_shim";

const wasmBytes = readFileSync(
	new URL("../static/pandoc.wasm", import.meta.url),
);
const INPUT = "# Hello Probe\n\nA **bold** test and a list:\n\n- one\n- two\n";

async function tryWriter(to) {
	const args = ["pandoc.wasm", "+RTS", "-H64m", "-RTS"];
	const in_file = new wasiShim.File(new TextEncoder().encode(INPUT), {
		readonly: true,
	});
	const out_file = new wasiShim.File(new Uint8Array(), { readonly: false });
	const root = new wasiShim.PreopenDirectory(
		"/",
		new Map([
			["in", in_file],
			["out", out_file],
		]),
	);
	const fds = [
		new wasiShim.OpenFile(
			new wasiShim.File(new Uint8Array(), { readonly: true }),
		),
		wasiShim.ConsoleStdout.lineBuffered(() => {}),
		wasiShim.ConsoleStdout.lineBuffered(() => {}),
		root,
		new wasiShim.PreopenDirectory("/tmp", new Map()),
	];
	const wasi = new wasiShim.WASI(args, [], fds, { debug: false });
	const { instance } = await WebAssembly.instantiate(wasmBytes, {
		wasi_snapshot_preview1: wasi.wasiImport,
	});
	wasi.initialize(instance);
	instance.exports.__wasm_call_ctors();
	const mem = () => new DataView(instance.exports.memory.buffer);
	const enc = new TextEncoder();
	const argcPtr = instance.exports.malloc(4);
	mem().setUint32(argcPtr, args.length, true);
	const argv = instance.exports.malloc(4 * (args.length + 1));
	for (let i = 0; i < args.length; i++) {
		const p = instance.exports.malloc(args[i].length + 1);
		enc.encodeInto(
			args[i],
			new Uint8Array(instance.exports.memory.buffer, p, args[i].length),
		);
		mem().setUint8(p + args[i].length, 0);
		mem().setUint32(argv + 4 * i, p, true);
	}
	mem().setUint32(argv + 4 * args.length, 0, true);
	const argvPtr = instance.exports.malloc(4);
	mem().setUint32(argvPtr, argv, true);
	instance.exports.hs_init_with_rtsopts(argcPtr, argvPtr);

	const cmd = `-f markdown -t ${to} --extract-media=. -o out in`;
	const cmdPtr = instance.exports.malloc(cmd.length);
	enc.encodeInto(
		cmd,
		new Uint8Array(instance.exports.memory.buffer, cmdPtr, cmd.length),
	);
	try {
		instance.exports.wasm_main(cmdPtr, cmd.length);
	} catch (e) {
		console.log(`${to.padEnd(14)} CRASH ${String(e).slice(0, 90)}`);
		return;
	}
	const out = new Uint8Array(out_file.data);
	if (out.length === 0) {
		console.log(`${to.padEnd(14)} EMPTY (writer rejected input)`);
		return;
	}
	const head = out.subarray(0, 2).toString("latin1");
	console.log(
		`${to.padEnd(14)} OK  bytes=${String(out.length).padEnd(8)} zip=${head === "PK"} head=${JSON.stringify(out.subarray(0, 20).toString("latin1"))}`,
	);
}

for (const to of [
	"pptx",
	"docx",
	"odt",
	"epub",
	"rtf",
	"docbook",
	"typst",
	"latex",
	"opendocument",
	"jats",
	"rst",
	"html",
	"markdown",
]) {
	try {
		await tryWriter(to);
	} catch (e) {
		console.log(`${to.padEnd(14)} FAIL ${String(e).slice(0, 100)}`);
	}
}
