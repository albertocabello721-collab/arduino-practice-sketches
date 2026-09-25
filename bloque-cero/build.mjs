// Empaqueta el juego en un único HTML autónomo (sin CDN para el código).
//   dist/bloque-cero.html  documento completo (abrir directamente en el navegador)
//   dist/artifact.html     el mismo contenido para publicar como artifact (con su envoltorio y título)
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');
const ARTIFACT_HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';
const ARTIFACT_TAIL = '\n</body></html>';
const minify = !process.argv.includes('--dev');

async function build() {
  const t0 = Date.now();
  const res = await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify,
    legalComments: 'none',
    write: false,
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const tpl = fs.readFileSync('index.template.html', 'utf8');
  const fragment = tpl.replace('/*__SCRIPT__*/', () => js);
  fs.mkdirSync('dist', { recursive: true });
  // el artefacto publicado: con el envoltorio de documento y el título que tiene en claude.ai
  // («Bloque Cero»; se conservan tal como los dejó la última versión publicada)
  fs.writeFileSync('dist/artifact.html', ARTIFACT_HEAD + fragment + ARTIFACT_TAIL);
  const full = `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${fragment}\n</html>\n`;
  fs.writeFileSync('dist/bloque-cero.html', full);
  console.log(`dist/bloque-cero.html ${(full.length / 1024).toFixed(0)} KB en ${Date.now() - t0} ms`);
}

if (watch) {
  await build();
  fs.watch('src', { recursive: true }, () => build().catch((e) => console.error(e.message)));
  fs.watch('index.template.html', () => build().catch((e) => console.error(e.message)));
} else {
  await build();
}
