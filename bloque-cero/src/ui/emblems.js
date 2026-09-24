// Emblemas de operador dibujados con Canvas 2D (sin imágenes externas). Cada
// uno es un símbolo sencillo y legible a 24 px, como los iconos del HUD de Siege.
const cache = new Map();

const GLYPHS = {
  // llama
  termo(c) {
    c.beginPath();
    c.moveTo(50, 8);
    c.bezierCurveTo(62, 26, 82, 40, 80, 62);
    c.bezierCurveTo(78, 82, 64, 92, 50, 92);
    c.bezierCurveTo(34, 92, 20, 81, 20, 62);
    c.bezierCurveTo(20, 48, 30, 40, 34, 30);
    c.bezierCurveTo(38, 42, 42, 46, 46, 48);
    c.bezierCurveTo(46, 34, 44, 22, 50, 8);
    c.closePath(); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.moveTo(50, 52); c.bezierCurveTo(58, 62, 64, 68, 62, 76);
    c.bezierCurveTo(60, 84, 54, 86, 50, 86); c.bezierCurveTo(44, 86, 38, 82, 38, 75);
    c.bezierCurveTo(38, 66, 46, 62, 50, 52); c.fill();
    c.restore();
  },
  // rayo en anillo (PEM)
  chispa(c) {
    ring(c, 50, 50, 40, 7);
    c.beginPath();
    c.moveTo(56, 16); c.lineTo(30, 54); c.lineTo(48, 54); c.lineTo(42, 84); c.lineTo(70, 44); c.lineTo(52, 44);
    c.closePath(); c.fill();
  },
  // dron de choque con láser
  pulga(c) {
    rrect(c, 22, 40, 56, 26, 8); c.fill();
    c.beginPath(); c.arc(24, 66, 13, 0, Math.PI * 2); c.arc(76, 66, 13, 0, Math.PI * 2); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(24, 66, 6, 0, Math.PI * 2); c.arc(76, 66, 6, 0, Math.PI * 2); c.fill();
    c.restore();
    c.fillRect(46, 18, 8, 22);
    c.beginPath(); c.arc(50, 16, 7, 0, Math.PI * 2); c.fill();
    c.lineWidth = 4; c.setLineDash([6, 5]);
    c.beginPath(); c.moveTo(57, 14); c.lineTo(92, 4); c.stroke(); c.setLineDash([]);
  },
  // cartucho de brecha
  rompe(c) {
    c.save(); c.translate(50, 50); c.rotate(Math.PI / 5);
    rrect(c, -13, -38, 26, 60, 4); c.fill();
    c.fillRect(-17, 20, 34, 12);
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.fillRect(-13, -22, 26, 5);
    c.beginPath(); c.moveTo(-4, -38); c.lineTo(3, -28); c.lineTo(-2, -24); c.lineTo(5, -14); c.lineTo(0, -14); c.lineTo(-7, -26); c.lineTo(-2, -29); c.closePath(); c.fill();
    c.restore(); c.restore();
  },
  // escudo balístico con visor
  muralla(c) {
    rrect(c, 24, 8, 52, 84, 12); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out';
    rrect(c, 34, 22, 32, 10, 3); c.fill();
    c.fillRect(30, 46, 40, 4);
    c.restore();
    c.lineWidth = 5; c.beginPath(); c.moveTo(14, 70); c.lineTo(24, 64); c.stroke();
  },
  // lanzagranadas de humo: proyectil y nubes
  nube(c) {
    c.beginPath(); c.arc(62, 58, 20, 0, Math.PI * 2); c.arc(44, 66, 16, 0, Math.PI * 2); c.arc(78, 70, 13, 0, Math.PI * 2); c.fill();
    c.fillRect(40, 66, 44, 16);
    c.save(); c.translate(26, 28); c.rotate(Math.PI / 4);
    rrect(c, -7, -16, 14, 30, 6); c.fill();
    c.restore();
    c.lineWidth = 4; c.setLineDash([5, 5]);
    c.beginPath(); c.moveTo(34, 36); c.lineTo(48, 48); c.stroke(); c.setLineDash([]);
  },
  // visor térmico: retícula y silueta de calor
  lumen(c) {
    ring(c, 50, 50, 40, 6);
    c.fillRect(48, 6, 4, 22); c.fillRect(48, 72, 4, 22); c.fillRect(6, 48, 22, 4); c.fillRect(72, 48, 22, 4);
    c.beginPath(); c.arc(50, 40, 8, 0, Math.PI * 2); c.fill();
    rrect(c, 40, 50, 20, 22, 6); c.fill();
  },
  // placa de armadura con cruz
  coraza(c) {
    c.beginPath();
    c.moveTo(22, 14); c.lineTo(38, 14); c.bezierCurveTo(42, 24, 58, 24, 62, 14); c.lineTo(78, 14);
    c.lineTo(80, 80); c.bezierCurveTo(66, 92, 34, 92, 20, 80); c.closePath(); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.fillRect(44, 36, 12, 36); c.fillRect(32, 48, 36, 12);
    c.restore();
  },
  // barrido de radar
  radar(c) {
    ring(c, 50, 50, 40, 6); ring(c, 50, 50, 22, 5);
    c.beginPath(); c.moveTo(50, 50); c.arc(50, 50, 40, -Math.PI / 2, -Math.PI / 2 + 1.1); c.closePath();
    c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    c.beginPath(); c.arc(66, 68, 5, 0, Math.PI * 2); c.fill();
  },
  // batería con rayo
  voltio(c) {
    rrect(c, 24, 20, 52, 70, 6); c.fill();
    c.fillRect(38, 10, 24, 12);
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.moveTo(56, 30); c.lineTo(38, 58); c.lineTo(50, 58); c.lineTo(44, 80); c.lineTo(64, 50); c.lineTo(52, 50); c.closePath(); c.fill();
    c.restore();
  },
  // antena con ondas tachadas
  silencio(c) {
    c.fillRect(45, 40, 10, 50);
    c.beginPath(); c.arc(50, 34, 9, 0, Math.PI * 2); c.fill();
    c.lineWidth = 7; c.lineCap = 'round';
    for (const r of [20, 33]) {
      c.beginPath(); c.arc(50, 34, r, -Math.PI * 0.8, -Math.PI * 0.2); c.stroke();
    }
    c.lineWidth = 8;
    c.beginPath(); c.moveTo(14, 86); c.lineTo(86, 14); c.stroke();
  },
  // trampa láser en un marco
  cepo(c) {
    c.fillRect(14, 12, 12, 78); c.fillRect(74, 12, 12, 78);
    c.beginPath(); c.moveTo(26, 44); c.lineTo(40, 36); c.lineTo(40, 52); c.closePath(); c.fill();
    c.lineWidth = 4; c.setLineDash([7, 4]);
    c.beginPath(); c.moveTo(40, 44); c.lineTo(74, 44); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.arc(50, 72, 9, 0, Math.PI * 2); c.fill();
  },
  // escudo con mira
  guardian(c) {
    c.beginPath();
    c.moveTo(50, 8); c.lineTo(84, 20); c.bezierCurveTo(84, 58, 70, 80, 50, 92); c.bezierCurveTo(30, 80, 16, 58, 16, 20); c.closePath(); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out';
    ring(c, 50, 46, 16, 5);
    c.fillRect(48, 22, 4, 16); c.fillRect(48, 54, 4, 16); c.fillRect(26, 44, 16, 4); c.fillRect(58, 44, 16, 4);
    c.restore();
  },
  // ojo
  ojo(c) {
    c.beginPath(); c.moveTo(8, 50); c.bezierCurveTo(28, 18, 72, 18, 92, 50); c.bezierCurveTo(72, 82, 28, 82, 8, 50); c.closePath(); c.fill();
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(50, 50, 20, 0, Math.PI * 2); c.fill();
    c.restore();
    c.beginPath(); c.arc(50, 50, 11, 0, Math.PI * 2); c.fill();
  },
  // cruz médica
  remedio(c) {
    ring(c, 50, 50, 42, 6);
    c.fillRect(40, 20, 20, 60); c.fillRect(20, 40, 60, 20);
  },
  // nube tóxica (bote de gas)
  tizon(c) {
    c.beginPath();
    c.arc(34, 56, 18, 0, Math.PI * 2); c.arc(52, 42, 22, 0, Math.PI * 2); c.arc(70, 56, 17, 0, Math.PI * 2); c.fill();
    c.fillRect(22, 56, 58, 18);
    c.beginPath(); c.arc(32, 86, 5, 0, Math.PI * 2); c.arc(50, 90, 5, 0, Math.PI * 2); c.arc(68, 86, 5, 0, Math.PI * 2); c.fill();
  },
};

function ring(c, x, y, r, w) { c.save(); c.lineWidth = w; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); c.restore(); }
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}

/** URL de datos (PNG) del emblema del operador en el color pedido. */
export function emblemURL(opId, color = '#ffffff', size = 96) {
  const key = `${opId}|${color}|${size}`;
  let url = cache.get(key);
  if (url) return url;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  c.scale(size / 100, size / 100);
  c.fillStyle = color; c.strokeStyle = color;
  const g = GLYPHS[opId];
  if (g) g(c);
  else { c.font = 'bold 60px sans-serif'; c.textAlign = 'center'; c.fillText('?', 50, 72); }
  url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
