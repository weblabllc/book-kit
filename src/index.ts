import AdmZip from 'adm-zip';
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';

import { buildEpubZip, ZipEntryInput } from './zip-writer.js';

export interface Watermark {
    name: string;
    email: string;
}

export interface EpubManifestItem {
    href: string;
    mediaType: string;
    inSpine: boolean;
}

export interface EpubTocEntry {
    label: string;
    href: string;
    anchor: string | null;
    depth: number;
}

export interface EpubManifest {
    title: string | null;
    basePath: string;
    items: EpubManifestItem[];
    spine: string[];
    toc: EpubTocEntry[];
    spineSizes: number[];
}

export type EpubArchive = AdmZip;

export function openEpub(data: Buffer): EpubArchive {
    return new AdmZip(data);
}

export function parseEpubManifest(zip: EpubArchive): EpubManifest {
    const container = zip.readAsText('META-INF/container.xml');
    const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
    if (!opfPath) throw new Error('EPUB: rootfile not found');
    const basePath = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opf = zip.readAsText(opfPath);

    const rawTitle = /<dc:title[^>]*>([^<]*)<\/dc:title>/.exec(opf)?.[1];
    const title = rawTitle ? decodeEntities(rawTitle) : null;

    const items = new Map<string, EpubManifestItem>();
    const itemRe = /<item\s+[^>]*?\/?>/g;
    for (const match of opf.match(itemRe) ?? []) {
        const id = /(?:^|\s)id="([^"]+)"/.exec(match)?.[1];
        const href = /href="([^"]+)"/.exec(match)?.[1];
        const mediaType = /media-type="([^"]+)"/.exec(match)?.[1];
        if (id && href && mediaType) {
            items.set(id, { href: decodeURIComponent(href), mediaType, inSpine: false });
        }
    }

    const spine: string[] = [];
    const spineSection = /<spine[\s\S]*?<\/spine>/.exec(opf)?.[0] ?? '';
    for (const match of spineSection.match(/<itemref\s+[^>]*?\/?>/g) ?? []) {
        const idref = /idref="([^"]+)"/.exec(match)?.[1];
        const item = idref ? items.get(idref) : undefined;
        if (item) {
            item.inSpine = true;
            spine.push(item.href);
        }
    }

    const toc = parseToc(zip, opf, basePath, items);
    const spineSizes = spine.map(href => {
        const entry = zip.getEntry(basePath + href) ?? zip.getEntry(href);
        return entry ? entry.header.size : 0;
    });

    return { title, basePath, items: [...items.values()], spine, toc, spineSizes };
}

function decodeEntities(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/\s+/g, ' ')
        .trim();
}

function splitHref(src: string, tocDir: string, basePath: string): { href: string; anchor: string | null } {
    const [rawPath, rawAnchor] = decodeURIComponent(src).split('#');
    const joined = tocDir + rawPath;
    const href = joined.startsWith(basePath) ? joined.slice(basePath.length) : joined;
    return { href: href.replace(/^\.\//, ''), anchor: rawAnchor || null };
}

function parseToc(
    zip: EpubArchive,
    opf: string,
    basePath: string,
    items: Map<string, EpubManifestItem>,
): EpubTocEntry[] {
    const navItem = [...opf.matchAll(/<item\s+[^>]*?\/?>/g)]
        .map(m => m[0])
        .find(tag => /properties="[^"]*\bnav\b[^"]*"/.test(tag));
    if (navItem) {
        const href = /href="([^"]+)"/.exec(navItem)?.[1];
        const entry = href ? zip.getEntry(basePath + decodeURIComponent(href)) : null;
        if (entry) {
            const parsed = parseNavXhtml(entry.getData().toString('utf8'), dirOf(basePath + decodeURIComponent(href!)), basePath);
            if (parsed.length) return parsed;
        }
    }

    const ncxId = /<spine[^>]*\btoc="([^"]+)"/.exec(opf)?.[1];
    const ncxItem =
        (ncxId && items.get(ncxId)) ??
        [...items.values()].find(i => i.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem) {
        const path = basePath + ncxItem.href;
        const entry = zip.getEntry(path) ?? zip.getEntry(ncxItem.href);
        if (entry) return parseNcx(entry.getData().toString('utf8'), dirOf(path), basePath);
    }
    return [];
}

function dirOf(path: string): string {
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

function parseNcx(xml: string, tocDir: string, basePath: string): EpubTocEntry[] {
    const out: EpubTocEntry[] = [];
    const tokens = xml.match(/<navPoint\b[^>]*>|<\/navPoint>|<text>[\s\S]*?<\/text>|<content\b[^>]*\/?>/g) ?? [];
    let depth = -1;
    let pendingLabel: string | null = null;
    for (const token of tokens) {
        if (token.startsWith('<navPoint')) {
            depth += 1;
            pendingLabel = null;
        } else if (token === '</navPoint>') {
            depth -= 1;
        } else if (token.startsWith('<text>')) {
            if (pendingLabel === null) pendingLabel = decodeEntities(token.slice(6, -7));
        } else if (token.startsWith('<content')) {
            const src = /src="([^"]+)"/.exec(token)?.[1];
            if (src && pendingLabel !== null) {
                out.push({ label: pendingLabel, ...splitHref(src, tocDir, basePath), depth: Math.max(depth, 0) });
                pendingLabel = null;
            }
        }
    }
    return out;
}

