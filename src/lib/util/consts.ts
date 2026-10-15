import { PUB_DISABLE_ALL_EXTERNAL_REQUESTS, PUB_ENV } from "$env/static/public";

export const GITHUB_URL_VERTD = "https://github.com/VERT-sh/vertd";
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

// image extensions the pdf-lib worker embeds directly (jpg/png) or
// canvas-decodes; heic/heif join after the heic decoder pre-decodes them to
// png on the main side. Lives here (no converter imports) so the files store
// can gate the multi-image merge without an import cycle.
export const MERGEABLE_IMAGE_EXTS = [
	".jpg",
	".jpeg",
	".jpe",
	".jfif",
	".png",
	".webp",
	".gif",
	".avif",
	".bmp",
	".heic",
	".heif",
];
