// Leaf settings module: holds ONLY the ISettings interface and the Settings
// class. Do NOT re-export components from here — src/lib/analytics imports
// this module, and importing anything that reaches $lib/store would create a
// circular import that svelte-check cannot detect. Components re-export the
// store via the barrel (./index.svelte.ts); consumers outside this directory
// should keep importing from the barrel.
import { PUB_VERTD_URL } from "$env/static/public";
import type { ConversionBitrate } from "$lib/converters/ffmpeg.svelte";
import type { ConversionSpeed } from "$lib/converters/vertd.svelte";

export interface DefaultFormats {
	image: string;
	video: string;
	audio: string;
	document: string;
}
export interface ISettings {
	filenameFormat: string;
	defaultFormat: DefaultFormats;
	useDefaultFormat: boolean;
	metadata: boolean;
	analytics: boolean;
	vertdURL: string;
	vertdSpeed: ConversionSpeed; // videos
	magickQuality: number; // images
	ffmpegQuality: ConversionBitrate; // audio (or audio <-> video)
	ffmpegSampleRate: string; // audio (or audio <-> video)
	ffmpegCustomSampleRate: number; // audio (or audio <-> video) - only used when ffmpegSampleRate is "custom"
	vertdBlockedHashes: Map<string, Date[]>; // hashes of files blocked from vertd conversion
}

export class Settings {
	public static instance = new Settings();

	public settings: ISettings = $state({
		filenameFormat: "Convertra_%name%",
		defaultFormat: {
			image: ".png",
			video: ".mp4",
			audio: ".mp3",
			document: ".docx",
		},
		useDefaultFormat: false,
		metadata: true,
		analytics: true,
		vertdURL: PUB_VERTD_URL,
		vertdSpeed: "slow",
		magickQuality: 100,
		ffmpegQuality: "auto",
		ffmpegSampleRate: "auto",
		ffmpegCustomSampleRate: 44100,
		vertdBlockedHashes: new Map<string, Date[]>(),
	});

	public save() {
		localStorage.setItem("settings", JSON.stringify(this.settings));
	}

	public load() {
		try {
			const ls = localStorage.getItem("settings");
			if (!ls) return;
			const stored = JSON.parse(ls) as Partial<ISettings> & {
				plausible?: boolean;
			};
			// migrate the legacy `plausible` opt-out to the shared `analytics` toggle
			let migrated = false;
			if (
				stored.plausible !== undefined &&
				stored.analytics === undefined
			) {
				stored.analytics = stored.plausible;
				migrated = true;
			}
			delete (stored as { plausible?: boolean }).plausible;
			const vertdBlockedHashes = new Map<string, Date[]>(
				Object.entries(stored.vertdBlockedHashes ?? {}),
			);
			// merge in place so bindings capturing this.settings keep their identity
			Object.assign(this.settings, stored, { vertdBlockedHashes });
			if (migrated) this.save(); // persist so the stale legacy key never resurrects
		} catch {
			// ignore errors, use default settings
		}
	}
}
