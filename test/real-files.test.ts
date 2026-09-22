import AdmZip from 'adm-zip';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { fb2ToEpub, openEpub, openPdf, pdfPageCount, watermarkedPdfPage, watermarkPdf, parseEpubManifest, parseFb2, readEpubResource, watermarkEpub, watermarkFb2 } from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const wm = { name: 'Іван Тест', email: 'ivan@test.local' };

describe('pandoc epub3', () => {
    const book = fixture('pandoc.epub');

    it('reads title, spine and a nested toc with cyrillic anchors', () => {
        const manifest = parseEpubManifest(openEpub(book));
        expect(manifest.title).toBe('Тестова книга');
        expect(manifest.basePath).toBe('EPUB/');
        expect(manifest.spine).toEqual(['text/title_page.xhtml', 'text/ch001.xhtml', 'text/ch002.xhtml', 'text/ch003.xhtml']);
        expect(manifest.toc.map(e => [e.label, e.href, e.anchor, e.depth])).toEqual([
            ['Розділ перший', 'text/ch001.xhtml', 'розділ-перший', 0],
            ['Підрозділ', 'text/ch001.xhtml', 'підрозділ', 1],
            ['Chapter Two', 'text/ch002.xhtml', 'chapter-two', 0],
            ['Розділ третій', 'text/ch003.xhtml', 'розділ-третій', 0],
        ]);
        expect(manifest.spineSizes).toHaveLength(4);
    });

    it('serves nested resources and refuses paths outside the manifest', () => {
        const zip = openEpub(book);
        const manifest = parseEpubManifest(zip);
        expect(readEpubResource(zip, manifest, 'text/ch001.xhtml', wm)!.data.toString()).toContain('Придбано: Іван Тест');
        expect(readEpubResource(zip, manifest, 'styles/stylesheet1.css', wm)!.mediaType).toBe('text/css');
        expect(readEpubResource(zip, manifest, 'META-INF/container.xml')).toBeNull();
    });

    it('repacks with mimetype first and stored, stamping every chapter', () => {
        const out = new AdmZip(watermarkEpub(book, wm));
        const [first] = out.getEntries();
        expect(first.entryName).toBe('mimetype');
        expect(first.header.method).toBe(0);
        expect(out.readAsText('mimetype')).toBe('application/epub+zip');
        for (const chapter of ['ch001', 'ch002', 'ch003']) {
            expect(out.readAsText(`EPUB/text/${chapter}.xhtml`)).toContain('Придбано: Іван Тест · ivan@test.local');
        }
        expect(out.getEntries().map(e => e.entryName).sort()).toEqual(new AdmZip(book).getEntries().map(e => e.entryName).sort());
    });
});

describe('fb2 from FictionBook Editor in windows-1251', () => {
    const source = fixture('editor-1251.fb2');

    it('decodes metadata, cover and notes', () => {
        const book = parseFb2(source);
        expect(book.title).toBe('Книга & «тест»');
        expect(book.authors).toEqual(['Тарас Тестенко']);
        expect(book.binaries.map(b => b.id)).toEqual(['cover.png']);
    });

    it('converts to an epub that keeps chapters, images and footnotes', () => {
        const result = fb2ToEpub(source);
        expect(result.title).toBe('Книга & «тест»');
        const zip = new AdmZip(result.epub);
        expect(zip.getEntries()[0].entryName).toBe('mimetype');
        const text = zip.getEntries().filter(e => e.entryName.endsWith('.xhtml')).map(e => e.getData().toString()).join('\n');
        for (const piece of ['Частина перша', 'Розділ 1', 'Рядок вірша', 'Текст виноски.', 'Кінець.', '<table']) {
            expect(text).toContain(piece);
        }
        expect(zip.getEntries().some(e => /images\/.+\.png$/.test(e.entryName))).toBe(true);
        const manifest = parseEpubManifest(openEpub(result.epub));
        expect(manifest.toc.map(e => e.label)).toEqual(expect.arrayContaining(['Частина перша', 'Розділ 1', 'Розділ 2', 'Частина друга']));
    });

    it('stamps each top-level section and re-encodes as utf-8', () => {
        const stamped = watermarkFb2(source, wm).toString('utf8');
        expect(stamped.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
        expect(stamped.match(/Придбано: Іван Тест/g)).toHaveLength(2);
        expect(parseFb2(Buffer.from(stamped)).title).toBe('Книга & «тест»');
    });
});

describe('pdf produced by macOS Quartz', () => {
    const source = fixture('quartz.pdf');

    it('stamps every page and keeps the page count', async () => {
        const stamped = await watermarkPdf(source, wm);
        expect(stamped.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdfPageCount(await openPdf(stamped))).toBe(2);
    });

    it('extracts a single stamped page', async () => {
        const doc = await openPdf(source);
        const page = await watermarkedPdfPage(doc, 1, wm);
        expect(pdfPageCount(await openPdf(Buffer.from(page)))).toBe(1);
    });
});
