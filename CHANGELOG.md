# Changelog

## 0.2.0 — 2026-09-12

Added: single-page PDF extraction, so a reader can ask for one page at a
time and no response hands over the whole book.

- `openPdf` / `pdfPageCount` expose a parsed document that can be reused
  across page requests instead of reparsing the file on every page turn
- `watermarkedPdfPage(doc, index, watermark)` returns that one page,
  stamped, as a standalone PDF; a non-integer or out-of-range index
  returns `null` rather than guessing
- `PdfDocument` type exported for callers that cache a parsed document
- `watermarkPdf` is unchanged in behaviour and now shares the stamping
  helpers with the new page path

## 0.1.0 — 2026-09-01

Initial release, extracted and hardened from production projects.