function parseNavXhtml(html: string, tocDir: string, basePath: string): EpubTocEntry[] {
    const navMatch = /<nav\b[^>]*epub:type="[^"]*\btoc\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i.exec(html);
    if (!navMatch) return [];
    const out: EpubTocEntry[] = [];
    const tokens = navMatch[1].match(/<ol\b[^>]*>|<\/ol>|<a\b[^>]*href="[^"]+"[^>]*>[\s\S]*?<\/a>/gi) ?? [];
    let depth = -1;
    for (const token of tokens) {
        if (/^<ol/i.test(token)) depth += 1;
        else if (/^<\/ol/i.test(token)) depth -= 1;
        else {
            const href = /href="([^"]+)"/i.exec(token)?.[1];
            const label = decodeEntities(token.replace(/<[^>]+>/g, ''));
            if (href && label) out.push({ label, ...splitHref(href, tocDir, basePath), depth: Math.max(depth, 0) });
        }
    }
    return out;
}

export function readEpubResource(
    zip: EpubArchive,
    manifest: EpubManifest,
    href: string,
    watermark?: Watermark,
): { data: Buffer; mediaType: string } | null {
    const item = manifest.items.find(i => i.href === href);
    if (!item) return null;
    const entry = zip.getEntry(manifest.basePath + href) ?? zip.getEntry(href);
    if (!entry) return null;
    let data = entry.getData();
    if (watermark && /xhtml|html/.test(item.mediaType)) {
        data = injectStamp(data, watermark);
    }
    return { data, mediaType: item.mediaType };
}

export function watermarkEpub(data: Buffer, watermark: Watermark): Buffer {
    const original = new AdmZip(data);
    const entries: ZipEntryInput[] = [];
    for (const entry of original.getEntries()) {
        if (entry.isDirectory) continue;
        let entryData = entry.getData();
        if (/\.x?html?$/i.test(entry.entryName)) {
            entryData = injectStamp(entryData, watermark);
        }
        entries.push({ name: entry.entryName, data: entryData });
    }
    return buildEpubZip(entries);
}

export type PdfDocument = PDFDocument;

export function openPdf(data: Buffer): Promise<PdfDocument> {
    return PDFDocument.load(data);
}

export function pdfPageCount(doc: PdfDocument): number {
    return doc.getPageCount();
}

export async function watermarkPdf(data: Buffer, watermark: Watermark): Promise<Buffer> {
    const doc = await PDFDocument.load(data);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const line = stampLine(watermark);
    for (const page of doc.getPages()) {
        stampPage(page, font, line);
    }
    return Buffer.from(await doc.save());
}

/**
 * A single page lifted out of an already-parsed document, watermarked and
 * returned as a standalone PDF. A reader that asks page by page never gets a
 * response it could save as the whole book, and the source is parsed once
 * instead of once per page turn.
 */
export async function watermarkedPdfPage(
    doc: PdfDocument,
    pageIndex: number,
    watermark: Watermark,
): Promise<Buffer | null> {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.getPageCount()) return null;
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(doc, [pageIndex]);
    out.addPage(page);
    const font = await out.embedFont(StandardFonts.Helvetica);
    stampPage(page, font, stampLine(watermark));
    return Buffer.from(await out.save());
}

function stampLine(watermark: Watermark): string {
    return `Prydbano: ${[toAscii(watermark.name), watermark.email].filter(Boolean).join(' - ')}`;
}

function stampPage(page: PDFPage, font: PDFFont, line: string): void {
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(line, 8);
    page.drawText(line, {
        x: Math.max(20, (width - textWidth) / 2),
        y: 14,
        size: 8,
        font,
        color: rgb(0.55, 0.55, 0.55),
        opacity: 0.6,
    });
}

function injectStamp(data: Buffer, watermark: Watermark): Buffer {
    const stamp = buildStamp(watermark);
    const text = data.toString('utf8');
    return Buffer.from(
        text.includes('</body>') ? text.replace('</body>', `${stamp}</body>`) : text + stamp,
        'utf8',
    );
}

const TRANSLIT: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i',
    ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'e', ъ: '',
};

export function toAscii(value: string): string {
    return value
        .split('')
        .map(ch => {
            if (/[\x20-\x7e]/.test(ch)) return ch;
            const lower = ch.toLowerCase();
            const mapped = TRANSLIT[lower];
            if (mapped === undefined) return '';
            return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
        })
        .join('')
        .trim();
}

export function buildStamp(watermark: Watermark): string {
    return `<div style="opacity:0.35;font-size:10px;text-align:center;padding:8px 0">Придбано: ${escapeHtml(
        watermark.name,
    )} · ${escapeHtml(watermark.email)}</div>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export {
    decodeFb2,
    fb2ToEpub,
    parseFb2,
    parseXml,
    watermarkFb2,
    type Fb2Binary,
    type Fb2Book,
    type Fb2ToEpubResult,
    type XmlElement,
    type XmlNode,
} from './fb2.js';
export { buildEpubZip, buildZip, type ZipEntryInput } from './zip-writer.js';
