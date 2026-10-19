'use strict';

// 纯 Node 生成插件图标（无第三方依赖）：蓝色圆角底 + 白色图片图形。
// 用法：node make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- PNG 编码 ----------
function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 图形绘制 ----------
const lerp = (a, b, t) => a + (b - a) * t;

function insideRoundedRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  if (dx <= 0 && dy <= 0) return true;
  if (dx > 0 && dy > 0) return dx * dx + dy * dy <= r * r;
  if (dx > 0) return dx <= r;
  return dy <= r;
}

function insideCircle(px, py, cx, cy, r) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function sample(fx, fy) {
  if (!insideRoundedRect(fx, fy, 0.5, 0.5, 0.5, 0.5, 0.22)) {
    return [0, 0, 0, 0];
  }
  const t = (fx + fy) / 2;
  let r = lerp(91, 47, t);
  let g = lerp(140, 107, t);
  const b = 255;

  // 白色图片框
  const inFrame = insideRoundedRect(fx, fy, 0.5, 0.5, 0.32, 0.26, 0.08) &&
    !insideRoundedRect(fx, fy, 0.5, 0.5, 0.275, 0.215, 0.05);
  // 太阳
  const inSun = insideCircle(fx, fy, 0.37, 0.37, 0.05);
  // 山峰
  const inMtn = insideTriangle(fx, fy, 0.30, 0.66, 0.50, 0.50, 0.70, 0.66);

  if (inFrame || inSun || inMtn) {
    r = 255;
    g = 255;
  }
  return [Math.round(r), Math.round(g), Math.round(b), 255];
}

function renderIcon(size) {
  const SS = 4;
  const W = size * SS;
  const rgba = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x * SS + sx + 0.5) / W;
          const fy = (y * SS + sy + 0.5) / W;
          const c = sample(fx, fy);
          r += c[0];
          g += c[1];
          b += c[2];
          a += c[3];
        }
      }
      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(r / n);
      rgba[idx + 1] = Math.round(g / n);
      rgba[idx + 2] = Math.round(b / n);
      rgba[idx + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  console.log('已生成', file);
}
