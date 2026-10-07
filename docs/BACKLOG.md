# Backlog

## [ ] Chọn bảng màu (palette) thương hiệu chính thức cho Convertra

**Trạng thái:** đang chờ — ưu tiên làm **sau khi** redesign giao diện app, vì
palette cuối cùng phải ăn khớp với UI mới.

**Bối cảnh:** bộ brand assets hiện tại (`static/banner.png`, `favicon.*`,
`apple-touch-icon.png`, `lettermark.*`) đã được thiết kế lại theo mark "mũi tên
đổi chiều" nhưng cố tình dùng bảng màu **trung tính vĩnh cửu** (mực `#18181B`
trên nền `#F4F4F3`, banner nền `#0D0D10`) — không khoá theo palette nào để khi
đổi UI không phải thiết kế lại mark.

**Cần làm:**

1. Chọn gradient chủ đạo (các phương án đã bàn):
   | Phương án | Gradient | Chú thích |
   |---|---|---|
   | Tech Blue | `#2563EB → #06B6D4` | tin cậy, chất developer tool |
   | Privacy Emerald | `#059669 → #34D399` | "file ở lại trên máy bạn" |
   | Sunset Ember | `#F97316 → #EF4444` | năng lượng, nổi trên GitHub |
   | Indigo Bloom | `#7C3AED → #EC4899` | hiện đại, khác hẳn hồng VERT cũ |
   (hoặc hex tự chọn)
2. Cập nhật 3 biến màu trong `docs/brand/convertra-brand.html` (`--ink`,
   `--paper`, `--night`) rồi render lại toàn bộ assets theo hướng dẫn nằm
   ngay trong file đó.
3. Đồng bộ UI: biến accent trong `src/lib/css/app.scss`, `<meta name="theme-color">`
   trong `src/routes/+layout.svelte`, `theme_color`/`background_color` trong
   `static/manifest.json`.

## [ ] Dọn nốt định danh code mang tên VERT

`VertFile` (type), `VertVBig.svelte` (component logo V cũ — cân nhắc thay bằng
mark mũi tên mới), các file `vertd*.svelte(.ts)` (đổi tên khi đã có server
vertd riêng), `GITHUB_URL_VERTD` trong `src/lib/util/consts.ts`.

## [ ] Deploy server vertd riêng

Video conversion hiện tắt hoàn toàn (các instance công khai cũ của upstream đã
chết — TCP timeout). Deploy `vertd` rồi set `PUB_VERTD_URL` khi build.

## [x] Mở rộng định dạng đợt Tier 1 + Tier 2 (hoàn tất — 2026-10-07)

Đã ship trên branch `feat/converters-tier12`:

- **EPUB/CBZ → PDF & ảnh**, **PDF → CBZ** (mupdf render worker + pdf-lib
  assemble trong worker; pdfjs fallback chỉ áp dụng cho PDF).
- **Ảnh → PDF** (pdf-lib: jpg/png nhúng lossless, webp/gif/avif/bmp decode
  canvas trong worker).
- **PPTX / Typst / LaTeX / JATS output** qua pandoc + gỡ chặn RTF (writers
  đã verify bằng `.testfiles/pandoc-try.mjs`).
- **PDF → markdown/html thật** (mupdf asJSON → heading theo ratio font size —
  `src/lib/util/structured-markdown.ts`); chuỗi pdf → md/html → mọi target
  pandoc tự mở khóa qua ChainedConverter có sẵn.
- **Spreadsheet** qua SheetJS 0.20.3 (CDN chính thức, tránh CVE của bản npm
  0.18.5): xlsx/xls/ods ⇄ csv/tsv/json/html/md; multi-sheet → zip CSV.

Còn lại (chưa làm, theo thứ tự giá trị):

- [ ] DOCX/XLSX → PDF chất lượng LibreOffice — chỉ khả thi khi có vertd riêng
      cài LibreOffice (item ở trên).
- [ ] OCR cho PDF scan (tesseract.js, ~2MB/ngôn ngữ) — cân nhắc sau.
- [x] Setting kích thước trang cho EPUB → PDF (2026-10-07): pdf-render worker
      gọi `doc.layout(w, h, 12)` trước khi đếm trang; UI chọn Default (A5) /
      A4 / Letter / A5 cho mọi target của epub (pdf/png/cbz/...). Probe
      `.testfiles/epub-layout-probe.mjs` xác nhận layout() hoạt động trên wasm
      build này và là no-op an toàn với pdf/cbz.
- [ ] Gộp nhiều ảnh → 1 PDF nhiều trang (cần luồng UI merge per-file group).
