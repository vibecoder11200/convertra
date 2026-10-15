<script lang="ts">
	import { files } from "$lib/store/index.svelte";
	import { m } from "$lib/paraglide/messages";
	import Panel from "$lib/components/visual/Panel.svelte";

	let password = $state("");
	let inputEl = $state<HTMLInputElement>();

	// fresh field every time the modal opens
	$effect(() => {
		if (files.pendingUnlock) {
			password = "";
			setTimeout(() => inputEl?.focus(), 30);
		}
	});

	const submit = () => {
		if (!password) return;
		void files.submitUnlockPassword(password);
	};
</script>

{#if files.pendingUnlock}
	<div
		class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
		role="dialog"
		aria-modal="true"
		aria-label={m["unlock.title"]()}
	>
		<Panel class="w-full max-w-md p-6 flex flex-col gap-4">
			<h2 class="text-xl font-semibold">{m["unlock.title"]()}</h2>
			<p class="text-sm text-muted">
				{m["unlock.description"]({ name: files.pendingUnlock.name })}
			</p>
			{#if files.pendingUnlock.wrongPassword}
				<p class="text-sm text-failure">{m["unlock.wrong"]()}</p>
			{/if}
			<form
				class="flex flex-col gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<input
					bind:this={inputEl}
					class="input w-full"
					type="password"
					autocomplete="off"
					placeholder={m["unlock.password"]()}
					bind:value={password}
				/>
				<div class="flex items-center justify-end gap-2">
					<button
						type="button"
						class="btn p-2"
						onclick={() => files.cancelUnlock()}
					>
						{m["unlock.cancel"]()}
					</button>
					<button type="submit" class="btn highlight p-2" disabled={!password}>
						{m["unlock.submit"]()}
					</button>
				</div>
			</form>
		</Panel>
	</div>
{/if}
