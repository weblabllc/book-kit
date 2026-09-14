import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';

import { buildEpubZip, ZipEntryInput } from './zip-writer.js';

import type { Watermark } from './index.js';

export interface XmlElement {
    tag: string;
    attrs: Record<string, string>;
    children: XmlNode[];
}

export type XmlNode = XmlElement | string;

export interface Fb2Binary {
    id: string;
    contentType: string;
    data: Buffer;
}

export interface Fb2Book {
    title: string;
    authors: string[];
    lang: string;
    annotation: XmlElement | null;
    coverId: string | null;
    bodies: XmlElement[];
    notes: XmlElement[];
    binaries: Fb2Binary[];
}

export interface Fb2Chapter {
    id: string;
    title: string;
    depth: number;
    html: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

export function decodeXmlEntities(value: string): string {
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
        if (body[0] === '#') {
            const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[body.toLowerCase()] ?? m;
    });
}

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseXml(xml: string): XmlElement {
    const root: XmlElement = { tag: '#root', attrs: {}, children: [] };
    const stack: XmlElement[] = [root];
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
        const parent = stack[stack.length - 1];
        if (m[1] !== undefined) {
            parent.children.push(m[1]);
        } else if (m[2]) {
            const name = m[2].replace(/^[^:]+:/, '');
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tag === name) {
                    stack.length = i;
                    break;
                }
            }
        } else if (m[3]) {
            const attrs: Record<string, string> = {};
            const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
            let a: RegExpExecArray | null;
            while ((a = attrRe.exec(m[4] ?? ''))) {
                attrs[a[1].replace(/^[^:]+:/, '')] = decodeXmlEntities(a[2] ?? a[3] ?? a[4] ?? '');
            }
            const el: XmlElement = { tag: m[3].replace(/^[^:]+:/, ''), attrs, children: [] };
            parent.children.push(el);
            if (!m[5]) stack.push(el);
        } else if (m[6] !== undefined) {
            parent.children.push(decodeXmlEntities(m[6]));
        }
    }
    return root;
}

function child(el: XmlElement | null | undefined, tag: string): XmlElement | null {
    if (!el) return null;
    for (const c of el.children) if (typeof c !== 'string' && c.tag === tag) return c;
    return null;
}

function children(el: XmlElement | null | undefined, tag: string): XmlElement[] {
    if (!el) return [];
    return el.children.filter((c): c is XmlElement => typeof c !== 'string' && c.tag === tag);
}

export function textOf(node: XmlNode | null | undefined): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    return node.children.map(textOf).join('');
}

function normalizeSpace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

export function decodeFb2(data: Buffer): string {
    if (data[0] === 0x50 && data[1] === 0x4b) {
        const zip = new AdmZip(data);
        const entry = zip.getEntries().find(e => !e.isDirectory && /\.fb2$/i.test(e.entryName)) ?? zip.getEntries()[0];
        if (!entry) throw new Error('FB2: empty archive');
        return decodeFb2(entry.getData());
    }
    if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data);
    if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data);
    const head = data.subarray(0, 200).toString('latin1');
    const declared = /encoding=["']([^"']+)["']/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
    try {
        return new TextDecoder(declared).decode(data);
    } catch {
        return data.toString('utf8');
    }
}

const NOTES_BODY = /^(notes|comments|footnotes)$/i;

function wrapLooseBody(body: XmlElement): XmlElement {
    if (children(body, 'section').length) return body;
    const loose = body.children.filter(c => typeof c === 'string' || !['title', 'epigraph', 'image'].includes(c.tag));
    if (!loose.some(c => typeof c !== 'string' || c.trim())) return body;
    const kept = body.children.filter(c => !loose.includes(c));
    return { ...body, children: [...kept, { tag: 'section', attrs: {}, children: loose }] };
}

