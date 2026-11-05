// 3D 全息大脑（横向摆放）。程序化生成脑沟脑回，左右半球分色，
// 神经纤维上有信号光点流动；14 个脑区节点随激活值发光；记忆是表面上的小光点，悬停可看内容。

import * as THREE from './vendor/three/three.module.js';
import { EffectComposer } from './vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/addons/postprocessing/OutputPass.js';

// ---------- 噪声（Perlin improved noise） ----------
const P = new Uint8Array(512);
(() => {
  const p = [...Array(256).keys()];
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);
function grad(h, x, y, z) {
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
function noise(x, y, z) {
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
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 坐标约定（模型空间）：x = 前后（前额在 +x），y = 左右（两个半球），z = 背侧（朝向镜头）
const L = 1.85; // 半长

// 把单位球面上的一点变形成半球表面上的一点。返回位置、法线和“脑回度”（1=脑回顶，0=脑沟底）
function deform(vx, vy, vz, side) {
  const se = (a, e) => Math.sign(a) * Math.abs(a) ** e;
  const cy = side * 0.56;
  // 超椭球：比普通椭球更“方圆”，两头不尖
  let x = se(vx, 0.72) * L;
  let y = se(vy, 0.8) * 0.8;
  let z = se(vz, 0.85) * 1.0;
  // 俯视轮廓像个蛋：后部（顶枕叶）最宽，额叶收窄
  const taper = 1 - 0.3 * Math.max(0, vx + 0.15) ** 2 - 0.22 * Math.max(0, -vx - 0.35) ** 2;
  y *= taper;
  z *= 0.86 * (1 - 0.12 * Math.max(0, vx) ** 3);
  // 腹侧压平，颞叶向外鼓
  if (z < 0) z *= 0.62 + 0.18 * smooth(-0.2, 0.6, -vx);
  const temporal = Math.exp(-(((vx - 0.05) / 0.45) ** 2)) * smooth(0, -0.6, vz) * Math.max(0, vy * side);
  y += side * temporal * 0.16;
  y += cy;
  // 内侧面压平（两半球之间的纵裂）
  if (y * side < 0.025) y = side * (0.025 + (y * side - 0.025) * 0.06);
  const n = new THREE.Vector3(x / (L * L), (y - cy) / 0.64, z / 0.8).normalize();
  // 脑回：扭曲噪声的零值线就是脑沟
  const s = 4.6;
  const wx = x * 1.4, wy = y * 1.4, wz = z * 1.4;
  const nx = x * s + 0.9 * noise(wx + 3.1, wy, wz), ny = y * s + 0.9 * noise(wx, wy + 7.7, wz), nz = z * s + 0.9 * noise(wx, wy, wz + 1.9);
  const n1 = noise(nx + 11.3, ny, nz) + 0.35 * noise(nx * 2.3, ny * 2.3 + 5.1, nz * 2.3);
  const g = smooth(0.0, 0.16, Math.abs(n1));
  const medial = smooth(0.05, 0.2, y * side);
  const d = (g - 1) * 0.06 * medial;
  return { p: new THREE.Vector3(x + n.x * d, y + n.y * d, z + n.z * d), n, fold: g * medial + (1 - medial) * 0.5, medial };
}

function randDir(rnd) {
  const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  return [r * Math.cos(a), r * Math.sin(a), u];
}

/** 生成粒子大脑：表面粒子（脑沟更亮，勾出脑回纹理）+ 稀疏的内部粒子 + 小脑 */
function buildParticles(rnd) {
  const pos = [], col = [], seed = [], size = [];
  const surf = [];
  const C = {
    L: [new THREE.Color(0x7a5cff), new THREE.Color(0xb9a6ff)], // 左半球：紫
    R: [new THREE.Color(0xff9a3c), new THREE.Color(0xffd9a0)], // 右半球：琥珀
    groove: new THREE.Color(0x9fe8ff),
  };
  const push = (p, c, s) => {
    pos.push(p.x, p.y, p.z);
    col.push(c.r, c.g, c.b);
    seed.push(rnd());
    size.push(s);
  };
  for (const side of [-1, 1]) {
    const pal = side < 0 ? C.L : C.R;
    for (let i = 0; i < 70000; i++) {
      const [vx, vy, vz] = randDir(rnd);
      const d = deform(vx, vy, vz, side);
      if (d.medial < 0.3 && rnd() < 0.85) continue; // 内侧面稀一点
      if (d.fold < 0.35) {
        // 脑沟：冷白色细线
        push(d.p, C.groove.clone().lerp(pal[1], 0.35), 1.0 + rnd() * 0.5);
      } else if (rnd() < 0.55) {
        // 脑回：半球主色，越靠近回顶越亮
        const c = pal[0].clone().lerp(pal[1], (d.fold - 0.35) * 0.6 * rnd()).multiplyScalar(0.62);
        push(d.p, c, 0.8 + rnd() * 0.7);
      }
      if (i % 40 === 0 && Math.abs(d.p.y) > 0.12) surf.push({ v: d.p, n: d.n });
    }
    // 内部稀疏粒子，增加体积感
    for (let i = 0; i < 5000; i++) {
      const [vx, vy, vz] = randDir(rnd);
      const d = deform(vx, vy, vz, side);
      const k = 0.15 + 0.8 * Math.cbrt(rnd());
      const cyv = new THREE.Vector3(0, side * 0.56, 0);
      push(d.p.clone().sub(cyv).multiplyScalar(k).add(cyv), pal[0].clone().multiplyScalar(0.55), 0.8);
    }
  }
  // 小脑：横向条纹
  for (let i = 0; i < 16000; i++) {
    const [vx, vy, vz] = randDir(rnd);
    const stripes = Math.abs(Math.sin(vx * 26 + noise(vx * 3, vy * 3, vz * 3) * 2.5));
    const g = smooth(0.05, 0.5, stripes);
    const r = 1 + (g - 1) * 0.06;
    const p = new THREE.Vector3(-1.55 + vx * 0.42 * r, vy * 0.95 * r, -0.5 + vz * 0.36 * r);
    if (g < 0.3) push(p, C.groove, 1.0);
    else if (rnd() < 0.5) push(p, new THREE.Color(0x8a78e0), 0.9);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  return { geo, surf };
}

const pointVert = /* glsl */ `
  attribute vec3 color;
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uActivity;
  uniform float uPixelRatio;
  uniform float uWave;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    // 轻微呼吸
    p *= 1.0 + 0.006 * sin(uTime * 1.2);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 40.0);
    // 思考波：沿前后轴扫过的一道亮带
    float wave = exp(-pow((position.x - uWave) / 0.18, 2.0)) * (0.4 + uActivity);
    vColor = color * (0.75 + 0.5 * wave) + vec3(0.25, 0.5, 0.6) * wave;
    vAlpha = (0.4 + 0.35 * tw) * (0.8 + 0.4 * uActivity);
    gl_PointSize = aSize * uPixelRatio * (1.0 + wave * 0.8) * (14.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const pointFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * a, a * vAlpha);
  }
`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 脑区在模型空间的大致位置（只用一侧半球 +y 显示，左右对称的取 +y）
const REGION_POS = {
  prefrontal: [1.35, 0.5, 0.42],
  motor: [0.25, 0.55, 0.88],
  acc: [0.7, 0.14, 0.42],
  dmn: [-0.55, 0.16, 0.72],
  sensory: [-1.35, 0.55, 0.35],
  insula: [0.3, 0.98, 0.05],
  temporal: [0.15, 1.05, -0.3],
  amygdala: [0.55, 0.42, -0.42],
  hippocampus: [-0.1, 0.45, -0.38],
  basal: [0.3, 0.32, 0.02],
  thalamus: [-0.05, 0.12, -0.08],
  hypothalamus: [0.35, 0.1, -0.5],
  brainstem: [-0.7, 0.05, -0.72],
  cerebellum: [-1.55, 0.4, -0.55],
};

// 一条消息从进来到回应的主路（设计文档 §4.1）
const CHAT_PATH = ['sensory', 'thalamus', 'amygdala', 'hippocampus', 'prefrontal', 'motor'];

export function createBrain(canvas, { onHover } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const camHome = new THREE.Vector3(1.3, 1.3, 9.0);
  const lookAt = new THREE.Vector3(-0.35, 0, 0);
  camera.position.copy(camHome);
  camera.lookAt(lookAt);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.75, 0.5, 0.22);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const tex = glowTexture();

  // ---------- 底座：两端的全息环 + 贯穿的光束（横向） ----------
  const holo = new THREE.Group();
  scene.add(holo);
  const ringMat = (op) => new THREE.LineBasicMaterial({ color: 0x4fd6ff, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
  function ringLoop(r, x, op, seg = 160, dash = false) {
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      if (dash && i % 6 > 3) continue;
      const a = (i / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(x, Math.cos(a) * r, Math.sin(a) * r));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return dash ? new THREE.LineSegments(g, ringMat(op)) : new THREE.Line(g, ringMat(op));
  }
  for (const x of [-2.75, 2.75]) {
    holo.add(ringLoop(0.45, x, 0.9));
    holo.add(ringLoop(0.9, x, 0.5));
    holo.add(ringLoop(1.4, x, 0.35, 160, true));
    holo.add(ringLoop(1.9, x, 0.25));
    holo.add(ringLoop(2.35, x, 0.14, 200, true));
    // 刻度点
    const tick = [];
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      tick.push(x, Math.cos(a) * 2.1, Math.sin(a) * 2.1);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tick, 3));
    holo.add(new THREE.Points(tg, new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.035, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })));
  }
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){ float core = pow(1.0 - abs(vUv.y - 0.5) * 2.0, 6.0);
        float pulse = 0.75 + 0.25 * sin(vUv.x * 40.0 - uTime * 4.0);
        gl_FragColor = vec4(vec3(0.45, 0.9, 1.0) * core * pulse, core); }`,
  });
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(5.9, 0.16), beamMat);
  holo.add(beam);
  const beam2 = beam.clone();
  beam2.rotation.x = Math.PI / 2;
  holo.add(beam2);

  // 背景星点
  {
    const pts = [];
    for (let i = 0; i < 700; i++) pts.push((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 12, -4 - Math.random() * 10);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x6fa8ff, size: 0.03, transparent: true, opacity: 0.45, depthWrite: false })));
  }

  // ---------- 大脑（粒子） ----------
  const brain = new THREE.Group();
  scene.add(brain);
  const rand = (() => {
    let s = 42;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const built = buildParticles(rand);
  const surf = built.surf;
  const pointMat = new THREE.ShaderMaterial({
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.3 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uWave: { value: -3 },
    },
  });
  brain.add(new THREE.Points(built.geo, pointMat));

  // ---------- 神经纤维 ----------
  const fibers = [];
  const fiberGroup = new THREE.Group();
  brain.add(fiberGroup);
  const fiberMat = new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false });
  const fiberMat2 = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false });
  function addFiber(a, b, lift, mat) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.multiplyScalar(lift);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const pts = curve.getPoints(40);
    fiberGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    fibers.push(curve);
  }
  // 跨半球的长纤维（胼胝体）
  for (let i = 0; i < 45; i++) {
    const a = surf[Math.floor(rand() * surf.length)].v;
    const cand = surf.filter((s) => Math.sign(s.v.y) !== Math.sign(a.y) && Math.abs(s.v.x - a.x) < 0.7);
    if (!cand.length) continue;
    const b = cand[Math.floor(rand() * cand.length)].v;
    addFiber(a.clone(), b.clone(), 0.25, fiberMat);
  }
  // 表面的短连接网
  for (let i = 0; i < 260; i++) {
    const s = surf[Math.floor(rand() * surf.length)];
    let best = null;
    for (let k = 0; k < 30; k++) {
      const t = surf[Math.floor(rand() * surf.length)];
      const d = t.v.distanceTo(s.v);
      if (d > 0.25 && d < 0.75 && Math.sign(t.v.y) === Math.sign(s.v.y)) {
        best = t;
        break;
      }
    }
    if (!best) continue;
    const a = s.v.clone().addScaledVector(s.n, 0.03);
    const b = best.v.clone().addScaledVector(best.n, 0.03);
    addFiber(a, b, 1.08, s.v.y > 0 ? fiberMat2 : fiberMat);
  }

  // ---------- 信号光点 ----------
  const MAXP = 420;
  const pPos = new Float32Array(MAXP * 3);
  const pCol = new Float32Array(MAXP * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.075, map: tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const particles = new THREE.Points(pGeo, pMat);
  brain.add(particles);
  const live = []; // {curve, t, speed, color}
  const palette = [new THREE.Color(0x7fe3ff), new THREE.Color(0xffd27a), new THREE.Color(0xc6a8ff), new THREE.Color(0xffffff)];
  function spawn(curve, color, speed = 0.25 + Math.random() * 0.35) {
    if (live.length >= MAXP) live.shift();
    live.push({ curve, t: 0, speed, color: color || palette[Math.floor(Math.random() * palette.length)] });
  }

  // ---------- 脑区节点 ----------
  const regionNodes = {};
  const nodeGroup = new THREE.Group();
  brain.add(nodeGroup);
  for (const [id, p] of Object.entries(REGION_POS)) {
    const mat = new THREE.SpriteMaterial({ map: tex, color: 0x7fe3ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.position.set(...p);
    sp.scale.setScalar(0.22);
    nodeGroup.add(sp);
    regionNodes[id] = { sprite: sp, act: 0.2, target: 0.2 };
  }
  const regionCurve = (a, b) => {
    const pa = regionNodes[a].sprite.position, pb = regionNodes[b].sprite.position;
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    mid.z += 0.35;
    return new THREE.QuadraticBezierCurve3(pa.clone(), mid, pb.clone());
  };

  // ---------- 记忆光点 ----------
  const memGroup = new THREE.Group();
  brain.add(memGroup);
  let memNodes = []; // {pos, item}
  const MEM_ANCHOR = { semantic: 'temporal', episodic: 'hippocampus', diary: 'dmn', self: 'prefrontal' };
  const MEM_COLOR = { semantic: 0xffd27a, episodic: 0x7fe3ff, diary: 0xff9fc0, self: 0xc6a8ff };
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967295;
  }
  function setMemories(items) {
    memGroup.clear();
    memNodes = [];
    const byKind = {};
    for (const it of items) (byKind[it.kind] ||= []).push(it);
    for (const [kind, list] of Object.entries(byKind)) {
      const anchor = new THREE.Vector3(...REGION_POS[MEM_ANCHOR[kind]]);
      // 离锚点最近的一批表面点，左右半球都用
      const mirror = anchor.clone().setY(-anchor.y);
      const near = surf
        .map((s) => ({ s, d: Math.min(s.v.distanceTo(anchor), s.v.distanceTo(mirror)) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, Math.max(60, list.length * 3));
      const pos = [];
      list.forEach((it) => {
        const s = near[Math.floor(hashStr(it.id + kind) * near.length)].s;
        const p = s.v.clone().addScaledVector(s.n, 0.05);
        pos.push(p.x, p.y, p.z);
        memNodes.push({ pos: p, item: it });
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      memGroup.add(new THREE.Points(g, new THREE.PointsMaterial({ color: MEM_COLOR[kind], size: 0.09, map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    }
  }

  // ---------- 交互 ----------
  let spin = true;
  let flowing = true;
  let dragging = false;
  let last = null;
  let rotX = -0.12; // 绕长轴（x）
  let rotY = 0.0;
  let userRotX = 0, userRotY = 0;
  let distance = camHome.length();
  const mouse = { x: -1, y: -1, inside: false };

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    last = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.inside = true;
    if (!dragging) return;
    userRotX += (e.clientY - last[1]) * 0.006;
    userRotY += (e.clientX - last[0]) * 0.006;
    last = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerleave', () => {
    mouse.inside = false;
    onHover?.(null);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      distance = Math.min(16, Math.max(5, distance * (1 + Math.sign(e.deltaY) * 0.08)));
    },
    { passive: false },
  );

  // ---------- 尺寸 ----------
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // 窄屏时拉远一点，保证整个横向大脑在画面内
    camera.fov = w / h < 1.1 ? 46 : w / h < 1.4 ? 38 : 32;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);

  // ---------- 循环 ----------
  const clock = new THREE.Clock();
  let running = true;
  let activity = 0.3;
  let spawnAcc = 0;
  const proj = new THREE.Vector3();
  const labels = [];

  function project(v) {
    proj.copy(v).applyMatrix4(brain.matrixWorld).project(camera);
    return { x: (proj.x * 0.5 + 0.5) * canvas.clientWidth, y: (-proj.y * 0.5 + 0.5) * canvas.clientHeight, z: proj.z };
  }

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    if (spin) {
      rotX = -0.1 + Math.sin(t * 0.16) * 0.3;
      rotY = Math.sin(t * 0.11) * 0.1;
    }
    brain.rotation.set(rotX + userRotX, rotY + userRotY, 0);
    holo.rotation.x = t * 0.15;
    camera.position.copy(camHome).setLength(distance);
    camera.lookAt(lookAt);

    pointMat.uniforms.uTime.value = t;
    pointMat.uniforms.uActivity.value += (activity - pointMat.uniforms.uActivity.value) * 0.05;
    // 思考波每隔几秒从后往前扫一次，越活跃越快
    pointMat.uniforms.uWave.value = -2.4 + ((t * (0.35 + activity * 0.6)) % 1) * 5.2;
    beamMat.uniforms.uTime.value = t;

    // 节点
    for (const n of Object.values(regionNodes)) {
      n.act += (n.target - n.act) * Math.min(1, dt * 3);
      const pulse = 1 + Math.sin(t * 3 + n.sprite.position.x * 5) * 0.08;
      n.sprite.scale.setScalar((0.08 + n.act * 0.22) * pulse);
      n.sprite.material.opacity = 0.25 + n.act * 0.6;
    }

    // 信号
    if (flowing) {
      spawnAcc += dt * (4 + activity * 26);
      while (spawnAcc > 1) {
        spawnAcc -= 1;
        spawn(fibers[Math.floor(Math.random() * fibers.length)]);
      }
    }
    let k = 0;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      if (flowing) p.t += dt * p.speed;
      if (p.t >= 1) {
        live.splice(i, 1);
        continue;
      }
      const v = p.curve.getPoint(p.t);
      pPos[k * 3] = v.x; pPos[k * 3 + 1] = v.y; pPos[k * 3 + 2] = v.z;
      const fadeIn = Math.min(1, p.t * 6, (1 - p.t) * 6);
      pCol[k * 3] = p.color.r * fadeIn; pCol[k * 3 + 1] = p.color.g * fadeIn; pCol[k * 3 + 2] = p.color.b * fadeIn;
      k++;
    }
    pGeo.setDrawRange(0, k);
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;

    brain.updateMatrixWorld();
    // 悬停检测（屏幕空间）
    if (mouse.inside && !dragging) {
      let best = null, bd = 14;
      for (const [id, n] of Object.entries(regionNodes)) {
        const s = project(n.sprite.position);
        const d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
        if (d < bd) { bd = d; best = { type: 'region', id, x: s.x, y: s.y }; }
      }
      for (const m of memNodes) {
        const s = project(m.pos);
        const d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
        if (d < bd * 0.8) { bd = d; best = { type: 'memory', item: m.item, x: s.x, y: s.y }; }
      }
      onHover?.(best);
    }
    // 标注
    if (labels.length) {
      for (const lb of labels) {
        const s = project(regionNodes[lb.id].sprite.position);
        lb.el.style.transform = `translate(${s.x + 10}px, ${s.y - 8}px)`;
      }
    }

    composer.render();
  }
  resize();
  frame();

  return {
    setActivity(regions) {
      let sum = 0;
      for (const [id, v] of Object.entries(regions || {})) {
        if (regionNodes[id]) regionNodes[id].target = v;
        sum += v;
      }
      activity = Math.min(1, sum / 7);
    },
    setMemories,
    /** 一条消息走主路：感觉皮层 → 丘脑 → 杏仁核 → 海马体 → 前额叶 → 语言区 */
    firePath(path = CHAT_PATH) {
      path.forEach((id, i) => {
        setTimeout(() => {
          if (regionNodes[id]) regionNodes[id].act = 1;
          if (i < path.length - 1) {
            const c = regionCurve(id, path[i + 1]);
            for (let j = 0; j < 6; j++) setTimeout(() => spawn(c, palette[3], 0.9), j * 60);
          }
        }, i * 380);
      });
    },
    setSpin: (v) => (spin = v),
    setFlow: (v) => (flowing = v),
    reset() {
      userRotX = userRotY = 0;
      distance = camHome.length();
      spin = true;
    },
    showLabels(container, names) {
      for (const lb of labels) lb.el.remove();
      labels.length = 0;
      if (!names) return;
      for (const [id, name] of Object.entries(names)) {
        const el = document.createElement('div');
        el.className = 'region-label';
        el.textContent = name;
        container.appendChild(el);
        labels.push({ id, el });
      }
    },
    pause() { running = false; },
    resume() {
      if (running) return;
      running = true;
      clock.getDelta();
      frame();
    },
  };
}
