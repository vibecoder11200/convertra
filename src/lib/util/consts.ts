import { PUB_DISABLE_ALL_EXTERNAL_REQUESTS, PUB_ENV } from "$env/static/public";

export const GITHUB_URL_CONVERTRA =
	"https://github.com/vibecoder11200/convertra";
export const GITHUB_URL_VERTD = "https://github.com/VERT-sh/vertd";
export const GITHUB_API_URL =
	"https://api.github.com/repos/vibecoder11200/convertra";
export const DISCORD_URL = "https://discord.gg/kqevGxYPak";
export const APP_NAME =
	PUB_ENV === "development"
		? "Convertra Local"
		: PUB_ENV === "nightly"
			? "Convertra Nightly"
			: "Convertra";

// i'm not entirely sure this should be in consts.ts, but it is technically a constant as .env is static for Convertra
export const DISABLE_ALL_EXTERNAL_REQUESTS =
	PUB_DISABLE_ALL_EXTERNAL_REQUESTS === "true";

export const GB = 1024 * 1024 * 1024;
