// generate-pwa-icons.mjs — emits the PWA icon set (public/icons/*.png) plus the
// SVG brand mark (public/icon.svg) with ZERO dependencies.
//
// The PNG encoder is hand-rolled over node:zlib (deflate) — no sharp/pngjs
// needed — and the artwork is drawn procedurally: the ModuBiz mark is the navy
// brand square (#0F1729, the --primary token) with a white "M", matching the
// sidebar logo. This keeps the icon set reproducible and reviewable.
//
//   Usage:  node scripts/generate-pwa-icons.mjs
//   Output: apps/web/public/icons/{icon-192,icon-512,icon-maskable-512,
//           apple-touch-icon}.png  +  apps/web/public/icon.svg
//
// The generated files are committed — the script exists so the artwork can be
// regenerated after a brand tweak.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');

// ─── Palette (design tokens) ────────────────────────────────────────────────
const NAVY = [15, 23, 41]; // hsl(222 47% 11%) — --primary
const WHITE = [248, 250, 252]; // hsl(210 40% 98%) — --primary-foreground

// ─── Minimal PNG encoder (RGBA, 8-bit, no deps) ─────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ─── Geometry helpers ────────────────────────────────────────────────────────
/** Squared distance from (px,py) to the segment (x1,y1)-(x2,y2), in pixels. */
function segDist2(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  const ox = px - cx;
  const oy = py - cy;
  return ox * ox + oy * oy;
}

/** Signed distance to a rounded rect centered at (cx,cy) with half extents. */
function roundRectDist(px, py, cx, cy, hw, hh, radius) {
  const qx = Math.abs(px - cx) - (hw - radius);
  const qy = Math.abs(py - cy) - (hh - radius);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * The "M" skeleton in normalized coordinates: two vertical legs + two diagonals
 * meeting at the bottom centre (the classic M), centered on (0.5, 0.5).
 * Bounding box: x ∈ [0.3, 0.7], y ∈ [0.26, 0.74] — comfortably inside the
 * maskable safe zone (central circle of radius 0.4), so the SAME mark is used
 * for 'any' and 'maskable' icons; only the background treatment differs.
 */
function mSegments() {
  return [
    [0.3, 0.26, 0.3, 0.74],
    [0.7, 0.26, 0.7, 0.74],
    [0.3, 0.26, 0.5, 0.74],
    [0.7, 0.26, 0.5, 0.74],
  ];
}

/**
 * Rasterize one icon.
 * @param {number} size  Square size in px.
 * @param {object} opts  { maskable } — maskable = full-bleed navy (no rounded
 *                       corners, no transparent padding); otherwise the mark
 *                       sits on a rounded navy square with transparent corners.
 * @returns {Buffer} RGBA pixel buffer.
 */
function rasterize(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const halfR = size * 0.1; // stroke half-width, normalized 0.1
  const cornerR = size * 0.22;
  const half = size / 2;
  const pad = maskable ? 0 : size * 0.02; // a hair of transparent padding

  // 3×3 supersampling per pixel for smooth edges.
  const samples = [
    [1 / 6, 1 / 6],
    [1 / 2, 1 / 6],
    [5 / 6, 1 / 6],
    [1 / 6, 1 / 2],
    [1 / 2, 1 / 2],
    [5 / 6, 1 / 2],
    [1 / 6, 5 / 6],
    [1 / 2, 5 / 6],
    [5 / 6, 5 / 6],
  ];
  const segs = mSegments();

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let white = 0;
      let inside = 0;
      for (const [sx, sy] of samples) {
        const px = x + sx;
        const py = y + sy;
        if (maskable) {
          inside += 1;
        } else {
          const d = roundRectDist(px, py, half, half, half - pad, half - pad, cornerR);
          if (d > 0) continue;
          inside += 1;
        }
        let minD2 = Infinity;
        for (const [x1, y1, x2, y2] of segs) {
          minD2 = Math.min(minD2, segDist2(px, py, x1 * size, y1 * size, x2 * size, y2 * size));
        }
        if (Math.sqrt(minD2) <= halfR) white += 1;
      }
      const i = (y * size + x) * 4;
      const coverage = white / samples.length;
      const [r, g, b] = NAVY;
      const [wr, wg, wb] = WHITE;
      rgba[i] = Math.round(r + (wr - r) * coverage);
      rgba[i + 1] = Math.round(g + (wg - g) * coverage);
      rgba[i + 2] = Math.round(b + (wb - b) * coverage);
      rgba[i + 3] = maskable ? 255 : Math.round((inside / samples.length) * 255);
    }
  }
  return rgba;
}

function writePng(name, size, opts) {
  const rgba = rasterize(size, opts);
  writeFileSync(join(OUT_DIR, name), encodePng(size, size, rgba));
  console.log(`  ✓ ${name} (${size}×${size})`);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0F1729"/>
  <path d="M19 47V22l13 18 13-18v25" fill="none" stroke="#F8FAFC" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

mkdirSync(OUT_DIR, { recursive: true });
console.log('Generating PWA icons…');
writePng('icon-192.png', 192, { maskable: false });
writePng('icon-512.png', 512, { maskable: false });
writePng('icon-maskable-512.png', 512, { maskable: true });
writePng('apple-touch-icon.png', 180, { maskable: false });
writeFileSync(join(OUT_DIR, '../icon.svg'), SVG);
console.log('  ✓ icon.svg');
console.log('Done.');
