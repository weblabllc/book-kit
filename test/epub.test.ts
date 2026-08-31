import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { openEpub, parseEpubManifest, readEpubResource, watermarkEpub } from '../src/index.js';

function buildEpub(): Buffer {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ));
    zip.addFile('OEBPS/content.opf', Buffer.from(
        `<?xml version="1.0"?><package><metadata><dc:title>Тестова книга</dc:title></metadata>
        <manifest>
            <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
            <item id="css" href="style.css" media-type="text/css"/>
        </manifest>
        <spine><itemref idref="ch1"/></spine></package>`,
    ));
    zip.addFile('OEBPS/ch1.xhtml', Buffer.from('<html><body><p>Привіт</p></body></html>'));
    zip.addFile('OEBPS/style.css', Buffer.from('p{margin:0}'));
    return zip.toBuffer();
}

describe('epub toolkit', () => {
    it('parses manifest with spine and title', () => {
        const manifest = parseEpubManifest(openEpub(buildEpub()));
        expect(manifest.title).toBe('Тестова книга');
        expect(manifest.spine).toEqual(['ch1.xhtml']);
        expect(manifest.items).toHaveLength(2);
        expect(manifest.basePath).toBe('OEBPS/');
    });

    it('serves chunked resources with screen watermark for xhtml only', () => {
        const zip = openEpub(buildEpub());
        const manifest = parseEpubManifest(zip);
        const wm = { name: 'Богдан', email: 'b@test.local' };
        const chapter = readEpubResource(zip, manifest, 'ch1.xhtml', wm)!;
        expect(chapter.data.toString('utf8')).toContain('Придбано: Богдан · b@test.local');
        const css = readEpubResource(zip, manifest, 'style.css', wm)!;
        expect(css.data.toString('utf8')).toBe('p{margin:0}');
        expect(readEpubResource(zip, manifest, '../secret', wm)).toBeNull();
    });

    it('repacks a fully watermarked epub', () => {
        const stamped = watermarkEpub(buildEpub(), { name: 'Ivan', email: 'i@test.local' });
        const out = new AdmZip(stamped);
        expect(out.readAsText('OEBPS/ch1.xhtml')).toContain('Придбано: Ivan');
        expect(out.readAsText('OEBPS/style.css')).toBe('p{margin:0}');
    });
});
