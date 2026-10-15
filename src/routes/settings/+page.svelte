<script lang="ts">
	import { browser } from "$app/environment";
	import { log } from "$lib/util/logger";
	import * as Settings from "$lib/sections/settings/index.svelte";
	import { analyticsConfigured } from "$lib/analytics/index";
	import { SettingsIcon } from "lucide-svelte";
	import { m } from "$lib/paraglide/messages";
	import { ToastManager } from "$lib/util/toast.svelte";
	import { DISABLE_ALL_EXTERNAL_REQUESTS } from "$lib/util/consts";

	let settings = $state(Settings.Settings.instance.settings);

	let isInitial = $state(true);

	$effect(() => {
		if (!browser) return;
		if (isInitial) {
			isInitial = false;
			return;
		}

		const savedSettings = localStorage.getItem("settings");
		if (savedSettings) {
			try {
				const parsedSettings = JSON.parse(savedSettings);
				if (JSON.stringify(parsedSettings) === JSON.stringify(settings))
					return;
			} catch {
				// corrupt blob: fall through and overwrite it with the live settings
			}
		}

		try {
			Settings.Settings.instance.save();
			log(["settings"], "saving settings");
		} catch (error) {
			log(["settings", "error"], `failed to save settings: ${error}`);
			ToastManager.add({
				type: "error",
				message: m["settings.errors.save_failed"](),
			});
		}
	});
</script>

<div class="flex flex-col h-full items-center">
	<h1 class="hidden md:block text-[40px] tracking-tight leading-[72px] mb-6">
		<SettingsIcon size="40" class="inline-block -mt-2 mr-2" />
		{m["settings.title"]()}
	</h1>

	<div
		class="w-full max-w-[1280px] flex flex-col md:flex-row gap-4 p-4 md:px-4 md:py-0"
	>
		<div class="flex flex-col gap-4 flex-1">
			<Settings.Conversion bind:settings />
			{#if !DISABLE_ALL_EXTERNAL_REQUESTS}
				<Settings.Vertd bind:settings />
			{:else if analyticsConfigured()}
				<Settings.Privacy bind:settings />
			{/if}
		</div>

		<div class="flex flex-col gap-4 flex-1">
			<Settings.Appearance />
			{#if analyticsConfigured() && !DISABLE_ALL_EXTERNAL_REQUESTS}
				<Settings.Privacy bind:settings />
			{/if}
		</div>
	</div>
</div>
