// Hoja de contacto: las capturas de una carpeta en una rejilla con su nombre (para los informes visuales).
// Uso: node tools/hoja-capturas.mjs <carpeta> <salida.png> [columnas=2] [ancho de cada una=800]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [dir, outFile, colsArg, wArg] = process.argv.slice(2);
const cols = +(colsArg || 2), w = +(wArg || 800), h = Math.round(w * 9 / 16);
const files = fs.readdirSync(dir).filter((f) => /^\d\d_.*\.png$/.test(f)).sort();
const rows = Math.ceil(files.length / cols);
const cells = files.map((f) => `<figure><img src="data:image/png;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}"><figcaption>${f.replace(/\.png$/, '').replace(/^\d\d_/, '').replace(/_/g, ' ')}</figcaption></figure>`).join('');
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#111;font:600 15px system-ui;color:#eee}main{display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px;padding:6px}figure{margin:0;position:relative}img{display:block;width:${w}px;height:${h}px}figcaption{position:absolute;left:0;bottom:0;padding:4px 10px;background:rgba(0,0,0,.65);text-transform:uppercase;letter-spacing:.08em}</style><main>${cells}</main>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * (w + 6) + 6, height: rows * (h + 6) + 6 } });
await page.setContent(html);
await page.screenshot({ path: outFile, fullPage: true });
await browser.close();
console.log('hoja', outFile, files.length, 'capturas');
