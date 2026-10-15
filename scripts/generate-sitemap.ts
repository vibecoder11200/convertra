// regenerates static/sitemap.xml from the conversion-pair registry plus the
// static routes. Run manually (`bun scripts/generate-sitemap.ts`) and as
// part of `bun run build`.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sitemapPaths } from "../src/lib/seo/pairs.ts";

// sitemap <loc>s must be absolute and must match the canonical URLs the
// layout renders, which derive from PUB_HOSTNAME the same way
const hostname = process.env.PUB_HOSTNAME;
if (!hostname) {
	console.warn(
		"[generate-sitemap] PUB_HOSTNAME unset — skipping sitemap regeneration (keeping existing static/sitemap.xml)",
	);
	process.exit(0);
}
const HOST = `https://${hostname}`;
const lastmod = new Date().toISOString().replace(/\.\d+Z$/, "+00:00");

const urls = sitemapPaths()
	.map(
		({ path, priority }) => `  <url>
    <loc>${HOST}${path}</loc>
    <lastmod>${lastmod}</lastmod>
    <priority>${priority}</priority>
  </url>`,
	)
	.join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">

${urls}
</urlset>
`;

const out = resolve(import.meta.dir, "../static/sitemap.xml");
writeFileSync(out, xml);
console.log(
	`[generate-sitemap] wrote ${sitemapPaths().length} URLs to static/sitemap.xml`,
);
