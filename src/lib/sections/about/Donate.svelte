<script lang="ts" module>
	export interface Donor {
		name: string;
		amount: number;
		avatar: string;
	}
</script>

<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { PUB_DONATION_URL, PUB_STRIPE_KEY } from "$env/static/public";
	import { GITHUB_URL_CONVERTRA } from "$lib/util/consts";
	import { fade } from "$lib/util/animation";
	import FancyInput from "$lib/components/functional/FancyInput.svelte";
	import Panel from "$lib/components/visual/Panel.svelte";
	import { effects, link, sanitize } from "$lib/store/index.svelte";
	import { loadStripe } from "@stripe/stripe-js/pure";
	import { type Stripe, type StripeElements } from "@stripe/stripe-js";
	import clsx from "clsx";
	import {
		CalendarHeartIcon,
		HandCoinsIcon,
		HeartIcon,
		WalletIcon,
	} from "lucide-svelte";
	import { onMount } from "svelte";
	import { quintOut } from "svelte/easing";
	import { m } from "$lib/paraglide/messages";
	import { ToastManager } from "$lib/util/toast.svelte";

	let amount = $state(1);
	let customAmount = $state("");
	let type = $state("one-time");
	let stripe = $state<Stripe | null>(null);

	const presetAmounts = [1, 10, 25];

	let paymentState = $state<"prepay" | "fetching" | "details">("prepay");
	let enablePay = $state(false);
	let clientSecret = $state<string | null>(null);
	let elements: StripeElements | null = $state(null);

	// Lazy-loaded svelte-stripe components. Loaded on demand so the package's
	// raw .svelte files are compiled by the Svelte toolchain as a separate
	// chunk, never handed to Rollup's JS parser during the production build.
	type SvelteComponent = typeof import("svelte").SvelteComponent;
	let StripeElementsComp = $state<{
		component: SvelteComponent;
		stripe: Stripe;
		clientSecret: string;
	} | null>(null);
	let PaymentElementComp = $state<SvelteComponent | null>(null);

	const amountClick = (preset: number) => {
		amount = preset;
		customAmount = "";
	};

	const paymentClick = async () => {
		if (paymentState !== "prepay") return;

		if (!stripe) stripe = await loadStripe(PUB_STRIPE_KEY);

		paymentState = "fetching";
		const res = await fetch(`${PUB_DONATION_URL}/billing`, {
			method: "POST",
			body: (amount * 100).toString(),
		});

		if (!res.ok) {
			paymentState = "prepay";
			ToastManager.add({
				type: "error",
				message: m["about.donate.payment_error"](),
			});
			return;
		}

		const { data }: { data: string } = await res.json();
		clientSecret = data;
		paymentState = "details";

		// Lazy-load the Stripe form components only once a payment is underway.
		if (!StripeElementsComp && data) {
			const mod = await import("svelte-stripe");
			StripeElementsComp = {
				component: mod.Elements as SvelteComponent,
				stripe: stripe as Stripe,
				clientSecret: data,
			};
			PaymentElementComp = mod.PaymentElement as SvelteComponent;
		}
	};

	$effect(() => {
		if (customAmount) {
			amount = parseFloat(customAmount);
		}
	});

	const payDuration = 400;
	const transition = "cubic-bezier(0.23, 1, 0.320, 1)";

	const donate = async () => {
		if (!stripe || !clientSecret || !elements) return;

		enablePay = false;

		const submitResult = await elements.submit();
		if (submitResult.error) {
			const period = submitResult.error.message?.endsWith(".") ? "" : ".";
			ToastManager.add({
				type: "error",
				message: m["about.donate.payment_failed"]({
					message: submitResult.error.message || "",
					period,
				}),
			});
			enablePay = true;
			return;
		}

		const res = await stripe.confirmPayment({
			elements,
			clientSecret,
			redirect: "if_required",
			confirmParams: {
				return_url: page.url.toString(),
			},
		});

		if (res.error) {
			const period = res.error.message?.endsWith(".") ? "" : ".";
			ToastManager.add({
				type: "error",
				message: m["about.donate.payment_failed"]({
					message: res.error.message || "",
					period,
				}),
			});
		} else {
			ToastManager.add({
				type: "info",
				message: m["about.donate.thank_you"](),
			});
		}

		paymentState = "prepay";
		clientSecret = null;
		elements = null;
		amount = 1;
		customAmount = "";
		type = "one-time";
		enablePay = false;

		stripe = await loadStripe(PUB_STRIPE_KEY);
	};

	onMount(() => {
		const status = page.url.searchParams.get("redirect_status");
		if (status) {
			switch (status) {
				case "succeeded":
					ToastManager.add({
						type: "success",
						message: m["about.donate.thank_you"](),
					});
					break;
				default:
					ToastManager.add({
						type: "error",
						message: m["about.donate.donation_error"](),
					});
			}

			goto("/about");
		}
	});
