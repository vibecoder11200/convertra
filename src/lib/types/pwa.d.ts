// File Handling API (window.launchQueue) — not yet in lib.dom for all
// toolchains; minimal surface Convertra uses.

interface LaunchParams {
	files: FileSystemFileHandle[];
	targetURL?: string;
}

interface LaunchQueue {
	setConsumer(
		consumer: (launchParams: LaunchParams) => Promise<void> | void,
	): void;
}

interface Window {
	launchQueue?: LaunchQueue;
}
