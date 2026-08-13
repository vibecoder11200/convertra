import prettier from "eslint-config-prettier";
import js from "@eslint/js";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs["flat/recommended"],
	prettier,
	...svelte.configs["flat/prettier"],
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				// Injected by vite.config.ts `define`
				__COMMIT_HASH__: "readonly",
				// Provided by @types/node
				NodeJS: "readonly",
			},
		},
	},
	{
		files: ["**/*.svelte"],

		languageOptions: {
			parserOptions: {
				parser: ts.parser,
			},
		},
	},
	// Every `{@html}` in this repo is wrapped in `sanitize()` / `link()`
	// (see src/lib/store - sanitize-html with a strict allowlist). The upstream
	// project relies on this contract, so the blanket rule is disabled here.
	{
		files: ["**/*.svelte"],
		rules: {
			"svelte/no-at-html-tags": "off",
		},
	},
	// Gradients.svelte intentionally suppresses `state_referenced_locally`
	// (the Tween captures the initial value; the $effect keeps it reactive).
	// The svelte-ignore is legitimately used, so this rule is noise here.
	{
		files: ["src/lib/components/layout/Gradients.svelte"],
		rules: {
			"svelte/no-unused-svelte-ignore": "off",
		},
	},
	{
		ignores: ["build/", ".svelte-kit/", "dist/"],
	},
);
