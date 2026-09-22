# Changelog

## 0.5.0 — 2026-09-22

- Package renamed to `@weblabllc/ebook-kit`.
- Real-file tests: an EPUB 3 built by pandoc (nested toc with Cyrillic anchors, repack keeps every entry, `mimetype` first and stored), a FictionBook Editor FB2 in windows-1251 (cover, poem, table, footnotes, epigraph) and a PDF produced by macOS Quartz.
- `scripts/epubcheck.mjs` validates the watermarked EPUB and the FB2 conversion with W3C EPUBCheck; CI runs it on every push.

## 0.4.1
- EPUB: attribute values in single quotes, `../` and `./` in toc/nav hrefs normalised against the spine, hex entities in titles, tolerant `decodeURIComponent`, case-insensitive `</body>` for the stamp
- PDF: stamp positioned from the crop box, follows page rotation; e-mail transliterated too, diacritics folded (Zoë → Zoe)
- FB2: recursive nav (well-formed at any depth), collision-free image names, `footnotes` body treated as notes, body without sections kept, wrapper section ids preserved, stamp placed after title/epigraph/annotation, CDATA and comments ignored
- zip-writer: explicit error instead of a corrupt archive beyond ZIP32 limits
- `@types/adm-zip` moved to dependencies (public `EpubArchive` type)

## 0.4.0
- FB2: `parseFb2`, `fb2ToEpub`, `watermarkFb2`; own spec-ordered zip writer (`mimetype` first, stored)

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
