import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { toAscii, watermarkPdf } from '../src/index.js';

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
