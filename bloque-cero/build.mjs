// Empaqueta el juego en un único HTML autónomo (sin CDN para el código).
//   dist/bloque-cero.html  documento completo (abrir directamente en el navegador)
//   dist/artifact.html     el mismo contenido sin <html>/<head>/<body> (para publicar como artifact)
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');
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
  // el artifact en construcción se publica aparte del Bloque Cero original
  // (el título del artefacto publicado es el que eligió su dueño en claude.ai)
  fs.writeFileSync('dist/artifact.html', fragment.replace('<title>Bloque Cero</title>', '<title>Rainbow 6 Replica</title>'));
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
