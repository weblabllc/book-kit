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

function buildSigilEpub(): Buffer {
    const zip = new AdmZip();
    zip.addFile('mimetype', Buffer.from('application/epub+zip'));
    zip.addFile(
        'META-INF/container.xml',
        Buffer.from(`<?xml version="1.0"?><container><rootfiles><rootfile full-path='OEBPS/content.opf' media-type='application/oebps-package+xml'/></rootfiles></container>`),
    );
    zip.addFile(
        'OEBPS/content.opf',
        Buffer.from(`<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Тест &#x2014; книга &amp; ще</dc:title></metadata>
<manifest>
<item id='nav' href='Text/nav.xhtml' media-type='application/xhtml+xml' properties='scripted nav'/>
<item id="c1" href="Text/Section%200001.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="Text/50%.xhtml" media-type="application/xhtml+xml"/>
</manifest><spine><itemref idref='c1'/><itemref idref="c2"/></spine></package>`),
    );
    zip.addFile(
        'OEBPS/Text/nav.xhtml',
        Buffer.from(`<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href='../Text/Section%200001.xhtml'>Перша</a></li><li><a href="./50%.xhtml#top">Друга</a></li></ol></nav></body></html>`),
    );
    zip.addFile('OEBPS/Text/Section 0001.xhtml', Buffer.from('<html><BODY><p>один</p></BODY></html>'));
    zip.addFile('OEBPS/Text/50%.xhtml', Buffer.from('<html><body><p>два</p></body></html>'));
    return zip.toBuffer();
}

describe('sigil-style layout', () => {
    it('normalises ../ in toc links, accepts single quotes, hex entities and odd hrefs', () => {
        const zip = openEpub(buildSigilEpub());
        const m = parseEpubManifest(zip);
        expect(m.title).toBe('Тест — книга & ще');
        expect(m.spine).toEqual(['Text/Section 0001.xhtml', 'Text/50%.xhtml']);
        expect(m.toc.map(t => [t.href, t.anchor])).toEqual([
            ['Text/Section 0001.xhtml', null],
            ['Text/50%.xhtml', 'top'],
        ]);
        expect(m.toc.every(t => m.spine.includes(t.href))).toBe(true);
        expect(m.spineSizes.every(n => n > 0)).toBe(true);
    });

    it('stamps before an uppercase closing body tag', () => {
        const zip = openEpub(buildSigilEpub());
        const m = parseEpubManifest(zip);
        const html = readEpubResource(zip, m, 'Text/Section 0001.xhtml', { name: 'Тест', email: 't@e.ua' })!.data.toString('utf8');
        expect(html).toMatch(/Придбано[\s\S]*<\/BODY>/);
    });
});

describe('screen stamp placement', () => {
    const wm = { name: 'Іван', email: 'i@test.local' };
    const serve = (chapter: string) => {
        const zip = new AdmZip();
        zip.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'));
        zip.addFile('content.opf', Buffer.from('<?xml version="1.0"?><package><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>'));
        zip.addFile('c.xhtml', Buffer.from(chapter));
        const epub = openEpub(zip.toBuffer());
        return readEpubResource(epub, parseEpubManifest(epub), 'c.xhtml', wm)!.data.toString('utf8');
    };

    it('stamps after an uppercase body tag with attributes and before its closing tag', () => {
        const html = serve('<?xml version="1.0"?><html><BODY class="x"><p>Текст</p></BODY></html>');
        expect(html.startsWith('<?xml version="1.0"?><html><BODY class="x"><div')).toBe(true);
        expect(html.endsWith('</div></BODY></html>')).toBe(true);
    });

    it('never puts a stamp in front of the xml declaration when there is no body tag', () => {
        const html = serve('<?xml version="1.0"?><html><p>Текст</p></html>');
        expect(html.startsWith('<?xml')).toBe(true);
        expect(html.split('Придбано:').length - 1).toBe(1);
    });

    it('does not mistake a bodyless tag name for body', () => {
        const html = serve('<html><bodytext>x</bodytext></html>');
        expect(html.split('Придбано:').length - 1).toBe(1);
    });
});
