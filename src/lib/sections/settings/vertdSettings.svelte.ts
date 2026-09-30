import { Settings } from "./index.svelte";

export class VertdInstance {
	public static instance = new VertdInstance();

	// vertd is self-hosted: the instance URL comes from PUB_VERTD_URL and can
	// be overridden per browser in settings. The previously hosted EU/US
	// instances are gone, so there is nothing to auto-select anymore.
	public async url() {
		return Settings.instance.settings.vertdURL;
	}
}
