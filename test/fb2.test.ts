import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { decodeFb2, fb2ToEpub, openEpub, parseEpubManifest, parseFb2, readEpubResource, watermarkFb2 } from '../src/index.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function sampleFb2(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info>
<genre>prose</genre>
<author><first-name>Іван</first-name><last-name>Франко</last-name></author>
<book-title>Захар Беркут &amp; інші</book-title>
<annotation><p>Історична повість.</p></annotation>
<lang>uk</lang>
<coverpage><image l:href="#cover.png"/></coverpage>
</title-info></description>
<body>
<title><p>Захар Беркут</p></title>
<section id="part1"><title><p>Частина перша</p></title>
<epigraph><p>Епіграф</p><text-author>Хтось</text-author></epigraph>
<section id="ch1"><title><p>Розділ I</p></title><p>Перший абзац<a l:href="#n1" type="note">[1]</a>.</p><empty-line/><p>Див. <a l:href="#ch2">далі</a>.</p></section>
<section id="ch2"><title><p>Розділ II</p></title><p><emphasis>Курсив</emphasis> і <strong>жирно</strong>.</p><image l:href="#cover.png"/><poem><stanza><v>Рядок 1</v><v>Рядок 2</v></stanza></poem></section>
</section>
<section><p>Без назви</p></section>
</body>
<body name="notes"><title><p>Примітки</p></title><section id="n1"><title><p>1</p></title><p>Пояснення.</p></section></body>
<binary id="cover.png" content-type="image/png">${PNG.toString('base64')}</binary>
</FictionBook>`;
}

describe('parseFb2', () => {
    it('reads metadata, bodies and binaries', () => {
        const book = parseFb2(Buffer.from(sampleFb2()));
        expect(book.title).toBe('Захар Беркут & інші');
        expect(book.authors).toEqual(['Іван Франко']);
        expect(book.lang).toBe('uk');
        expect(book.coverId).toBe('cover.png');
        expect(book.bodies).toHaveLength(1);
        expect(book.notes).toHaveLength(1);
        expect(book.binaries[0].data.equals(PNG)).toBe(true);
    });

    it('decodes windows-1251 and zipped sources', () => {
        const xml = sampleFb2().replace('encoding="UTF-8"', 'encoding="windows-1251"');
        const cp1251 = Buffer.from(
            Array.from(xml).map(ch => {
                const code = ch.codePointAt(0)!;
                if (code < 128) return code;
                if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
                return { 0x404: 0xaa, 0x454: 0xba, 0x406: 0xb2, 0x456: 0xb3, 0x407: 0xaf, 0x457: 0xbf, 0x2013: 0x96 }[code] ?? 0x3f;
            }),
        );
        expect(decodeFb2(cp1251)).toContain('Захар Беркут');
        const zip = new AdmZip();
        zip.addFile('book.fb2', cp1251);
        expect(decodeFb2(zip.toBuffer())).toContain('Захар Беркут');
    });
});

describe('fb2ToEpub', () => {
    it('splits nested sections into chapters with a nested toc', () => {
        const { epub, chapters, title } = fb2ToEpub(Buffer.from(sampleFb2()));
        expect(title).toBe('Захар Беркут & інші');
        expect(chapters).toBe(3);
        const zip = openEpub(epub);
        expect(zip.getEntries()[0].entryName).toBe('mimetype');
        const manifest = parseEpubManifest(zip);
        expect(manifest.title).toBe('Захар Беркут & інші');
        expect(manifest.spine).toEqual(['title.xhtml', 'ch001.xhtml', 'ch002.xhtml', 'ch003.xhtml', 'ch004.xhtml', 'notes.xhtml']);
        expect(manifest.toc.map(t => [t.label, t.depth])).toEqual([
            ['Захар Беркут & інші', 0],
            ['Частина перша', 0],
            ['Розділ I', 1],
            ['Розділ II', 1],
            ['Без назви', 0],
            ['Примітки', 0],
        ]);
        const ch1 = readEpubResource(zip, manifest, 'ch002.xhtml')!.data.toString('utf8');
        expect(ch1).toContain('<section id="ch1">\n<h1>Розділ I</h1>');
        expect(ch1).toContain('href="notes.xhtml#n1"');
        expect(ch1).toContain('href="ch003.xhtml#ch2"');
        expect(ch1).toContain('<p class="empty">');
        const ch2 = readEpubResource(zip, manifest, 'ch003.xhtml')!.data.toString('utf8');
        expect(ch2).toContain('<em>Курсив</em> і <strong>жирно</strong>');
        expect(ch2).toContain('<img src="images/img-1.png"');
        expect(ch2).toContain('<p class="v">Рядок 1</p>');
        const part = readEpubResource(zip, manifest, 'ch001.xhtml')!.data.toString('utf8');
        expect(part).toContain('Епіграф');
        expect(part).not.toContain('Перший абзац');
        const opf = zip.readAsText('OEBPS/content.opf');
        expect(opf).toContain('properties="cover-image"');
        expect(opf).toContain('<dc:creator>Іван Франко</dc:creator>');
        expect(zip.readAsText('OEBPS/title.xhtml')).toContain('Історична повість');
    });
});

describe('watermarkFb2', () => {
    it('stamps every top-level section of the main body and keeps xml valid', () => {
        const out = watermarkFb2(Buffer.from(sampleFb2()), { name: 'Тест', email: 't@e.ua' }).toString('utf8');
        expect(out.match(/Придбано: Тест · t@e.ua/g)).toHaveLength(2);
        expect(out).toMatch(/<epigraph><p>Епіграф<\/p><text-author>Хтось<\/text-author><\/epigraph>\n<section id="ch1"><title><p>Розділ I<\/p><\/title><p><emphasis>Придбано/);
        expect(out).toMatch(/<section><p><emphasis>Придбано: Тест · t@e.ua<\/emphasis><\/p><p>Без назви/);
        expect(out).not.toMatch(/<section id="n1">(<title>.*?<\/title>)?<p><emphasis>Придбано/);
        expect(() => parseFb2(Buffer.from(out))).not.toThrow();
    });

    it('ignores CDATA and comments, footnotes bodies and self-closing sections', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?><FictionBook><body>
<section><p><![CDATA[ <section> raw ]]></p><!-- <section> --></section>
<section/>
<section><p>Друга</p></section>
</body><body name="footnotes"><section id="n1"><p>Нотатка</p></section></body></FictionBook>`;
        const out = watermarkFb2(Buffer.from(xml), { name: 'Тест', email: 't@e.ua' }).toString('utf8');
        expect(out.match(/Придбано/g)).toHaveLength(2);
        expect(out).toContain('<section><p><emphasis>Придбано: Тест · t@e.ua</emphasis></p><p><![CDATA[ <section> raw ]]></p>');
        expect(out).toContain('<section><p><emphasis>Придбано: Тест · t@e.ua</emphasis></p><p>Друга</p>');
        expect(out).toContain('<section id="n1"><p>Нотатка</p>');
    });
});

