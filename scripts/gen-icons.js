// gen-icons.js — vygeneruje PWA ikony (PNG) bez externích závislostí.
// Design odpovídá brand-mark v CSS: terracotta čtverec + krémový kruh + hnědý prstenec.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function writePng(file, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  // eslint-disable-next-line no-console
  console.log('vygenerováno', file, png.length, 'B');
}

// ---- kreslení ----
const C = {
  terracotta: [200, 85, 45, 255],      // #c8552d
  terracottaDark: [168, 67, 31, 255],  // #a8431f
  cream: [253, 249, 243, 255],         // #fdf9f3
  brown: [43, 33, 24, 255],            // #2b2118
  transparent: [0, 0, 0, 0],
};

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 512; // scale factor relative to 512 design space
  const rOuter = 90 * s;      // rohy zaoblení
  const circleR = 150 * s;    // poloměr kruhu
  const cx = 256 * s, cy = 252 * s;
  const ringW = 26 * s;

  const inRoundedRect = (x, y) => {
    const margin = 6 * s;
    const x0 = margin, y0 = margin, x1 = size - margin, y1 = size - margin;
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
    const r = rOuter;
    const dx = Math.max(x0 + r - x, x - (x1 - r), 0);
    const dy = Math.max(y0 + r - y, y - (y1 - r), 0);
    return dx * dx + dy * dy <= r * r;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let col = C.transparent;
      if (inRoundedRect(x, y)) {
        // gradient terracotta
        const t = (x + y) / (2 * size);
        col = [
          Math.round(C.terracotta[0] + (255 - C.terracotta[0]) * t * 0.25),
          Math.round(C.terracotta[1] - 20 * t),
          Math.round(C.terracotta[2] - 10 * t),
          255,
        ];
        // kruh (dopadová matrace)
        const d = Math.hypot(x - cx, y - cy);
        if (d <= circleR) {
          if (d > circleR - ringW) col = C.brown; // prstenec
          else col = C.cream;
        }
      }
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = col[3];
    }
  }
  return buf;
}

for (const size of [192, 512]) {
  writePng(path.join(OUT, `icon-${size}.png`), size, size, renderIcon(size));
}
