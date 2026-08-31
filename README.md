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

## Test

```bash
npm test
```