</script>

<Panel class="flex flex-col gap-8 p-6">
	<div class="flex flex-col gap-3">
		<h2 class="text-2xl font-bold flex items-center">
			<div
				class="rounded-full bg-accent p-2 inline-block mr-3 w-10 h-10"
			>
				<HeartIcon class="text-on-accent" />
			</div>
			{m["about.donate.title"]()}
		</h2>
		<p class="text-base font-normal">
			{m["about.donate.description"]()}
		</p>
	</div>

	<div
		class="flex flex-col gap-3 w-full overflow-visible"
		style="height: {paymentState !== 'prepay' ? 0 : 124}px;
		transform: scaleY({paymentState !== 'prepay' ? 0 : 1});
		opacity: {paymentState !== 'prepay' ? 0 : 1};
		filter: blur({paymentState !== 'prepay' ? 4 : 0}px);
		transition: height {payDuration}ms {transition}, 
					opacity {payDuration - 200}ms {transition}, 
					transform {payDuration}ms {transition},
					filter {payDuration}ms {transition};"
	>
		<div class="flex gap-3 w-full">
			<button
				onclick={() => (type = "one-time")}
				class={clsx(
					"btn flex-1 p-4 rounded-lg flex items-center justify-center",
					{
						"!scale-100": !$effects,
						"bg-accent text-on-accent": type === "one-time",
					},
				)}
			>
				<HandCoinsIcon size="24" class="inline-block mr-2" />
				{m["about.donate.one_time"]()}
			</button>

			<button
				disabled
				onclick={() => (type = "monthly")}
				class={clsx(
					"btn flex-1 p-4 rounded-lg flex items-center justify-center",
					{
						"!scale-100": !$effects,
						"bg-accent text-on-accent": type === "monthly",
					},
				)}
			>
				<CalendarHeartIcon size="24" class="inline-block mr-2" />
				{m["about.donate.monthly"]()}
			</button>
		</div>
		<div class="grid grid-cols-4 gap-3 w-full">
			{#each presetAmounts as preset, i}
				<button
					onclick={() => amountClick(preset)}
					class={clsx(
						"btn p-4 rounded-lg flex items-center justify-center",
						{
							"!scale-100": !$effects,
							"bg-accent text-on-accent": amount === preset,
						},
					)}
					style={i === 2 ? "grid-column: 3;" : ""}
				>
					${preset} USD
				</button>
			{/each}
			<div class="flex items-center justify-center">
				<FancyInput
					bind:value={customAmount}
					placeholder={m["about.donate.custom"]()}
					prefix="$"
					type="number"
					class="h-full"
				/>
			</div>
		</div>
	</div>

	<div class="flex flex-row justify-center w-full">
		<div
			role="button"
			tabindex="0"
			onkeydown={(e) => {
				if (e.key === "Enter") {
					paymentClick();
				}
			}}
			onclick={paymentClick}
			class={clsx(
				"btn flex-1 p-3 relative rounded-3xl bg-accent border-2 border-accent h-14 text-on-accent",
				{
					"h-[450px] rounded-2xl bg-transparent cursor-auto !scale-100 -mt-10 -mb-2":
						paymentState !== "prepay",
					"!scale-100": !$effects,
				},
			)}
			style="transition: height {payDuration}ms {transition}, border-radius {payDuration}ms {transition}, background-color {payDuration}ms {transition}, transform {payDuration}ms {transition}, margin {payDuration}ms {transition}; will-change: height, border-radius, background-color, transform, margin;"
		>
			<div class="grid grid-cols-1 grid-rows-1 w-full h-full">
				{#if paymentState !== "prepay"}
					<div
						transition:fade={{
							duration: payDuration,
							easing: quintOut,
						}}
						class="row-start-1 col-start-1 flex w-full h-full flex-col gap-4"
					>
						<div
							class="flex-grow max-h-full overflow-y-auto overflow-x-hidden"
						>
							{#if StripeElementsComp}
								{@const StripeElements =
									StripeElementsComp.component}
								{@const pcs = StripeElementsComp}
								<StripeElements
									stripe={pcs.stripe}
									clientSecret={pcs.clientSecret}
									bind:elements
								>
									{#if PaymentElementComp}
										{@const PaymentElement =
											PaymentElementComp}
										<PaymentElement
											on:change={(e) => {
												enablePay = e.detail.complete;
											}}
										/>
									{/if}
								</StripeElements>
							{/if}
						</div>

						<div class="flex-shrink-0">
							<button
								disabled={!stripe ||
									!clientSecret ||
									!enablePay}
								class="btn w-full h-12 bg-accent text-on-accent rounded-full mt-4"
								onclick={donate}
							>
								{m["about.donate.donate_amount"]({
									amount: amount.toFixed(2),
								})}
							</button>
						</div>
					</div>
				{:else}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						transition:fade={{
							duration: payDuration,
							easing: quintOut,
						}}
						onclick={paymentClick}
						class="row-start-1 col-start-1 flex justify-center items-center"
					>
						<WalletIcon size="24" class="inline-block mr-2" />
						{m["about.donate.pay_now"]()}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<p class="text-sm font-normal text-muted">
		{@html sanitize(
			link(
				"official_link",
				m["about.donate.donation_notice"](),
				GITHUB_URL_CONVERTRA,
				true,
				"",
			),
		)}
	</p>

	<!-- D8a: Vietnamese payment methods -->
	<div class="flex flex-col gap-3">
		<h3 class="text-lg font-bold flex items-center gap-2">
			<HandCoinsIcon size="20" />
			{m["about.donate.vn_title"]()}
		</h3>
		<p class="text-sm font-normal text-muted">
			{m["about.donate.vn_description"]()}
		</p>
		<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
			<div class="p-4 rounded-lg bg-panel-alt flex flex-col gap-1">
				<span class="font-semibold text-sm">
					{m["about.donate.vn_bank"]()}
				</span>
				<span class="text-sm font-normal text-muted">
					{m["about.donate.vn_bank_detail"]()}
				</span>
			</div>
			<div class="p-4 rounded-lg bg-panel-alt flex flex-col gap-1">
				<span class="font-semibold text-sm">
					{m["about.donate.vn_momo"]()}
				</span>
				<span class="text-sm font-normal text-muted">
					{m["about.donate.vn_momo_detail"]()}
				</span>
			</div>
			<div class="p-4 rounded-lg bg-panel-alt flex flex-col gap-1">
				<span class="font-semibold text-sm">
					{m["about.donate.vn_qr"]()}
				</span>
				<span class="text-sm font-normal text-muted">
					{m["about.donate.vn_qr_detail"]()}
				</span>
			</div>
		</div>
	</div>
</Panel>
