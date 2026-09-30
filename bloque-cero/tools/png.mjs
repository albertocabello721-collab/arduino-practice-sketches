// Codificador PNG mínimo (RGB) para herramientas de depuración en Node.
import zlib from 'node:zlib';
import fs from 'node:fs';
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePNG(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(path, png);
}

// Decodificador PNG mínimo (8 bits por canal, sin entrelazar; RGB o RGBA, como las capturas de
// Playwright): {w, h, ch, data} con los píxeles seguidos.
export function readPNG(buf) {
  let p = 8, w = 0, h = 0, ch = 4;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ch = d[9] === 6 ? 4 : 3; if (d[8] !== 8 || d[12] !== 0) throw new Error('PNG no admitido'); }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[dst + x - ch] : 0, b = y > 0 ? out[dst - stride + x] : 0, c = x >= ch && y > 0 ? out[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}
/** Luminancia media (0…255) de una captura PNG, o de un recuadro [x0, y0, x1, y1] en fracciones. */
export function meanLuma(buf, box = [0, 0, 1, 1]) {
  const { w, h, ch, data } = readPNG(buf);
  const x0 = Math.floor(box[0] * w), y0 = Math.floor(box[1] * h), x1 = Math.floor(box[2] * w), y1 = Math.floor(box[3] * h);
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * ch; s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; }
  return s / Math.max(1, n);
}
/** Color medio (0…255) de una captura PNG, o de un recuadro [x0, y0, x1, y1] en fracciones: [r, g, b]. */
export function meanRGB(buf, box = [0, 0, 1, 1]) {
  const { w, h, ch, data } = readPNG(buf);
  const x0 = Math.floor(box[0] * w), y0 = Math.floor(box[1] * h), x1 = Math.floor(box[2] * w), y1 = Math.floor(box[3] * h);
  const s = [0, 0, 0];
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * ch; s[0] += data[i]; s[1] += data[i + 1]; s[2] += data[i + 2]; n++; }
  return s.map((v) => v / Math.max(1, n));
}
