// ¿A qué distancia deja de distinguirse en pantalla un operador a oscuras? (F10.4d) Campo de pruebas a
// la hora que se pida, el jugador en el jardín trasero mirando al este (una línea de 25 m despejada y
// a oscuras: luz 0,14 de noche) y un operador de la fila a 5, 10, 15, 20 y 25 m. Dos capturas por
// distancia, con y sin él (la exposición automática ya asentada): los píxeles que cambian son el
// operador; su luminancia media contra la del fondo en esos mismos píxeles da el contraste (Weber:
// (La − Lb) / Lb; Michelson: |La − Lb| / (La + Lb)), y el percentil 90 de la diferencia por píxel
// dice si tiene algún brillo que lo delate (un borde, el casco).
// El grano del post-proceso se apaga para medir (si no, cada captura trae ruido). Solo se mira la caja
// de pantalla donde cae el operador (de 1,75 m, a `d` m: 650/d píxeles de alto a 540p con 72°).
// Con `luz` (0…1), una noche más oscura de lo normal (la luna y el cielo escalados): sirve para ver a
// qué distancia se pierde el operador con menos luz de la que hay en la Villa (0,14 bajo la luna).
// Uso: node tools/medir-contraste.mjs [hora=noche] [sitio=jardin|calle] [carpeta para capturas] [html] [--luz 0.07]
import { createRequire } from 'node:module';
import path from 'node:path';
import { readPNG } from './png.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const argv = process.argv.slice(2), li = argv.indexOf('--luz');
const LUZ = li >= 0 ? +argv[li + 1] : null;
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--luz'));
const hora = pos[0] || 'noche';
const sitio = pos[1] || 'jardin';
const out = pos[2] || '.';
const html = pos[3] || 'dist/bloque-cero.html';
// el jardín trasero (una línea de 30 m despejada hacia el este) o la calle (45 m hacia el este, a oscuras salvo bajo las farolas)
const LINE = sitio === 'calle' ? { x: 0, z: -15, dist: [5, 10, 15, 20, 25, 30, 35, 40, 45] } : { x: 6, z: 40, dist: [5, 10, 15, 20, 25, 30] };
const DIST = LINE.dist;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const frames = (n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => { if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), n);
await page.goto('file://' + path.resolve(html));
await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 180000 });
await page.mouse.click(5, 5);
await page.evaluate(([hora, LUZ]) => {
  const bc = window.__bc; bc.settings.quality = 'media'; bc.post.setQuality('media');
  if (LUZ !== null) {
    // una noche con menos luz: todo lo que alumbra, escalado (la regla de los bots mide sky × skyLight)
    const T = bc.times[hora], k = LUZ / T.skyLight;
    T.skyLight = LUZ;
    for (const c of ['sunColor', 'skyColor', 'groundColor', 'zenith', 'horizon', 'fogColor', 'sunDisk']) T[c] = T[c].map((v) => v * k);
  }
  const el = document.getElementById('qm-time'); el.value = hora; el.dispatchEvent(new Event('change', { bubbles: true })); bc.start();
}, [hora, LUZ]);
await page.waitForFunction(() => window.__bc.state.mode === 'play');
await page.evaluate((LINE) => {
  const bc = window.__bc, s = bc.session;
  window.__step = s.tick.bind(s); s.tick = () => {};
  bc.hud.show(false);                                   // (sin interfaz ni arma ni grano: solo la escena)
  bc.ctx.vm.setShown(false); bc.ctx.vm.setShown = () => {};
  bc.post.grade.uniforms.uGrain.value = 0; bc.post.setAdaptiveLevel = () => {};
  bc.place(LINE.x, 0, LINE.z, -Math.PI / 2, 0);         // mirando al este
  window.__op = s.lineup[0];
  for (const o of s.lineup) if (o !== window.__op) o.frozen = true;   // (los demás de la fila, fuera)
}, LINE);
// la exposición automática, asentada
const settle = () => page.evaluate(async () => {
  const r = window.__bc.renderer; let last = r.toneMappingExposure, same = 0;
  for (let i = 0; i < 60 && same < 4; i++) { await new Promise((res) => requestAnimationFrame(res)); const e = r.toneMappingExposure; if (Math.abs(e - last) < 0.002) same++; else same = 0; last = e; }
  return +last.toFixed(3);
});
const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const measure = (A, B, d) => {
  const a = readPNG(A), b = readPNG(B), ch = a.ch;
  // la caja donde cae el operador: centrado en x; su centro (0,9 m) queda 0,7 m bajo el ojo
  const hpx = 650 / d, cy = a.h / 2 + 260 / d, cx = a.w / 2;
  const bx0 = Math.max(0, Math.round(cx - Math.max(16, hpx * 0.6))), bx1 = Math.min(a.w - 1, Math.round(cx + Math.max(16, hpx * 0.6)));
  const by0 = Math.max(0, Math.round(cy - hpx * 0.8)), by1 = Math.min(a.h - 1, Math.round(cy + hpx * 0.8));
  let count = 0, sa = 0, sb = 0, y0 = 1e9, y1 = -1, strong = 0, fuera = 0; const diffs = [];
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const i = (y * a.w + x) * ch, la = luma(a.data, i), lb = luma(b.data, i), dl = Math.abs(la - lb);
    const inBox = x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
    if (dl < 6) continue;
    if (!inBox) { fuera++; continue; }
    count++; sa += la; sb += lb; diffs.push(dl); if (dl > 20) strong++;
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (!count) return { px: 0, fuera };
  diffs.sort((u, v) => u - v);
  const La = sa / count, Lb = sb / count;
  return { px: count, alto: y1 - y0 + 1, fuera, La: +La.toFixed(1), Lb: +Lb.toFixed(1), weber: +((La - Lb) / Math.max(1, Lb)).toFixed(3), michelson: +(Math.abs(La - Lb) / Math.max(1, La + Lb)).toFixed(3), p90: +diffs[Math.floor(diffs.length * 0.9)].toFixed(1), fuertes: +(strong / count).toFixed(2) };
};
console.log(`hora ${hora}${LUZ !== null ? ' (luz ' + LUZ + ')' : ''} · ${sitio}, mirando al este desde (${LINE.x}, ${LINE.z})`);
for (const d of DIST) {
  await page.evaluate(([d, LINE]) => {
    const op = window.__op;
    op.frozen = false;
    op.body.pos.x = LINE.x + d; op.body.pos.y = 0; op.body.pos.z = LINE.z; op.yaw = Math.PI / 2;
    op.body.vel.x = op.body.vel.y = op.body.vel.z = 0;
    window.__step(1 / 60); window.__step(1 / 60);
    op.body.pos.x = LINE.x + d; op.body.pos.z = LINE.z; op.yaw = Math.PI / 2;
    window.__step(1 / 60);
  }, [d, LINE]);
  const exp = await settle();
  const A = await page.screenshot({ path: path.join(out, `contraste_${hora}${LUZ !== null ? '_luz' + LUZ : ''}_${sitio}_${d}m.png`) });
  await page.evaluate(() => { window.__op.frozen = true; });
  await frames(4);
  const B = await page.screenshot({ path: path.join(out, `contraste_${hora}${LUZ !== null ? '_luz' + LUZ : ''}_${sitio}_${d}m_fondo.png`) });
  const r = measure(A, B, d);
  const luz = await page.evaluate(([d, LINE]) => { const bc = window.__bc, L = bc.wr.lightVolume.sample(LINE.x + d, 1, LINE.z, {}); return +(L.sky * bc.times[bc.wr.tod].skyLight + L.warm + L.cool).toFixed(3); }, [d, LINE]);
  console.log(`${String(d).padStart(2)} m · luz ${luz} · exposición ${exp} · ${JSON.stringify(r)}`);
}
await browser.close();
