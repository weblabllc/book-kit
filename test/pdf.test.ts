import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { openPdf, pdfPageCount, toAscii, watermarkPdf, watermarkedPdfPage } from '../src/index.js';

describe('pdf watermark', () => {
    it('stamps every page and keeps the document valid', async () => {
        const doc = await PDFDocument.create();
        doc.addPage();
        doc.addPage();
        const stamped = await watermarkPdf(Buffer.from(await doc.save()), {
            name: 'Богдан Читач',
            email: 'b@test.local',
        });
        const reloaded = await PDFDocument.load(stamped);
        expect(reloaded.getPageCount()).toBe(2);
        expect(stamped.length).toBeGreaterThan(0);
    });
});

describe('toAscii', () => {
    it('transliterates ukrainian preserving case', () => {
        expect(toAscii('Богдан Читач')).toBe('Bohdan Chytach');
        expect(toAscii("П'ять")).toBe("P'iat");
        expect(toAscii('ASCII stays')).toBe('ASCII stays');
    });
});

describe('single page extraction', () => {
    async function threePageDoc(): Promise<Buffer> {
        const doc = await PDFDocument.create();
        for (let i = 0; i < 3; i++) doc.addPage([400, 600]);
        return Buffer.from(await doc.save());
    }

    it('returns one watermarked page and never the whole book', async () => {
        const source = await openPdf(await threePageDoc());
        expect(pdfPageCount(source)).toBe(3);

        const page = await watermarkedPdfPage(source, 1, {name: 'Богдан Читач', email: 'b@test.local'});
        expect(page).not.toBeNull();
        const reloaded = await PDFDocument.load(page!);
        expect(reloaded.getPageCount()).toBe(1);
    });

    it('rejects indexes outside the document instead of guessing', async () => {
        const source = await openPdf(await threePageDoc());
        const watermark = {name: 'Богдан', email: 'b@test.local'};
        expect(await watermarkedPdfPage(source, 3, watermark)).toBeNull();
        expect(await watermarkedPdfPage(source, -1, watermark)).toBeNull();
        expect(await watermarkedPdfPage(source, 1.5, watermark)).toBeNull();
    });

    it('slices repeatedly from the same parsed document', async () => {
        const source = await openPdf(await threePageDoc());
        const watermark = {name: 'Богдан', email: 'b@test.local'};
        for (const index of [0, 2, 0, 1]) {
            const page = await watermarkedPdfPage(source, index, watermark);
            expect((await PDFDocument.load(page!)).getPageCount()).toBe(1);
        }
    });
});
