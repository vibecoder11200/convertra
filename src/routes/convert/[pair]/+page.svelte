<script lang="ts">
	import { m } from "$lib/paraglide/messages";
	import ConverterEmbed from "$lib/sections/convert/ConverterEmbed.svelte";
	import {
		composeDescription,
		formatName,
		relatedPairs,
		type ConversionPair,
	} from "$lib/seo/pairs";

	let { data }: { data: { pair: ConversionPair } } = $props();

	const pair = $derived(data.pair);
	const description = $derived(composeDescription(pair));
	const from = $derived(formatName(pair.from));
	const to = $derived(formatName(pair.to));

	// generic FAQ is i18n'd; curated per-pair FAQ from the registry is
	// appended first (English copy)
	const faq = $derived([
		...(pair.faq ?? []),
		{
			q: m["seo.faq.private.q"]({ from }),
			a: m["seo.faq.private.a"]({ from }),
		},
		{
			q: m["seo.faq.free.q"](),
			a: m["seo.faq.free.a"](),
		},
		{
			q: m["seo.faq.limit.q"]({ from }),
			a: m["seo.faq.limit.a"]({ from }),
		},
	]);

	// schema.org FAQPage JSON-LD (https://schema.org/FAQPage); `<` escaped
	// so a future translation containing a literal closing script tag
	// can't break out
	const faqJsonLd = $derived(
		JSON.stringify({
			"@context": "https://schema.org",
			"@type": "FAQPage",
			mainEntity: faq.map((f) => ({
				"@type": "Question",
				name: f.q,
				acceptedAnswer: { "@type": "Answer", text: f.a },
			})),
		}).replaceAll("<", "\\u003c"),
	);
	// assembled in pieces so the literal closing tag never appears in markup
	// (the svelte eslint parser misreads it there)
	const faqScriptTag = $derived(
		'<script type="application/ld+json">' + faqJsonLd + "</" + "script>",
	);

	const related = $derived(relatedPairs(pair));
</script>

<svelte:head>
	<!-- title/description/canonical/OG are emitted by +layout.svelte from
	     this page's `seo` load data -->
	{@html faqScriptTag}
</svelte:head>

<div class="flex flex-col items-center w-full gap-8">
	<div class="w-full max-w-[720px] flex flex-col gap-2 text-center">
		<h1 class="text-4xl tracking-tight">
			{m["seo.h1"]({ from, to })}
		</h1>
		<p class="text-muted">{description}</p>
	</div>

	<div class="w-full max-w-[720px]">
		<ConverterEmbed from={pair.from} to={pair.to} />
	</div>

	<div class="w-full max-w-[720px] flex flex-col gap-4">
		<section class="bg-panel rounded-2xl shadow-panel p-6">
			<h2 class="text-2xl mb-3">{m["seo.howto.title"]({ from, to })}</h2>
			<ol class="list-decimal list-inside flex flex-col gap-2">
				<li>{m["seo.howto.step1"]({ from })}</li>
				<li>{m["seo.howto.step2"]({ to })}</li>
				<li>{m["seo.howto.step3"]({ to })}</li>
			</ol>
		</section>

		<section class="bg-panel rounded-2xl shadow-panel p-6">
			<h2 class="text-2xl mb-3">{m["seo.faq.title"]()}</h2>
			<div class="flex flex-col gap-4">
				{#each faq as entry (entry.q)}
					<div>
						<h3 class="font-semibold">{entry.q}</h3>
						<p>{entry.a}</p>
					</div>
				{/each}
			</div>
		</section>

		<section class="bg-panel rounded-2xl shadow-panel p-6">
			<h2 class="text-2xl mb-3">{m["seo.related.title"]()}</h2>
			<div class="flex flex-wrap gap-2">
				{#each related as rel (rel.slug)}
					<a
						class="bg-panel-alt rounded-full px-3 py-1.5 text-sm hover:scale-105 duration-200"
						href="/convert/{rel.slug}/"
					>
						{formatName(rel.from)} → {formatName(rel.to)}
					</a>
				{/each}
			</div>
		</section>
	</div>
</div>
