# @risklight/ebook-kit

Framework-free EPUB/PDF toolkit for selling e-books: parse an EPUB into a spine manifest, serve it chapter by chapter (the full file never reaches the browser), watermark every copy with the buyer's identity. Pure functions over `Buffer` — storage (S3, disk) and auth stay in your app.

## Install

```bash
npm install @risklight/ebook-kit
```

## Chunked reader backend

```ts
import { openEpub, parseEpubManifest, readEpubResource } from '@risklight/ebook-kit'

const zip = openEpub(await storage.get(key))          // cacheable
const manifest = parseEpubManifest(zip)               // { title, spine, items, basePath }
const chapter = readEpubResource(zip, manifest, manifest.spine[0], {
  name: 'Богдан Читач', email: 'b@shop.ua',           // screen watermark, xhtml only
})
```

Paths outside the manifest return `null` — clients cannot invent them.

## Watermarked downloads

```ts
import { watermarkEpub, watermarkPdf } from '@risklight/ebook-kit'

const epub = watermarkEpub(original, buyer)   // stamp injected into every chapter
const pdf  = await watermarkPdf(original, buyer) // one line per page; cyrillic names transliterated
```

Known limit: the PDF stamp uses Helvetica, so cyrillic is transliterated (`Prydbano: Bohdan Chytach`). Embedding a cyrillic font is a planned improvement.

## FB2

`fb2ToEpub(buffer)` turns a FictionBook 2 file (plain, zipped, any declared encoding) into an EPUB 3: one XHTML per leaf section, part pages for sections that only wrap other sections, nested `nav` + NCX, notes body as `notes.xhtml` with `epub:type="noteref"` links, cover marked `cover-image`. `watermarkFb2(buffer, watermark)` stamps the buyer into the first paragraph of every top-level section of the main body and returns UTF-8 FB2.

```ts
import { fb2ToEpub, watermarkFb2 } from '@risklight/ebook-kit'

const { epub, title, chapters } = fb2ToEpub(fb2Buffer)
const stamped = watermarkFb2(fb2Buffer, { name: 'Іван Тест', email: 'ivan@example.com' })
```

EPUB output (both here and from `watermarkEpub`) is written with a stored `mimetype` entry first, as the spec requires.

## Test

```bash
npm test
```
