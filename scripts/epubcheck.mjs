import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fb2ToEpub, watermarkEpub } from '../dist/index.js';

const jar = process.argv[2];
if (!jar) {
    console.error('usage: node scripts/epubcheck.mjs <path to epubcheck.jar>');
    process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), 'ebook-kit-'));
const fixture = name => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url));
const outputs = {
    'pandoc-stamped.epub': watermarkEpub(fixture('pandoc.epub'), { name: 'Іван Тест', email: 'ivan@test.local' }),
    'fb2-converted.epub': fb2ToEpub(fixture('editor-1251.fb2')).epub,
};
for (const [name, data] of Object.entries(outputs)) {
    const file = join(dir, name);
    writeFileSync(file, data);
    execFileSync('java', ['-jar', jar, '--failonwarnings', file], { stdio: 'inherit' });
}