export function parseFb2(data: Buffer): Fb2Book {
    const root = parseXml(decodeFb2(data));
    const book = child(root, 'FictionBook');
    if (!book) throw new Error('FB2: FictionBook root not found');
    const titleInfo = child(child(book, 'description'), 'title-info');

    const authors = children(titleInfo, 'author')
        .map(a => {
            const parts = ['first-name', 'middle-name', 'last-name'].map(t => normalizeSpace(textOf(child(a, t)))).filter(Boolean);
            return parts.length ? parts.join(' ') : normalizeSpace(textOf(child(a, 'nickname')));
        })
        .filter(Boolean);

    const coverImage = child(child(titleInfo, 'coverpage'), 'image');
    const coverId = coverImage?.attrs.href?.replace(/^#/, '') ?? null;

    const bodies = children(book, 'body');
    const binaries = children(book, 'binary').map(b => ({
        id: b.attrs.id ?? '',
        contentType: b.attrs['content-type'] || 'application/octet-stream',
        data: Buffer.from(textOf(b).replace(/\s+/g, ''), 'base64'),
    }));

    return {
        title: normalizeSpace(textOf(child(titleInfo, 'book-title'))) || 'Без назви',
        authors,
        lang: normalizeSpace(textOf(child(titleInfo, 'lang'))) || 'uk',
        annotation: child(titleInfo, 'annotation'),
        coverId,
        bodies: bodies.filter(b => !NOTES_BODY.test(b.attrs.name ?? '')).map(wrapLooseBody),
        notes: bodies.filter(b => NOTES_BODY.test(b.attrs.name ?? '')),
        binaries: binaries.filter(b => b.id),
    };
}

interface RenderContext {
    anchorFile: Map<string, string>;
    images: Map<string, string>;
    notesFile: string;
}

function collectIds(el: XmlElement, file: string, into: Map<string, string>) {
    if (el.attrs.id) into.set(el.attrs.id, file);
    for (const c of el.children) if (typeof c !== 'string') collectIds(c, file, into);
}

function renderInline(nodes: XmlNode[], ctx: RenderContext): string {
    return nodes.map(n => renderNode(n, ctx, 1)).join('');
}

function renderTitle(el: XmlElement, level: number, ctx: RenderContext): string {
    const lines = el.children
        .filter((c): c is XmlElement => typeof c !== 'string')
        .map(c => (c.tag === 'p' ? renderInline(c.children, ctx) : renderNode(c, ctx, level)))
        .filter(s => s.trim());
    const tag = `h${Math.min(Math.max(level, 1), 6)}`;
    const id = el.attrs.id ? ` id="${escapeXml(el.attrs.id)}"` : '';
    return `<${tag}${id}>${lines.join('<br/>')}</${tag}>\n`;
}

function renderNode(node: XmlNode, ctx: RenderContext, depth: number): string {
    if (typeof node === 'string') return escapeXml(node);
    const id = node.attrs.id ? ` id="${escapeXml(node.attrs.id)}"` : '';
    const inner = () => node.children.map(c => renderNode(c, ctx, depth + 1)).join('');
    switch (node.tag) {
        case 'section':
            return `<section${id}>\n${node.children.map(c => renderNode(c, ctx, depth + 1)).join('')}</section>\n`;
        case 'title':
            return renderTitle(node, depth, ctx);
        case 'subtitle':
            return `<p class="subtitle"${id}>${inner()}</p>\n`;
        case 'p':
            return `<p${id}>${inner()}</p>\n`;
        case 'empty-line':
            return `<p class="empty"> </p>\n`;
        case 'epigraph':
            return `<blockquote class="epigraph"${id}>\n${inner()}</blockquote>\n`;
        case 'cite':
            return `<blockquote${id}>\n${inner()}</blockquote>\n`;
        case 'text-author':
            return `<p class="text-author">${inner()}</p>\n`;
        case 'poem':
            return `<div class="poem"${id}>\n${inner()}</div>\n`;
        case 'stanza':
            return `<div class="stanza">\n${inner()}</div>\n`;
        case 'v':
            return `<p class="v">${inner()}</p>\n`;
        case 'date':
            return `<p class="date">${inner()}</p>\n`;
        case 'annotation':
            return `<div class="annotation"${id}>\n${inner()}</div>\n`;
        case 'emphasis':
            return `<em>${inner()}</em>`;
        case 'strong':
            return `<strong>${inner()}</strong>`;
        case 'strikethrough':
            return `<del>${inner()}</del>`;
        case 'sub':
        case 'sup':
        case 'code':
        case 'table':
        case 'tr':
        case 'th':
        case 'td':
            return `<${node.tag}${id}>${inner()}</${node.tag}>`;
        case 'style':
            return inner();
        case 'a': {
            const href = node.attrs.href ?? '';
            const target = href.startsWith('#') ? `${ctx.anchorFile.get(href.slice(1)) ?? ctx.notesFile}${href}` : href;
            const note = node.attrs.type === 'note' ? ' class="note" epub:type="noteref"' : '';
            return `<a href="${escapeXml(target)}"${note}>${inner()}</a>`;
        }
        case 'image': {
            const ref = (node.attrs.href ?? '').replace(/^#/, '');
            const src = ctx.images.get(ref);
            if (!src) return '';
            const alt = escapeXml(node.attrs.alt ?? node.attrs.title ?? '');
            return depth <= 2 ? `<div class="image"><img src="${src}" alt="${alt}"/></div>\n` : `<img src="${src}" alt="${alt}"/>`;
        }
        default:
            return inner();
    }
}

function extensionFor(contentType: string): string {
    const map: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
    return map[contentType.toLowerCase()] ?? '';
}

function sectionTitle(section: XmlElement, fallback: string): string {
    const text = normalizeSpace(textOf(child(section, 'title')));
    if (text) return text;
    const firstParagraph = normalizeSpace(textOf(child(section, 'p') ?? child(child(section, 'epigraph'), 'p')));
    if (fallback && firstParagraph) {
        return firstParagraph.length > 48 ? `${firstParagraph.slice(0, 45).trimEnd()}…` : firstParagraph;
    }
    return fallback;
}

const CHAPTER_CSS = `body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1, h2, h3 { text-align: center; }
p { text-indent: 1.5em; margin: 0 0 0.3em; text-align: justify; }
p.subtitle { text-indent: 0; text-align: center; font-weight: bold; margin: 1em 0; }
p.text-author { text-indent: 0; text-align: right; font-style: italic; }
p.empty { text-indent: 0; }
p.v { text-indent: 0; margin: 0; }
blockquote.epigraph { margin: 1em 0 1em 30%; font-style: italic; }
div.poem { margin: 1em 0 1em 10%; }
div.stanza { margin-bottom: 1em; }
div.image { text-align: center; margin: 1em 0; }
img { max-width: 100%; }
a.note { vertical-align: super; font-size: 0.75em; text-decoration: none; }
`;

function xhtml(title: string, body: string, lang: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}</body>
</html>
`;
}

export interface Fb2ToEpubResult {
    epub: Buffer;
    title: string;
    authors: string[];
    chapters: number;
}

export function fb2ToEpub(data: Buffer): Fb2ToEpubResult {
    const book = parseFb2(data);
    const files: ZipEntryInput[] = [];
    const zip = { addFile: (name: string, data: Buffer) => files.push({ name, data }) };
    const images = new Map<string, string>();
    const manifest: string[] = [];
    const spine: string[] = [];
    const nav: Array<{ label: string; href: string; depth: number }> = [];

    book.binaries.forEach((bin, index) => {
        const ext = bin.id.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? extensionFor(bin.contentType);
        const path = `images/img-${index + 1}${ext ? `.${ext}` : ''}`;
        images.set(bin.id, path);
        zip.addFile(`OEBPS/${path}`, bin.data);
        const isCover = bin.id === book.coverId;
        manifest.push(
            `<item id="img-${manifest.length}" href="${escapeXml(path)}" media-type="${escapeXml(bin.contentType)}"${isCover ? ' properties="cover-image"' : ''}/>`,
        );
    });

    const anchorFile = new Map<string, string>();
    const notesFile = 'notes.xhtml';
    const units: Array<{ file: string; section: XmlElement; depth: number; leaf: boolean; label: string }> = [];
    const chapterWord = book.lang.startsWith('ru') ? 'Глава' : book.lang.startsWith('en') ? 'Chapter' : 'Розділ';
    let chapterNo = 0;
    const plan = (section: XmlElement, depth: number) => {
        const nested = children(section, 'section');
        const file = `ch${String(units.length + 1).padStart(3, '0')}.xhtml`;
        const leaf = nested.length === 0;
        if (leaf) chapterNo += 1;
        units.push({ file, section, depth, leaf, label: sectionTitle(section, leaf ? `${chapterWord} ${chapterNo}` : '') });
        if (leaf) {
            collectIds(section, file, anchorFile);
            return;
        }
        for (const c of section.children) if (typeof c !== 'string' && c.tag !== 'section') collectIds(c, file, anchorFile);
        if (section.attrs.id) anchorFile.set(section.attrs.id, file);
        for (const inner of nested) plan(inner, depth + 1);
    };
    for (const body of book.bodies) for (const section of children(body, 'section')) plan(section, 0);
    for (const body of book.notes) collectIds(body, notesFile, anchorFile);
    const ctx: RenderContext = { anchorFile, images, notesFile };

    const frontParts: string[] = [];
    if (book.coverId && images.get(book.coverId)) {
        frontParts.push(`<div class="image"><img src="${images.get(book.coverId)}" alt="${escapeXml(book.title)}"/></div>\n`);
    }
    frontParts.push(`<h1>${escapeXml(book.title)}</h1>\n`);
    for (const author of book.authors) frontParts.push(`<p class="subtitle">${escapeXml(author)}</p>\n`);
    for (const body of book.bodies) {
        const bodyTitle = child(body, 'title');
        if (bodyTitle) frontParts.push(renderTitle(bodyTitle, 2, ctx));
        for (const e of children(body, 'epigraph')) frontParts.push(renderNode(e, ctx, 1));
    }
    if (book.annotation) frontParts.push(renderNode(book.annotation, ctx, 1));
    zip.addFile('OEBPS/title.xhtml', Buffer.from(xhtml(book.title, frontParts.join(''), book.lang)));
    manifest.push(`<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push('title');
    nav.push({ label: book.title, href: 'title.xhtml', depth: 0 });

    units.forEach((unit, i) => {
        const id = `ch${i + 1}`;
        const html = unit.leaf
            ? renderNode(unit.section, ctx, 0)
            : `<section${unit.section.attrs.id ? ` id="${escapeXml(unit.section.attrs.id)}"` : ''}>\n${unit.section.children
                  .filter(c => typeof c === 'string' || c.tag !== 'section')
                  .map(c => renderNode(c, ctx, 1))
                  .join('')}</section>\n`;
        zip.addFile(`OEBPS/${unit.file}`, Buffer.from(xhtml(unit.label || book.title, html, book.lang)));
        manifest.push(`<item id="${id}" href="${unit.file}" media-type="application/xhtml+xml"/>`);
        spine.push(id);
        if (unit.label) nav.push({ label: unit.label, href: unit.file, depth: unit.depth });
    });
    const chapterCount = units.filter(u => u.leaf).length;

    if (book.notes.length) {
        const parts = book.notes.map(body => {
            const bodyTitle = child(body, 'title');
            return (bodyTitle ? renderTitle(bodyTitle, 2, ctx) : '') + children(body, 'section').map(s => renderNode(s, ctx, 3)).join('');
        });
        zip.addFile(`OEBPS/${notesFile}`, Buffer.from(xhtml('Примітки', parts.join(''), book.lang)));
        manifest.push(`<item id="notes" href="${notesFile}" media-type="application/xhtml+xml"/>`);
        spine.push('notes');
        nav.push({ label: 'Примітки', href: notesFile, depth: 0 });
    }

    interface NavNode { label: string; href: string; children: NavNode[] }
    const navRoot: NavNode[] = [];
    const navStack: NavNode[][] = [navRoot];
    for (const entry of nav) {
        const level = Math.min(entry.depth, navStack.length - 1);
        navStack.length = level + 1;
        const node: NavNode = { label: entry.label, href: entry.href, children: [] };
        navStack[level].push(node);
        navStack.push(node.children);
    }
    const renderNav = (nodes: NavNode[]): string =>
        nodes.length
            ? `<ol>\n${nodes
                  .map(n => `<li><a href="${escapeXml(n.href)}">${escapeXml(n.label)}</a>${n.children.length ? `\n${renderNav(n.children)}` : ''}</li>`)
                  .join('\n')}\n</ol>`
            : '';
    const navList = [renderNav(navRoot)];
    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>Зміст</title></head>
<body><nav epub:type="toc" id="toc"><h1>Зміст</h1>
${navList.join('\n')}
</nav></body></html>
`;
    zip.addFile('OEBPS/nav.xhtml', Buffer.from(navXhtml));
    manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);

    const uid = `urn:uuid:${randomUUID()}`;
    const navPoints = nav
        .filter(n => n.depth === 0)
        .map(
            (n, i) =>
                `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(n.label)}</text></navLabel><content src="${escapeXml(n.href)}"/></navPoint>`,
        )
        .join('\n');
    const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uid}"/><meta name="dtb:depth" content="1"/></head>
<docTitle><text>${escapeXml(book.title)}</text></docTitle>
<navMap>
${navPoints}
</navMap>
</ncx>
`;
    zip.addFile('OEBPS/toc.ncx', Buffer.from(ncx));
    manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
    zip.addFile('OEBPS/style.css', Buffer.from(CHAPTER_CSS));
    manifest.push(`<item id="css" href="style.css" media-type="text/css"/>`);

    const description = normalizeSpace(textOf(book.annotation));
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${escapeXml(book.lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${uid}</dc:identifier>
<dc:title>${escapeXml(book.title)}</dc:title>
${book.authors.map(a => `<dc:creator>${escapeXml(a)}</dc:creator>`).join('\n')}
<dc:language>${escapeXml(book.lang)}</dc:language>
${description ? `<dc:description>${escapeXml(description)}</dc:description>` : ''}
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.map(id => `<itemref idref="${id}"/>`).join('\n')}
</spine>
</package>
`;
    zip.addFile('OEBPS/content.opf', Buffer.from(opf));
    zip.addFile(
        'META-INF/container.xml',
        Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`),
    );

    return { epub: buildEpubZip(files), title: book.title, authors: book.authors, chapters: chapterCount };
}

