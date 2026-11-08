// 小脑和脑干的形状：真实皮层数据里没有这两块，由这里程序生成。纯数学，不依赖 three.js。
// 坐标约定（模型空间）：x = 前后（额极在 +x），y = 左右，z = 背侧（朝上）。

// ---------- 噪声（Perlin improved noise） ----------
const P = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);
function grad(h, x, y, z) {
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
export function noise(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(P[AA] & 15, x, y, z), grad(P[BA] & 15, x - 1, y, z), u), lerp(grad(P[AB] & 15, x, y - 1, z), grad(P[BB] & 15, x - 1, y - 1, z), u), v),
    lerp(lerp(grad(P[AA + 1] & 15, x, y, z - 1), grad(P[BA + 1] & 15, x - 1, y, z - 1), u), lerp(grad(P[AB + 1] & 15, x, y - 1, z - 1), grad(P[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
    w,
  );
}
export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- 二十面体细分球（带索引、顶点共享） ----------
const T = (1 + Math.sqrt(5)) / 2;
const ICO_V = [[-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0], [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T], [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1]];
const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

/** 顶点数 10f²+2，三角形数 20f²。顺序完全确定，烘焙数据靠这个顺序对应回顶点。 */
export function icosphere(f) {
  const V = 10 * f * f + 2;
  const dirs = new Float32Array(V * 3);
  const index = new Uint32Array(20 * f * f * 3);
  let nv = 0;
  const add = (x, y, z) => {
    const l = Math.hypot(x, y, z);
    dirs[nv * 3] = x / l; dirs[nv * 3 + 1] = y / l; dirs[nv * 3 + 2] = z / l;
    return nv++;
  };
  for (const v of ICO_V) add(v[0], v[1], v[2]);
  const edges = new Map();
  const edge = (u, v, k) => {
    const a = Math.min(u, v), b = Math.max(u, v);
    const key = a * 12 + b;
    let list = edges.get(key);
    if (!list) {
      list = [];
      const pa = ICO_V[a], pb = ICO_V[b];
      for (let i = 1; i < f; i++) {
        const t = i / f;
        list.push(add(lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t), lerp(pa[2], pb[2], t)));
      }
      edges.set(key, list);
    }
    return u < v ? list[k - 1] : list[f - k - 1];
  };
  let ni = 0;
  for (const [a, b, c] of ICO_F) {
    const pa = ICO_V[a], pb = ICO_V[b], pc = ICO_V[c];
    const grid = new Map();
    const idx = (i, j) => {
      if (i === 0 && j === 0) return a;
      if (i === f && j === 0) return b;
      if (i === 0 && j === f) return c;
      if (j === 0) return edge(a, b, i);
      if (i === 0) return edge(a, c, j);
      if (i + j === f) return edge(b, c, j);
      const key = i * (f + 1) + j;
      let id = grid.get(key);
      if (id === undefined) {
        const wa = (f - i - j) / f, wb = i / f, wc = j / f;
        id = add(pa[0] * wa + pb[0] * wb + pc[0] * wc, pa[1] * wa + pb[1] * wb + pc[1] * wc, pa[2] * wa + pb[2] * wb + pc[2] * wc);
        grid.set(key, id);
      }
      return id;
    };
    for (let j = 0; j < f; j++) {
      for (let i = 0; i < f - j; i++) {
        index[ni++] = idx(i, j); index[ni++] = idx(i + 1, j); index[ni++] = idx(i, j + 1);
        if (i + j < f - 1) {
          index[ni++] = idx(i + 1, j); index[ni++] = idx(i + 1, j + 1); index[ni++] = idx(i, j + 1);
        }
      }
    }
  }
  return { dirs, index, count: V };
}

// ---------- 小脑和脑干（运行时直接算，数据量小） ----------
export function buildCerebellum(f = 90) {
  const { dirs, index, count } = icosphere(f);
  const position = new Float32Array(count * 3);
  const fold = new Float32Array(count);
  const [cx, cz] = [-1.02, -0.92];
  for (let i = 0; i < count; i++) {
    const sx = dirs[i * 3], sy = dirs[i * 3 + 1], sz = dirs[i * 3 + 2];
    // 小叶是一层层横向的褶皱，侧面看是略带弧度的平行线；每隔几层有一道更深的裂
    const w = noise(sx * 2.2 + 4, sy * 2.2, sz * 2.2) * 0.1;
    const phase = Math.asin(Math.min(1, Math.max(-1, sz * 0.86 + sx * 0.32 + 0.14 * sy * sy))) + w;
    const ridge = Math.abs(Math.sin(phase * 17));
    const major = Math.abs(Math.sin(phase * 17 / 5));
    const groove = 1 - smoothstep(0.02, 0.5, ridge);
    const deep = 1 - smoothstep(0.0, 0.16, major);
    const depth = (groove * 0.038 + deep * 0.05) * smoothstep(0.0, 0.25, 1 - Math.abs(sy));
    fold[i] = Math.min(1, groove * 0.75 + deep);
    const vermis = 1 - 0.14 * Math.exp(-((sy / 0.14) ** 2));
    const k = 1 - depth;
    position[i * 3] = cx + sx * 0.62 * k;
    position[i * 3 + 1] = sy * 0.86 * k;
    position[i * 3 + 2] = cz + sz * 0.38 * k * vermis;
  }
  return { position, fold, index };
}

export function buildBrainstem(rings = 150, around = 72) {
  // 中脑 → 脑桥 → 延髓，沿侧视平面里的一条曲线放样
  const path = [[0.1, -0.3], [-0.02, -0.75], [-0.18, -1.15], [-0.36, -1.5], [-0.54, -1.85]];
  const at = (t) => {
    const s = Math.min(path.length - 1.0001, t * (path.length - 1));
    const i = Math.floor(s), f = s - i;
    const p0 = path[Math.max(0, i - 1)], p1 = path[i], p2 = path[i + 1], p3 = path[Math.min(path.length - 1, i + 2)];
    const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (3 * b - a - 3 * c + d) * f * f * f);
    return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
  };
  const count = (rings + 1) * around;
  const position = new Float32Array(count * 3);
  const fold = new Float32Array(count);
  const index = new Uint32Array(rings * around * 6);
  let ni = 0;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const [px, pz] = at(t);
    const [qx, qz] = at(Math.min(1, t + 0.01));
    const [ox, oz] = at(Math.max(0, t - 0.01));
    let tx = qx - ox, tz = qz - oz;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const nx = tz, nz = -tx; // 指向腹侧（前方）
    const pons = Math.exp(-(((t - 0.34) / 0.13) ** 2));
    const r = (0.25 - 0.11 * t) * (t > 0.965 ? Math.sqrt(Math.max(0, 1 - ((t - 0.965) / 0.035) ** 2)) : 1);
    for (let i = 0; i < around; i++) {
      const a = (i / around) * Math.PI * 2;
      const cn = Math.cos(a), sn = Math.sin(a);
      const front = Math.max(0, cn);
      const rad = r * (1 + pons * (0.1 + 0.42 * front));
      const v = j * around + i;
      position[v * 3] = px + nx * cn * rad;
      position[v * 3 + 1] = sn * rad * 1.04;
      position[v * 3 + 2] = pz + nz * cn * rad;
      // 脑桥表面的细横纹和前正中沟
      fold[v] = pons * front * 0.3 * (0.5 + 0.5 * Math.sin(t * 150)) + (1 - smoothstep(0.0, 0.12, Math.abs(sn))) * front * 0.5;
      if (j < rings) {
        const b = j * around + ((i + 1) % around), c = v + around, d = b + around;
        index[ni++] = v; index[ni++] = b; index[ni++] = c;
        index[ni++] = b; index[ni++] = d; index[ni++] = c;
      }
    }
  }
  return { position, fold, index };
}
