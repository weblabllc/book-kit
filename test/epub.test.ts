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

    it('serves chunked resources with a readable screen watermark at chapter start and end', () => {
        const zip = openEpub(buildEpub());
        const manifest = parseEpubManifest(zip);
        const wm = { name: 'Богдан', email: 'b@test.local' };
        const chapter = readEpubResource(zip, manifest, 'ch1.xhtml', wm)!;
        const html = chapter.data.toString('utf8');
        const occurrences = html.split('Придбано: Богдан · b@test.local').length - 1;
        expect(occurrences).toBe(2);
        expect(html).toContain('opacity:0.6');
        expect(html.indexOf('Придбано:')).toBeLessThan(html.indexOf('<p>Привіт</p>'));
        const css = readEpubResource(zip, manifest, 'style.css', wm)!;
        expect(css.data.toString('utf8')).toBe('p{margin:0}');
        expect(readEpubResource(zip, manifest, '../secret', wm)).toBeNull();
    });

    it('repacks a fully watermarked epub with the unchanged download stamp (end only, lower opacity)', () => {
        const stamped = watermarkEpub(buildEpub(), { name: 'Ivan', email: 'i@test.local' });
        const out = new AdmZip(stamped);
        const html = out.readAsText('OEBPS/ch1.xhtml');
        expect(html).toContain('Придбано: Ivan');
        expect(html).toContain('opacity:0.35');
        expect(html.split('Придбано:').length - 1).toBe(1);
        expect(out.readAsText('OEBPS/style.css')).toBe('p{margin:0}');
    });
});

function buildEpubWithNcx(): Buffer {
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from(
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ));
    zip.addFile('OEBPS/content.opf', Buffer.from(
        `<?xml version="1.0"?><package><metadata><dc:title>З оглавленням</dc:title></metadata>
        <manifest>
            <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
            <item id="t" href="title.xhtml" media-type="application/xhtml+xml"/>
            <item id="c1" href="split_001.xhtml" media-type="application/xhtml+xml"/>
            <item id="c2" href="split_002.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine toc="ncx"><itemref idref="t"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    ));
    zip.addFile('OEBPS/toc.ncx', Buffer.from(
        `<?xml version="1.0"?><ncx><navMap>
          <navPoint id="n1"><navLabel><text>Глава 1 &amp; Ніч</text></navLabel><content src="split_001.xhtml"/>
            <navPoint id="n1a"><navLabel><text>Частина друга</text></navLabel><content src="split_002.xhtml#part2"/></navPoint>
          </navPoint>
        </navMap></ncx>`,
    ));
    zip.addFile('OEBPS/title.xhtml', Buffer.from('<html><body>t</body></html>'));
    zip.addFile('OEBPS/split_001.xhtml', Buffer.from('<html><body>' + 'слово '.repeat(200) + '</body></html>'));
    zip.addFile('OEBPS/split_002.xhtml', Buffer.from('<html><body><p id="part2">x</p></body></html>'));
    return zip.toBuffer();
}

describe('table of contents', () => {
    it('reads NCX labels, anchors and depth', () => {
        const m = parseEpubManifest(openEpub(buildEpubWithNcx()));
        expect(m.toc).toEqual([
            { label: 'Глава 1 & Ніч', href: 'split_001.xhtml', anchor: null, depth: 0 },
            { label: 'Частина друга', href: 'split_002.xhtml', anchor: 'part2', depth: 1 },
        ]);
    });

    it('exposes spine sizes so progress can weigh chapters by text', () => {
        const m = parseEpubManifest(openEpub(buildEpubWithNcx()));
        expect(m.spineSizes).toHaveLength(3);
        expect(m.spineSizes[1]).toBeGreaterThan(m.spineSizes[0]);
    });

    it('returns an empty toc for books without one', () => {
        const m = parseEpubManifest(openEpub(buildEpub()));
        expect(m.toc).toEqual([]);
    });
});
