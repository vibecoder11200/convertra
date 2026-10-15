# Archived About sections

These UI sections were removed from the About page (`/about/`) because they
linked to the instance owner's personal GitHub repo and Discord invite, which
are no longer exposed in the UI:

- `Resources.svelte` — Discord + "Source code" buttons
- `Credits.svelte` — contributors list (fetched from the GitHub contributors API)
- `Sponsors.svelte` — sponsor card (Eva) with a Discord contact link
- `lily.jpeg` — sponsor avatar used only by Sponsors.svelte

They are kept here (outside `src/`, so they are never compiled) for easy
restoration. To bring one back:

1. Copy the file back to `src/lib/sections/about/` (image to `src/lib/assets/`).
2. Re-add the constants it imports to `src/lib/util/consts.ts`
   (`GITHUB_URL_CONVERTRA`, `GITHUB_API_URL`, `DISCORD_URL` — see git history).
3. Re-export it from `src/lib/sections/about/index.ts` and render it in
   `src/routes/about/+page.svelte`.
4. Restore the i18n keys it uses (`about.resources.*`, `about.credits.*`,
   `about.sponsors.*`) from git history.

Note: the footer still shows the short commit hash (plain text, no link) as a
version marker.
