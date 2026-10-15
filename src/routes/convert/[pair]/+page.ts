import { error } from "@sveltejs/kit";
import {
	activePairs,
	composeDescription,
	composeTitle,
	getPair,
} from "$lib/seo/pairs";
import type { EntryGenerator, PageLoad } from "./$types";

// only registry pairs exist — anything else 404s (no wildcard junk pages).
// gated pairs (requires: ...) are excluded here and from the sitemap.
export const entries: EntryGenerator = () =>
	activePairs().map((p) => ({ pair: p.slug }));

export const load: PageLoad = ({ params }) => {
	const pair = getPair(params.pair);
	if (!pair || pair.requires) {
		error(404, "Unknown conversion");
	}
	// seo overrides the layout's default title/description (read via the
	// page store in +layout.svelte)
	return {
		pair,
		seo: {
			title: composeTitle(pair),
			description: composeDescription(pair),
		},
	};
};
