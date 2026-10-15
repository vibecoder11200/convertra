import { browser } from "$app/environment";
import { createPlausibleStub } from "$lib/analytics/index";

export const load = ({ data }) => {
	if (!browser) return data;
	window.plausible = window.plausible || createPlausibleStub();

	return data;
};

export const prerender = true;
export const trailingSlash = "always";
