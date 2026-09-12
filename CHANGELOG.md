# Changelog

## 0.3.0 — 2026-09-12

- `parseEpubManifest` now returns `toc` — the book's own table of contents from NCX (EPUB 2) or nav.xhtml (EPUB 3), with labels, target hrefs, anchors and nesting depth. Readers should title chapters from it instead of numbering spine files: a converter-split book has many more files than chapters.
- `spineSizes` — uncompressed byte size per spine item, so reading progress can be weighed by text volume rather than file count.

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
