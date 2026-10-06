// Verify structuredTextToMarkdown with representative mupdf asJSON blocks
// (shape captured from a real probe — .testfiles/mupdf-html-probe.mjs).
const { structuredTextToMarkdown } = await import(
	"../src/lib/util/structured-markdown.ts"
);

const blocks = [
	{
		type: "text",
		lines: [
			{ text: "Quarterly Report", font: { size: 26, weight: "bold" } },
		],
	},
	{
		type: "text",
		lines: [
			{ text: "Summary of Results", font: { size: 15, weight: "bold" } },
		],
	},
	{
		type: "text",
		lines: [
			{
				text: "Revenue grew by twelve percent year over year.",
				font: { size: 11, weight: "normal" },
			},
		],
	},
	{
		type: "text",
		lines: [
			{ text: "• First bullet point", font: { size: 11 } },
			{ text: "• Second bullet point", font: { size: 11 } },
		],
	},
	{
		type: "text",
		lines: [{ text: "Next Steps", font: { size: 14, weight: "bold" } }],
	},
	{
		type: "text",
		lines: [
			{
				text: "Expand the pilot program to new markets.",
				font: { size: 11 },
			},
		],
	},
	{ type: "image", bbox: { x: 0, y: 0, w: 10, h: 10 } }, // must be ignored
];

const md = structuredTextToMarkdown(blocks);
console.log(md);
console.log("---");
const empty = structuredTextToMarkdown([{ type: "image" }]);
console.log(`empty-case: ${JSON.stringify(empty)}`);
const noFont = structuredTextToMarkdown([
	{ type: "text", lines: [{ text: "plain only" }] },
]);
console.log(`no-font-case: ${JSON.stringify(noFont)}`);
