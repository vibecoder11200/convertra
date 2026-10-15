## FAQ

This file covers frequently asked questions.

- [Why Convertra?](#why-convertra)
- [What happens with video files?](#what-happens-with-video-files)
- [Can I host my own video file converter?](#can-i-host-my-own-video-file-converter)
- [What about analytics?](#what-about-analytics)
- [What libraries does Convertra use?](#what-libraries-does-convertra-use)
- [Is it possible to fully prevent Convertra from making requests to external services?](#is-it-possible-to-fully-prevent-convertra-from-making-requests-to-external-services)

### Why Convertra?

**File converters have always disappointed us.** They're ugly, riddled with ads, and most importantly; slow. We decided to solve this problem once and for all by making an alternative that solves all those problems, and more.

All non-video files are converted completely on-device; this means that there's no delay between sending and receiving the files from a server, and we never get to snoop on the files you convert.

### What happens with video files?

Video files get uploaded to our lightning-fast RTX 4000 Ada server. Your videos stay on there for an hour if you do not convert them. If you do convert the file, the video will stay on the server for an hour, or until it is downloaded. The file will then be deleted from our server.

### Can I host my own video file converter?

Yes. Check out the [Video Conversion](./VIDEO_CONVERSION.md) page.

### What about analytics?

We use privacy-focused analytics — [Plausible](https://plausible.io/privacy-focused-web-analytics) and/or self-hosted [Umami](https://umami.is/docs) — to gather completely anonymous, aggregated statistics. They are cookieless, no identifiable information is ever sent or stored, and events only contain formats, sizes, and counts (never file names). You can opt out in the Settings page at any time. Self-hosters can run their own Umami instance with our [deploy kit](./ANALYTICS.md).

### Is it possible to fully prevent Convertra from making requests to external services?

Yes! If you would prefer Convertra to not make any requests to external services (video conversion, analytics, among others), you can set the `PUB_DISABLE_ALL_EXTERNAL_REQUESTS` environment variable to `true` **during build time**.

The only external request Convertra will make with this option is to `cdn.jsdelivr.net`, which is used to download FFmpeg's WebAssembly build.

### What libraries does Convertra use?

Convertra uses FFmpeg for audio and video conversion, imagemagick for images, Pandoc for documents, MuPDF for PDF rendering and extraction, pdf-lib for PDF assembly, libheif for HEIC/HEIF decoding, and SheetJS for spreadsheets. A big thanks to them for maintaining such excellent libraries for so many years.

### How is HEIC/HEIF supported, and what does that mean for licenses?

HEIC/HEIF photos (the iPhone default format) are decoded client-side with
[libheif](https://github.com/strukturag/libheif), which is LGPL-3.0 licensed.
To keep Convertra's MIT license clean, the libheif WebAssembly binary is
**not** bundled into the application: it ships as a separate runtime asset
(`/libheif.wasm`), copied from the pinned npm package at install time and
fetched same-origin when a HEIC conversion is first requested. Multi-frame
HEIC files (bursts, Live Photos) convert to multi-page PDFs; single images
convert to any supported image target. On Safari the browser's native HEIC
decoder is used when available.

### Why does my PDF converted to DOCX lose its layout?

PDF is a page-description format: it records where each glyph sits, not the
document structure. Converting a PDF to an editable format extracts the text
and re-typesets it (Convertra chains MuPDF → Pandoc for this), so the original
layout is not preserved — the UI shows this note when it applies. Scanned PDFs
contain images of text rather than text, so they extract nothing.

### Does "Share to Convertra" work on my phone?

On Android and Chrome OS, Convertra appears in the system share sheet (for
installed-PWA users): shared images, PDFs, audio, video and archives land
directly in the convert flow, without re-uploading them through the file
picker. **iOS Safari does not support the Web Share Target API**, so the share
sheet won't list Convertra there — use the normal upload button instead. On
desktop, an installed Convertra can also register as an "Open with" handler
for common file types (File Handling API). Files shared into Convertra never
leave your device: the service worker temporarily stashes them in a local
Cache API store on your device to hand them to the open tab, then deletes the
stash immediately after reading it.
