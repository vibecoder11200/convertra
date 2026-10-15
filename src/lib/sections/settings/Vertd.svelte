<script lang="ts">
	import Panel from "$lib/components/visual/Panel.svelte";
	import { GITHUB_URL_VERTD } from "$lib/util/consts";
	import { ServerIcon } from "lucide-svelte";
	import type { ISettings } from "./index.svelte";
	import clsx from "clsx";
	import Dropdown from "$lib/components/functional/Dropdown.svelte";
	import { vertdLoaded } from "$lib/store/index.svelte";
	import { m } from "$lib/paraglide/messages";
	import { link, sanitize } from "$lib/store/index.svelte";
	import { VertdInstance } from "./vertdSettings.svelte";
	import { trackEvent } from "$lib/analytics/index";

	let vertdCommit = $state<string | null>(null);
	let abortController: AbortController | null = null;

	const { settings = $bindable() }: { settings: ISettings } = $props();

	$effect(() => {
		if (abortController) abortController.abort();
		abortController = new AbortController();
		const { signal } = abortController;

		vertdCommit = "loading";
		VertdInstance.instance
			.url()
			.then((u) =>
				u ? fetch(`${u}/api/version`, { signal }) : undefined,
			)
			.then((res) => {
				if (!res || !res.ok) throw new Error("bad response");
				vertdLoaded.set(false);
				return res.json();
			})
			.then((data) => {
				vertdCommit = data.data;
				vertdLoaded.set(true);
			})
			.catch((err) => {
				if (err.name !== "AbortError") {
					vertdCommit = null;
					vertdLoaded.set(false);
				}
			});

		return () => {
			if (abortController) abortController.abort();
		};
	});
</script>

<Panel class="flex flex-col gap-8 p-6">
	<div class="flex flex-col gap-3">
		<h2 class="text-2xl font-bold">
			<ServerIcon
				size="40"
				class="inline-block -mt-1 mr-2 bg-accent p-2 rounded-full overflow-visible text-on-accent"
			/>
			{m["settings.vertd.title"]()}
		</h2>
		<p
			class={clsx("text-sm font-normal", {
				"text-failure": vertdCommit === null,
				"text-green-700 dynadark:text-green-300": vertdCommit !== null,
				"!text-muted": vertdCommit === "loading",
			})}
		>
			{m["settings.vertd.status"]()}
			{vertdCommit
				? vertdCommit === "loading"
					? m["settings.vertd.loading"]()
					: m["settings.vertd.available"]({ commitId: vertdCommit })
				: m["settings.vertd.unavailable"]()}
		</p>
		<div class="flex flex-col gap-8">
			<div class="flex flex-col gap-4">
				<p class="text-sm text-muted font-normal">
					{@html sanitize(m["settings.vertd.description"]())}
				</p>
				<p class="text-sm text-muted font-normal">
					{@html sanitize(
						link(
							"vertd_link",
							m["settings.vertd.hosting_info"](),
							GITHUB_URL_VERTD,
						),
					)}
				</p>
				<div class="flex flex-col gap-2">
					<p class="text-base font-bold">
						{m["settings.vertd.instance"]()}
					</p>
					<input
						type="text"
						placeholder={m["settings.vertd.url_placeholder"]()}
						bind:value={settings.vertdURL}
					/>
				</div>
				<div class="flex flex-col gap-4">
					<div class="flex flex-col gap-2">
						<p class="text-base font-bold">
							{m["settings.vertd.conversion_speed"]()}
						</p>
						<p class="text-sm text-muted font-normal">
							{m["settings.vertd.speed_description"]()}
						</p>
					</div>
					<Dropdown
						options={[
							m["settings.vertd.speeds.very_slow"](),
							m["settings.vertd.speeds.slower"](),
							m["settings.vertd.speeds.slow"](),
							m["settings.vertd.speeds.medium"](),
							m["settings.vertd.speeds.fast"](),
							m["settings.vertd.speeds.ultra_fast"](),
						]}
						settingsStyle
						selected={(() => {
							switch (settings.vertdSpeed) {
								case "verySlow":
									return m[
										"settings.vertd.speeds.very_slow"
									]();
								case "slower":
									return m["settings.vertd.speeds.slower"]();
								case "slow":
									return m["settings.vertd.speeds.slow"]();
								case "medium":
									return m["settings.vertd.speeds.medium"]();
								case "fast":
									return m["settings.vertd.speeds.fast"]();
								case "ultraFast":
									return m[
										"settings.vertd.speeds.ultra_fast"
									]();
							}
						})()}
						onselect={(selected) => {
							// re-selecting the current speed must not count as a change
							const previous = settings.vertdSpeed;
							switch (selected) {
								case m["settings.vertd.speeds.very_slow"]():
									settings.vertdSpeed = "verySlow";
									break;
								case m["settings.vertd.speeds.slower"]():
									settings.vertdSpeed = "slower";
									break;
								case m["settings.vertd.speeds.slow"]():
									settings.vertdSpeed = "slow";
									break;
								case m["settings.vertd.speeds.medium"]():
									settings.vertdSpeed = "medium";
									break;
								case m["settings.vertd.speeds.fast"]():
									settings.vertdSpeed = "fast";
									break;
								case m["settings.vertd.speeds.ultra_fast"]():
									settings.vertdSpeed = "ultraFast";
									break;
							}
							if (settings.vertdSpeed !== previous) {
								trackEvent("settings_change", {
									key: "vertdSpeed",
									value: settings.vertdSpeed,
								});
							}
						}}
					/>
				</div>
			</div>
		</div>
	</div>
</Panel>
