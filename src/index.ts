import AdmZip from 'adm-zip';
import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';

export interface Watermark {
    name: string;
    email: string;
}

export interface EpubManifestItem {
    href: string;
    mediaType: string;
    inSpine: boolean;
}

export interface EpubManifest {
    title: string | null;
    basePath: string;
    items: EpubManifestItem[];
    spine: string[];
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

    const title = /<dc:title[^>]*>([^<]*)<\/dc:title>/.exec(opf)?.[1] ?? null;

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

    return { title, basePath, items: [...items.values()], spine };
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
    const stamped = new AdmZip();
    for (const entry of original.getEntries()) {
        if (entry.isDirectory) continue;
        let entryData = entry.getData();
        if (/\.x?html?$/i.test(entry.entryName)) {
            entryData = injectStamp(entryData, watermark);
        }
        stamped.addFile(entry.entryName, entryData);
    }
    return stamped.toBuffer();
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
