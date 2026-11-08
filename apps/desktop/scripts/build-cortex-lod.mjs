// 把完整的皮层数据压成界面用的低模：assets/cortex/{lh,rh}.lod.bin。
// 完整网格每个半球 29 万三角形，只用来挡住背面的话完全用不上这么细；粒子和纤维也按比例抽稀。
//
// 用法：node scripts/build-cortex-lod.mjs <memory-brain>/dsh/dafeiyu-3d-brain/cortex
//
// 输出格式（小端，全部 4 字节对齐）：
//   u32 nv, nt, np, ns
//   遮挡网格：f32 位置 nv*3，f32 法线 nv*3，u32 下标 nt*3
//   粒子：f32 位置 np*3，f32 法线 np*3
//   纤维（线段对）：f32 位置 ns*3，f32 aAlong ns，f32 aSeed ns
// 坐标已是模型坐标：x 向前，y 指向左半球，z 向上。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) throw new Error('要传入完整皮层数据的目录');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'cortex');

const CELL = 0.042; // 遮挡网格的格子边长
const POINT_STEP = 6; // 每几个顶点留一个粒子
const STRAND_STEP = 3; // 纤维每几段留一段

const toBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

function readMesh(file) {
  const buffer = toBuffer(fs.readFileSync(file));
  const head = new DataView(buffer);
  const count = head.getUint32(0, true), triangles = head.getUint32(4, true);
  const ras = new Float32Array(buffer, 8, count * 3);
  const index = new Uint32Array(buffer, 8 + count * 12, triangles * 3);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = ras[i * 3 + 1];
    pos[i * 3 + 1] = -ras[i * 3];
    pos[i * 3 + 2] = ras[i * 3 + 2];
  }
  const nor = new Float32Array(count * 3);
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i] * 3, index[i + 1] * 3, index[i + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { nor[k] += nx; nor[k + 1] += ny; nor[k + 2] += nz; }
  }
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
    nor[i * 3] /= l; nor[i * 3 + 1] /= l; nor[i * 3 + 2] /= l;
  }
  return { pos, nor, index, count };
}

/** 顶点聚类：落在同一格子里的顶点合成一个，退化和重复的三角形丢掉 */
function cluster({ pos, nor, index, count }) {
  const cells = new Map();
  const remap = new Uint32Array(count);
  const sums = [];
  for (let i = 0; i < count; i++) {
    const key = `${Math.floor(pos[i * 3] / CELL)},${Math.floor(pos[i * 3 + 1] / CELL)},${Math.floor(pos[i * 3 + 2] / CELL)}`;
    let id = cells.get(key);
    if (id === undefined) {
      id = sums.length;
      cells.set(key, id);
      sums.push([0, 0, 0, 0, 0, 0, 0]);
    }
    remap[i] = id;
    const s = sums[id];
    for (let k = 0; k < 3; k++) { s[k] += pos[i * 3 + k]; s[k + 3] += nor[i * 3 + k]; }
    s[6]++;
  }
  const P = new Float32Array(sums.length * 3), N = new Float32Array(sums.length * 3);
  sums.forEach((s, i) => {
    const l = Math.hypot(s[3], s[4], s[5]) || 1;
    for (let k = 0; k < 3; k++) { P[i * 3 + k] = s[k] / s[6]; N[i * 3 + k] = s[k + 3] / l; }
  });
  const seen = new Set();
  const tris = [];
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [remap[index[i]], remap[index[i + 1]], remap[index[i + 2]]];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    tris.push(a, b, c);
  }
  return { P, N, I: Uint32Array.from(tris) };
}

function points({ pos, nor, count }) {
  const n = Math.floor(count / POINT_STEP);
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = i * POINT_STEP * 3;
    for (let k = 0; k < 3; k++) { P[i * 3 + k] = pos[j + k] + nor[j + k] * 0.008; N[i * 3 + k] = nor[j + k]; }
  }
  return { P, N };
}

function strands(file) {
  const buffer = toBuffer(fs.readFileSync(file));
  const count = new DataView(buffer).getUint32(0, true);
  const ras = new Float32Array(buffer, 4, count * 3);
  const along = new Float32Array(buffer, 4 + count * 12, count);
  const seed = new Float32Array(buffer, 4 + count * 16, count);
  const vertex = (i) => ({ p: [ras[i * 3 + 1], -ras[i * 3], ras[i * 3 + 2]], a: along[i], s: seed[i] });
  const lines = [];
  let cur = null;
  for (let i = 0; i < count; i += 2) {
    const a = vertex(i), b = vertex(i + 1);
    const last = cur && cur[cur.length - 1];
    const joined = last && last.s === a.s && Math.hypot(last.p[0] - a.p[0], last.p[1] - a.p[1], last.p[2] - a.p[2]) < 1e-4;
    if (!joined) { cur = [a]; lines.push(cur); }
    cur.push(b);
  }
  const P = [], A = [], S = [];
  for (const line of lines) {
    const kept = line.filter((_, i) => i % STRAND_STEP === 0);
    if (kept[kept.length - 1] !== line[line.length - 1]) kept.push(line[line.length - 1]);
    for (let i = 0; i < kept.length - 1; i++) {
      for (const v of [kept[i], kept[i + 1]]) { P.push(...v.p); A.push(v.a); S.push(v.s); }
    }
  }
  return { P: Float32Array.from(P), A: Float32Array.from(A), S: Float32Array.from(S), lines: lines.length };
}

const meta = { source: 'Derived from the cortical surface and strands described in LICENSE-ATTRIBUTION.md', lod: {} };
for (const side of ['lh', 'rh']) {
  const mesh = readMesh(path.join(src, `${side}.bin`));
  const occ = cluster(mesh);
  const pts = points(mesh);
  const fib = strands(path.join(src, `${side}.hologram.bin`));
  const header = Uint32Array.of(occ.P.length / 3, occ.I.length / 3, pts.P.length / 3, fib.A.length);
  const parts = [header, occ.P, occ.N, occ.I, pts.P, pts.N, fib.P, fib.A, fib.S];
  fs.writeFileSync(path.join(out, `${side}.lod.bin`), Buffer.concat(parts.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))));
  meta.lod[side] = { vertices: header[0], triangles: header[1], points: header[2], strandVertices: header[3], strands: fib.lines };
  console.log(side, meta.lod[side]);
}
fs.writeFileSync(path.join(out, 'metadata.json'), JSON.stringify(meta, null, 2) + '\n');
