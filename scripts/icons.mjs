// Generates the toolbar icons as real PNGs (no image deps): a rounded dark tile with a
// teal shield and a "pause" bar pair, i.e. guard + stop. Run via `npm run build`.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = px(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Signed-distance helpers in unit space (0..1), supersampled for anti-aliasing.
function inRoundRect(u, v, r) {
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  return dx * dx + dy * dy <= r * r;
}
function inShield(u, v) {
  // Flat top, straight sides, then tapering to a point.
  const top = 0.2, mid = 0.52, bottom = 0.84, half = 0.29;
  if (v < top || v > bottom) return false;
  if (v <= mid) return Math.abs(u - 0.5) <= half;
  const t = (v - mid) / (bottom - mid);
  return Math.abs(u - 0.5) <= half * Math.sqrt(1 - t * t);
}
function inBars(u, v) {
  return v > 0.34 && v < 0.62 && ((u > 0.395 && u < 0.465) || (u > 0.535 && u < 0.605));
}

const BG = [18, 21, 27], TEAL = [79, 209, 165], INK = [12, 14, 18];
mkdirSync('dist/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const S = 4;
  const buf = png(size, (x, y) => {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < S; sy++)
      for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size;
        const v = (y + (sy + 0.5) / S) / size;
        let c = null;
        if (inRoundRect(u, v, 0.22)) c = BG;
        if (c && inShield(u, v)) c = inBars(u, v) ? INK : TEAL;
        if (c) acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2], acc[3] + 255];
      }
    const n = S * S;
    const a = acc[3] / n;
    return a ? [acc[0] / (acc[3] / 255), acc[1] / (acc[3] / 255), acc[2] / (acc[3] / 255), a].map(Math.round) : [0, 0, 0, 0];
  });
  writeFileSync(`dist/icons/icon-${size}.png`, buf);
}
