// Mide rendimiento con el mapa completo cargado en varias configuraciones.
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const file = 'file://' + path.resolve('dist/bloque-cero.html');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function measure(w, h, quality, label) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(file);
  await page.waitForFunction(() => window.__bc && window.__bc.state.mode === 'menu', null, { timeout: 120000 });
  await page.evaluate((q) => { const bc = window.__bc; bc.settings.quality = q; bc.post.setQuality(q); bc.start(); bc.place(15.5, 0, -6.5, Math.PI, 0); }, quality);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(async () => {
    const bc = window.__bc;
    // tiempo de GPU aproximado: forzar gl.finish tras cada frame
    const gl = bc.renderer.getContext();
    const t = [];
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => requestAnimationFrame(res));
      const t0 = performance.now(); gl.finish(); t.push(performance.now() - t0);
    }
    const p = bc.perf();
    const fm = p.frameMs.slice(-60).sort((a, b) => a - b);
    // coste de destrucción: una ráfaga de 10 balas y remallado
    bc.place(9.2, 0, 1.6, -Math.PI / 2, 0.05);
    await new Promise((res) => setTimeout(res, 300));
    const tm = [];
    for (let i = 0; i < 10; i++) {
      bc.player.yaw = -Math.PI / 2 + (i - 5) * 0.03;
      bc.fire(1);
      const t0 = performance.now();
      bc.wr.update(0.016, bc.camera.position, 100);
      tm.push(performance.now() - t0);
    }
    const t0 = performance.now(); bc.breach(); bc.wr.update(0.3, bc.camera.position, 100); bc.wr.renderShadowIfNeeded(true); const tb = performance.now() - t0; const st = bc.wr.stats;
    return { fps: p.fps, cpu: fm[fm.length >> 1], calls: p.calls, tris: p.triangles, gpuWait: t.sort((a, b) => a - b)[10], remesh: tm.reduce((a, b) => a + b) / tm.length, breach: tb, mesh: st.lastMeshMs, region: st.lastRegionMs, light: st.lastLightMs, shadow: st.lastShadowMs };
  });
  console.log(`${label.padEnd(22)} ${String(w + 'x' + h).padEnd(9)} FPS ${r.fps.toFixed(1).padStart(5)} · CPU JS ${r.cpu.toFixed(2)} ms · espera GPU(SW) ${r.gpuWait.toFixed(1)} ms · ${r.calls} llamadas · ${(r.tris / 1000).toFixed(0)}k tri · remallado/bala ${r.remesh.toFixed(2)} ms · brecha ${r.breach.toFixed(1)} ms (malla ${r.mesh.toFixed(1)}, regiones ${r.region.toFixed(1)}, luz ${r.light.toFixed(1)}, sombra ${r.shadow.toFixed(1)})`);
  await page.close();
}
await measure(1280, 720, 'alta', 'alta');
await measure(1280, 720, 'baja', 'baja');
await measure(640, 360, 'alta', 'alta (baja resolución)');
await measure(320, 180, 'baja', 'baja (mínima)');
await browser.close();
