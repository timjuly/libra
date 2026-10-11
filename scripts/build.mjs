import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const result = await build({
  entryPoints: ['src/client/main.tsx'],
  bundle: true,
  minify: true,
  write: false,
  outdir: 'dist/client',
  target: 'es2022',
  format: 'esm',
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const assets = {};
const paths = {};
const notices = await readFile('THIRD_PARTY_NOTICES.txt', 'utf8');
for (const file of result.outputFiles) {
  const extension = file.path.endsWith('.css') ? 'css' : 'js';
  const body = file.text + (extension === 'js' ? `\n/*\n${notices.replace(/\*\//g, '* /')}\n*/\n` : '');
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
  const path = `/assets/app-${hash}.${extension}`;
  paths[extension] = path;
  assets[path] = {
    type: extension === 'css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
    body,
  };
}
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6f7fb"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Libra · 媒体服务器管理</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${paths.css}"><script type="module" src="${paths.js}"></script></head><body><div id="root"></div><noscript>请开启 JavaScript 以使用 Libra 管理后台。</noscript></body></html>`;
await mkdir('.generated', { recursive: true });
await writeFile(
  '.generated/assets.ts',
  `export const HTML = ${JSON.stringify(html)};\nexport const ASSETS: Record<string, {type: string; body: string}> = ${JSON.stringify(assets)};\n`,
);
console.log(
  `Built ${result.outputFiles.length} browser assets (${Math.round(result.outputFiles.reduce((n, file) => n + file.contents.length, 0) / 1024)} KB).`,
);