describe('fb2ToEpub edge cases', () => {
    it('keeps nav well-formed when untitled wrappers skip a depth level', () => {
        const xml = `<?xml version="1.0"?><FictionBook><description><title-info><book-title>T</book-title></title-info></description>
<body><section><section><section><title><p>A</p></title><p>x</p></section></section></section>
<section><title><p>B</p></title><p>y</p></section></body></FictionBook>`;
        const { epub } = fb2ToEpub(Buffer.from(xml));
        const nav = openEpub(epub).readAsText('OEBPS/nav.xhtml');
        const opens = (nav.match(/<ol>/g) ?? []).length;
        const closes = (nav.match(/<\/ol>/g) ?? []).length;
        expect(opens).toBe(closes);
        expect(nav).not.toMatch(/<ol>\s*<ol>/);
        expect(nav).toContain('>A<');
        expect(nav).toContain('>B<');
    });

    it('wraps a body without sections and treats footnotes as notes', () => {
        const xml = `<?xml version="1.0"?><FictionBook><description><title-info><book-title>T</book-title></title-info></description>
<body><title><p>Назва</p></title><p>Просто текст</p></body>
<body name="footnotes"><section id="n1"><p>Нотатка</p></section></body></FictionBook>`;
        const { epub, chapters } = fb2ToEpub(Buffer.from(xml));
        expect(chapters).toBe(1);
        const zip = openEpub(epub);
        expect(zip.readAsText('OEBPS/ch001.xhtml')).toContain('Просто текст');
        expect(zip.readAsText('OEBPS/notes.xhtml')).toContain('Нотатка');
    });

    it('keeps wrapper section ids and gives binaries collision-free names', () => {
        const xml = `<?xml version="1.0"?><FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>T</book-title></title-info></description>
<body><section id="part1"><title><p>Частина</p></title><section><p>a <a l:href="#part1">назад</a></p><image l:href="#мапа.png"/><image l:href="#фото.png"/></section></section></body>
<binary id="мапа.png" content-type="image/png">AA==</binary><binary id="фото.png" content-type="image/png">AQ==</binary></FictionBook>`;
        const zip = openEpub(fb2ToEpub(Buffer.from(xml)).epub);
        expect(zip.readAsText('OEBPS/ch001.xhtml')).toContain('<section id="part1">');
        expect(zip.readAsText('OEBPS/ch002.xhtml')).toContain('href="ch001.xhtml#part1"');
        expect(zip.getEntry('OEBPS/images/img-1.png')).toBeTruthy();
        expect(zip.getEntry('OEBPS/images/img-2.png')).toBeTruthy();
    });
});