export function watermarkFb2(data: Buffer, watermark: Watermark): Buffer {
    const xml = decodeFb2(data);
    const stamp = `<p><emphasis>Придбано: ${escapeXml(watermark.name)} · ${escapeXml(watermark.email)}</emphasis></p>`;
    const re =
        /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<body\b[^>]*>|<\/body\s*>|<section\b[^>]*\/>|<section\b[^>]*>|<\/section\s*>|<title\b[^>]*>[\s\S]*?<\/title\s*>|<epigraph\b[^>]*>[\s\S]*?<\/epigraph\s*>|<annotation\b[^>]*>[\s\S]*?<\/annotation\s*>|<image\b[^>]*\/>|<[^>]+>/g;
    const isHead = (token: string) => /^<(title|epigraph|annotation|image)\b/.test(token);
    let depth = 0;
    let inNotes = false;
    let pending = false;
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
        const token = m[0];
        const opensSection = token.startsWith('<section') && !token.endsWith('/>');
        if (pending && !isHead(token) && !opensSection && !token.startsWith('<!')) {
            out += stamp;
            pending = false;
        }
        out += xml.slice(last, m.index) + token;
        last = m.index + token.length;
        if (token.startsWith('<!')) continue;
        if (token.startsWith('<body')) {
            inNotes = NOTES_BODY.test(/name\s*=\s*["']([^"']*)["']/.exec(token)?.[1] ?? '');
            depth = 0;
        } else if (token.startsWith('</body')) {
            inNotes = false;
            pending = false;
        } else if (opensSection) {
            depth += 1;
            if (depth === 1 && !inNotes) pending = true;
        } else if (token.startsWith('</section')) {
            depth -= 1;
            pending = false;
        }
    }
    out += xml.slice(last);
    out = out.replace(/^(\s*<\?xml[^>]*encoding=)["'][^"']+["']/, '$1"UTF-8"');
    return Buffer.from(out, 'utf8');
}
