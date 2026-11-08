// 3D 全息大脑：真实 MRI 皮层网格做遮挡底，上面是沿皮层的粒子云和发光纤维，左半球金黄、右半球蓝色。
// 飞线在脑区和记忆之间穿行，表示她在思考；14 个脑区的激活让附近的纤维变亮；记忆是贴在皮层上的光点。
// 另一个模式「意识海」是记忆的知识图谱，在 ocean.js。两个模式共用一个 WebGL 上下文。
// 皮层网格和纤维数据：Anderson Winkler，CC BY-SA 3.0，见 assets/cortex/LICENSE-ATTRIBUTION.md。
// 纤维、粒子、轮廓光的着色做法改编自 memory-brain 的 dafeiyu-3d-brain（MIT），见 assets/cortex/LICENSE-dafeiyu-3d-brain.txt。

import * as THREE from './vendor/three/three.module.js';
import { EffectComposer } from './vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/addons/postprocessing/OutputPass.js';
import { buildBrainstem, buildCerebellum } from './brain-shape.mjs';
import { createOcean } from './ocean.js';

const GOLD = new THREE.Color('#ffc247');
const BLUE = new THREE.Color('#2f9bff');
const CYAN = new THREE.Color('#00dfff');

/** IPC 传来的是 Uint8Array，可能和底层缓冲不对齐，复制一份才能当 Float32Array 读 */
const toBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/** 读低模数据，格式见 scripts/build-cortex-lod.mjs */
function readLod(u8) {
  const buffer = toBuffer(u8);
  const [nv, nt, np, ns] = new Uint32Array(buffer, 0, 4);
  let at = 16;
  const f32 = (n) => { const a = new Float32Array(buffer, at, n); at += n * 4; return a; };
  const u32 = (n) => { const a = new Uint32Array(buffer, at, n); at += n * 4; return a; };
  return {
    occluder: { position: f32(nv * 3), normal: f32(nv * 3), index: u32(nt * 3) },
    points: { position: f32(np * 3), normal: f32(np * 3) },
    strands: { position: f32(ns * 3), along: f32(ns), seed: f32(ns) },
  };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 每个顶点属于哪个脑区在加载时算好，着色器里只查一次表，不用每帧每顶点循环 14 个脑区
const regionGlsl = (n) => /* glsl */ `
  attribute vec2 aReg;
  uniform float uRegionAct[${n}];
  uniform float uWave;
  float activation() { return clamp(uRegionAct[int(aReg.x + 0.5)], 0.0, 1.0) * aReg.y; }
  float thoughtWave(float x) { float w = (x - uWave) / 0.16; return exp(-w * w); }
`;

function strandShader(n) {
  return {
    vertexShader: /* glsl */ `
      attribute float aAlong;
      attribute float aSeed;
      ${regionGlsl(n)}
      varying float vAlong, vSeed, vBoost;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vAlong = aAlong; vSeed = aSeed;
        float h = activation();
        vBoost = (1.0 + h * h * 1.6 + thoughtWave(position.x) * 1.4) * clamp(1.9 + mv.z * 0.13, 0.35, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uPower;
      uniform vec3 uColor;
      varying float vAlong, vSeed, vBoost;
      void main() {
        float wave = fract(vAlong * 0.65 - uTime * (0.08 + vSeed * 0.045) + vSeed);
        float pulse = pow(max(0.0, 1.0 - abs(wave - 0.5) * 8.0), 6.0);
        float tip = pow(max(0.0, sin(vAlong * 3.14159)), 0.35);
        vec3 color = vSeed > 0.96 ? vec3(0.015, 0.74, 1.3) : uColor;
        float opacity = (0.018 + pulse * 0.19) * (0.35 + tip * 0.65) * uPower * vBoost;
        gl_FragColor = vec4(color * (1.1 + pulse * 1.2), opacity);
      }`,
  };
}

function pointShader(n) {
  return {
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      uniform float uDpr, uPower;
      ${regionGlsl(n)}
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float h = activation();
        gl_PointSize = clamp(aSize * uDpr * 9.0 / max(1.0, -mv.z), 1.0, 24.0);
        vColor = aColor;
        vAlpha = aAlpha * uPower * (1.0 + h * h * 1.1 + thoughtWave(position.x));
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0 || vAlpha < 0.005) discard;
        gl_FragColor = vec4(vColor, exp(-d * d * 6.0) * vAlpha);
      }`,
  };
}

const auraShader = {
  vertexShader: /* glsl */ `
    varying vec3 vN, vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position + normal * 0.012, 1.0);
      vV = -mv.xyz;
      vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    varying vec3 vN, vV;
    void main() {
      float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
      gl_FragColor = vec4(mix(uColor, vec3(0.1, 0.7, 1.0), 0.25) * (0.5 + rim), rim * 0.06);
    }`,
};

// 反面外扩一圈：只有超出正面遮挡的那一圈能看见，就是一条清晰的轮廓线
const outlineShader = {
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * 0.016, 1.0); }',
  fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 0.5); }',
};

const arcShader = {
  vertexShader: /* glsl */ `
    attribute vec3 aColor;
    attribute float aAlong, aPhase, aSpeed;
    varying vec3 vColor;
    varying float vAlong, vPhase, vSpeed;
    void main() {
      vColor = aColor; vAlong = aAlong; vPhase = aPhase; vSpeed = aSpeed;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime, uPower;
    varying vec3 vColor;
    varying float vAlong, vPhase, vSpeed;
    void main() {
      float head = fract(uTime * vSpeed + vPhase) * 1.6 - 0.3;
      float d = head - vAlong;
      float tail = (d >= 0.0 && d < 0.36) ? pow(1.0 - d / 0.36, 2.2) : 0.0;
      gl_FragColor = vec4(vColor * (1.0 + tail * 3.0), min((0.05 + tail * 1.15) * uPower, 1.0));
    }`,
};

/** 舞台背景：泛光的模糊结果 alpha 恒为 1，透明画布会被盖成纯黑，所以渐变直接画在场景里 */
function stageBackground() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 136);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 190);
  grd.addColorStop(0, '#0d2b4c');
  grd.addColorStop(0.5, '#071a30');
  grd.addColorStop(1, '#020810');
  g.fillStyle = grd;
  g.fillRect(-150, -150, 300, 300);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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

// 脑区在模型空间的大致位置（标在左半球 +y 一侧）。坐标按真实皮层的尺寸：前后 ±1.8，左右 ±1.45，上下 ±1.28
const REGION_POS = {
  prefrontal: [1.4, 0.72, 0.55],
  motor: [0.1, 0.95, 1.08],
  acc: [0.75, 0.1, 0.55],
  dmn: [-0.65, 0.1, 0.95],
  sensory: [-1.6, 0.55, 0.05],
  insula: [0.42, 1.22, 0.1],
  temporal: [0.45, 1.32, -0.55],
  amygdala: [0.75, 0.72, -0.62],
  hippocampus: [0.05, 0.72, -0.5],
  basal: [0.4, 0.42, 0.12],
  thalamus: [0.0, 0.15, 0.05],
  hypothalamus: [0.5, 0.1, -0.32],
  brainstem: [-0.3, 0.0, -1.3],
  cerebellum: [-1.05, 0.55, -0.95],
};
const REGION_IDS = Object.keys(REGION_POS);

// 一条消息从进来到回应的主路（设计文档 §4.1）
const CHAT_PATH = ['sensory', 'thalamus', 'amygdala', 'hippocampus', 'prefrontal', 'motor'];

export function createBrain(canvas, cortex, { onHover, onPick } = {}) {
  // 画面都进后期管线，默认帧缓冲的抗锯齿用不上，关掉省一大块显存和填充
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  const QUALITY = [Math.min(window.devicePixelRatio, 1.25), 0.9, 0.7, 0.55];
  let quality = 0;
  renderer.setPixelRatio(QUALITY[0]);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = stageBackground();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const camHome = new THREE.Vector3(0, 0.45, 7.4);
  const lookAt = new THREE.Vector3(-0.2, -0.1, 0);
  camera.position.copy(camHome);
  camera.lookAt(lookAt);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.48, 0.5);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const tex = glowTexture();

  // 背景星点
  {
    const pts = [];
    for (let i = 0; i < 700; i++) pts.push((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 12, -4 - Math.random() * 10);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x6fa8ff, size: 0.03, transparent: true, opacity: 0.45, depthWrite: false })));
  }

  // ---------- 大脑（真实皮层上的全息） ----------
  // pivot 负责转动；brain 内部用模型坐标，转成侧视：前额朝左、背侧朝上、左半球朝向镜头
  const pivot = new THREE.Group();
  scene.add(pivot);
  const brain = new THREE.Group();
  brain.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
  brain.position.y = 0.25;
  pivot.add(brain);
  const rand = (() => {
    let s = 42;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();

  const shared = {
    uTime: { value: 0 },
    uPower: { value: 1 },
    uWave: { value: -3 },
    uRegionAct: { value: new Float32Array(REGION_IDS.length) },
  };
  const n = REGION_IDS.length;
  const pointMat = new THREE.ShaderMaterial({
    ...pointShader(n),
    uniforms: { ...shared, uDpr: { value: renderer.getPixelRatio() } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // 只写深度不写颜色：挡住脑子背面的粒子，整体才有实心的立体感
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const regionVectors = REGION_IDS.map((id) => REGION_POS[id]);

  /** 每个顶点最近的脑区和影响权重（左右镜像算） */
  function regionAttr(position) {
    const out = new Float32Array((position.length / 3) * 2);
    for (let i = 0, v = 0; i < position.length; i += 3, v += 2) {
      const x = position[i], y = Math.abs(position[i + 1]), z = position[i + 2];
      let best = 0, bd = Infinity;
      for (let k = 0; k < n; k++) {
        const r = regionVectors[k];
        const d = (x - r[0]) ** 2 + (y - r[1]) ** 2 + (z - r[2]) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      out[v] = best;
      out[v + 1] = Math.exp(-bd / 0.2);
    }
    return out;
  }

  /** 遮挡底、轮廓线、边缘光，三者共用一份低模 */
  function addShell(geometry, color) {
    const depth = new THREE.Mesh(geometry, depthMat);
    depth.renderOrder = -2;
    const blend = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    const outline = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ ...outlineShader, ...blend, side: THREE.BackSide, uniforms: { uColor: { value: color.clone().lerp(CYAN, 0.15) } } }));
    const aura = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ ...auraShader, ...blend, uniforms: { uColor: { value: color.clone() } } }));
    brain.add(depth, outline, aura);
  }

  /** count 个粒子，at(i) 返回 [x, y, z, 亮度系数]，亮度系数 <= 0 的跳过 */
  function addCloud(count, color, at) {
    const pp = [], cc = [], ss = [], aa = [];
    for (let i = 0; i < count; i++) {
      const r = rand();
      const q = at(i, r);
      if (!q || q[3] <= 0) continue;
      pp.push(q[0], q[1], q[2]);
      const c = (r > 0.91 ? CYAN : color).clone().multiplyScalar(r > 0.99 ? 2.4 : 1.15);
      cc.push(c.r, c.g, c.b);
      ss.push(0.8 + r * 1.7);
      aa.push((0.24 + r * 0.36) * q[3]);
    }
    const position = Float32Array.from(pp);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(cc, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(ss, 1));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(aa, 1));
    g.setAttribute('aReg', new THREE.BufferAttribute(regionAttr(position), 2));
    brain.add(new THREE.Points(g, pointMat));
  }

  function occluderGeometry(position, index, normal) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    if (normal) g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    else g.computeVertexNormals();
    return g;
  }

  const surf = []; // 表面采样点，记忆光点用
  for (const [side, data, color] of [[1, readLod(cortex.lh), GOLD], [-1, readLod(cortex.rh), BLUE]]) {
    addShell(occluderGeometry(data.occluder.position, data.occluder.index, data.occluder.normal), color);
    const { position: pp, normal: pn } = data.points;
    addCloud(pp.length / 3, color, (i) => [pp[i * 3], pp[i * 3 + 1], pp[i * 3 + 2], 1]);
    for (let i = 0; i < pp.length / 3; i += 5) {
      if (pp[i * 3 + 1] * side > 0.12) surf.push({ v: new THREE.Vector3(pp[i * 3], pp[i * 3 + 1], pp[i * 3 + 2]), n: new THREE.Vector3(pn[i * 3], pn[i * 3 + 1], pn[i * 3 + 2]) });
    }
    // 发光纤维不做深度测试，透出背面的纤维，脑子才显得通透
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.strands.position, 3));
    g.setAttribute('aAlong', new THREE.BufferAttribute(data.strands.along, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(data.strands.seed, 1));
    g.setAttribute('aReg', new THREE.BufferAttribute(regionAttr(data.strands.position), 2));
    const fibers = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      ...strandShader(n),
      uniforms: { ...shared, uColor: { value: color.clone().multiplyScalar(1.7) } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    fibers.renderOrder = 2;
    brain.add(fibers);
  }

  // 真实皮层数据里没有小脑和脑干，这两块是程序生成的，用同样的全息画法接上
  {
    const shell = buildCerebellum(26);
    addShell(occluderGeometry(shell.position, shell.index), BLUE);
    const fine = buildCerebellum(64);
    addCloud(fine.position.length / 3, BLUE, (i, r) => (fine.fold[i] > 0.25 && r < 0.42 ? [fine.position[i * 3], fine.position[i * 3 + 1], fine.position[i * 3 + 2], 0.55] : r < 0.05 ? [fine.position[i * 3], fine.position[i * 3 + 1], fine.position[i * 3 + 2], 0.4] : null));
    const stemShell = buildBrainstem(40, 16);
    addShell(occluderGeometry(stemShell.position, stemShell.index), BLUE);
    const stem = buildBrainstem(120, 48);
    addCloud(stem.position.length / 3, BLUE, (i, r) => (r < 0.4 ? [stem.position[i * 3], stem.position[i * 3 + 1], stem.position[i * 3 + 2], 0.55] : null));
  }

  // 一团很淡的体积光。全屏叠加很费填充率，只留一个
  {
    const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#1a78ff', opacity: 0.06, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    haze.scale.setScalar(5);
    haze.renderOrder = 1;
    brain.add(haze);
  }

  // ---------- 消息信号 ----------
  function createFlow(max, size, depthTest) {
    const pos = new Float32Array(max * 3), col = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    brain.add(new THREE.Points(geo, new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest })));
    const live = []; // {curve, t, speed, color}
    return {
      spawn(curve, color, speed) {
        if (live.length >= max) live.shift();
        live.push({ curve, t: 0, speed, color });
      },
      update(dt, moving) {
        if (!live.length && !geo.drawRange.count) return;
        let k = 0;
        for (let i = live.length - 1; i >= 0; i--) {
          const p = live[i];
          if (moving) p.t += dt * p.speed;
          if (p.t >= 1) {
            live.splice(i, 1);
            continue;
          }
          const v = p.curve.getPoint(p.t);
          pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
          const a = Math.min(1, p.t * 6, (1 - p.t) * 6) * 1.6;
          col[k * 3] = p.color.r * a; col[k * 3 + 1] = p.color.g * a; col[k * 3 + 2] = p.color.b * a;
          k++;
        }
        geo.setDrawRange(0, k);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
      },
    };
  }
  const palette = [new THREE.Color(0x7fe3ff), new THREE.Color(0xffd27a), new THREE.Color(0xc6a8ff), new THREE.Color(0xffffff)];
  const pathFlow = createFlow(120, 0.085, false); // 消息走的主路，穿过深部脑区，要透视显示

  // ---------- 意识海 ----------
  const ocean = createOcean({ stage: canvas.parentElement, dpr: renderer.getPixelRatio(), shared });
  pivot.add(ocean.group);

  // ---------- 飞线：脑区和记忆之间的思考连线，全部在着色器里动，每帧没有 JS 开销 ----------
  const arcMat = new THREE.ShaderMaterial({ ...arcShader, uniforms: { uTime: shared.uTime, uPower: shared.uPower }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const ARC_COLORS = ['#7fe3ff', '#ffd27a', '#ffffff', '#4fa8ff'].map((c) => new THREE.Color(c));
  let arcObj = null;
  function buildArcs(items) {
    const pairs = [];
    const regionAt = (id, flip) => new THREE.Vector3(REGION_POS[id][0], REGION_POS[id][1] * (flip ? -1 : 1), REGION_POS[id][2]);
    CHAT_PATH.slice(1).forEach((id, i) => pairs.push([regionAt(CHAT_PATH[i]), regionAt(id), 'chat' + i]));
    // 固定的一批跨脑区连线，没有记忆时也有飞线
    for (let i = 0; i < 26; i++) {
      const a = REGION_IDS[Math.floor(hash('a' + i) * n)], b = REGION_IDS[Math.floor(hash('b' + i) * n)];
      if (a !== b) pairs.push([regionAt(a, i % 2 === 1), regionAt(b, i % 3 === 0), 'r' + i]);
    }
    // 记忆连到共享实体的另一条记忆；没有的话连到它所在的脑区
    const byEntity = new Map();
    memNodes.forEach((m) => { for (const e of m.item.entities || []) { if (!byEntity.has(e)) byEntity.set(e, []); byEntity.get(e).push(m); } });
    memNodes.slice(0, 48).forEach((m) => {
      let other = null;
      for (const e of m.item.entities || []) { other = byEntity.get(e).find((x) => x !== m); if (other) break; }
      pairs.push([m.pos, other ? other.pos : regionAt(MEM_ANCHOR[m.item.kind]), 'm' + m.item.id]);
    });
    const SEG = 18, count = pairs.length * SEG * 2;
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), along = new Float32Array(count), phase = new Float32Array(count), speed = new Float32Array(count);
    const mid = new THREE.Vector3(), p = new THREE.Vector3();
    pairs.forEach(([a, b, key], i) => {
      // 控制点拉向大脑中部，线从脑子里穿过去
      mid.copy(a).add(b).multiplyScalar(0.28);
      mid.z += 0.25;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const ph = hash('p' + key), sp = 0.16 + hash('s' + key) * 0.2, c = ARC_COLORS[Math.floor(hash('c' + key) * ARC_COLORS.length)];
      for (let s = 0; s < SEG; s++) {
        [s / SEG, (s + 1) / SEG].forEach((t, e) => {
          const v = (i * SEG + s) * 2 + e;
          curve.getPoint(t, p).toArray(pos, v * 3);
          c.toArray(col, v * 3);
          along[v] = t; phase[v] = ph; speed[v] = sp;
        });
      }
    });
    if (arcObj) { arcObj.geometry.dispose(); brain.remove(arcObj); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    arcObj = new THREE.LineSegments(g, arcMat);
    arcObj.renderOrder = 3;
    brain.add(arcObj);
  }
  // ---------- 脑区节点 ----------
  const regionNodes = {};
  const nodeGroup = new THREE.Group();
  brain.add(nodeGroup);
  for (const [id, p] of Object.entries(REGION_POS)) {
    const mat = new THREE.SpriteMaterial({ map: tex, color: 0x7fe3ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.position.set(p[0], p[1], p[2]);
    sp.scale.setScalar(0.16);
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
  const MEM_ANCHOR = { semantic: 'temporal', episodic: 'hippocampus', procedural: 'cerebellum', reflection: 'dmn', diary: 'dmn', self: 'prefrontal' };
  const MEM_COLOR = { semantic: 0xffd27a, episodic: 0x7fe3ff, procedural: 0x7dffb8, reflection: 0xc6a8ff, diary: 0xff9fc0, self: 0xc6a8ff };
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
        const p = s.v.clone().addScaledVector(s.n, 0.025);
        pos.push(p.x, p.y, p.z);
        memNodes.push({ pos: p, normal: s.n, item: it });
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      memGroup.add(new THREE.Points(g, new THREE.PointsMaterial({ color: MEM_COLOR[kind], size: 0.075, map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    }
  }

  // ---------- 交互 ----------
  let spin = true;
  let flowing = true;
  let dragging = false;
  let last = null;
  let rotX = 0.1; // 俯仰
  let rotY = 0.8;
  let userRotX = 0, userRotY = 0;
  let distance = camHome.length();
  const mouse = { x: -1, y: -1, inside: false };
  let lastHover = null;
  let moved = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = 0;
    last = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
    // 没怎么拖 = 点了一下，交给界面决定是看记忆还是看脑区
    if (moved < 6 && lastHover) onPick?.(lastHover);
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.inside = true;
    if (!dragging) return;
    moved += Math.abs(e.clientX - last[0]) + Math.abs(e.clientY - last[1]);
    userRotX += (e.clientY - last[1]) * 0.006;
    userRotY += (e.clientX - last[0]) * 0.006;
    last = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerleave', () => {
    mouse.inside = false;
    lastHover = null;
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
  let lastDraw = 0, perfSum = 0, perfN = 0;
  let mode = 'brain';
  let running = true;
  let activity = 0.3;
  const proj = new THREE.Vector3();
  const facing = new THREE.Vector3(), toCamera = new THREE.Vector3();
  const labels = [];

  const project = (v) => projectFrom(brain, v);
  function projectFrom(obj, v) {
    proj.copy(v).applyMatrix4(obj.matrixWorld).project(camera);
    return { x: (proj.x * 0.5 + 0.5) * canvas.clientWidth, y: (-proj.y * 0.5 + 0.5) * canvas.clientHeight, z: proj.z };
  }

  /** 跟不上目标帧率就逐级降分辨率。只降不升，避免来回切换造成闪烁 */
  function adaptQuality(elapsed, budget) {
    if (document.hidden || elapsed > 400) return;
    perfSum += elapsed;
    if (++perfN < 40) return;
    const avg = perfSum / perfN;
    perfSum = perfN = 0;
    if (avg > budget * 1.5 && quality < QUALITY.length - 1) {
      quality++;
      const pr = QUALITY[quality];
      renderer.setPixelRatio(pr);
      composer.setPixelRatio(pr);
      pointMat.uniforms.uDpr.value = pr;
      ocean.setDpr(pr);
      resize();
    }
  }

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    // 限帧：平时 30 帧，拖动时 60 帧，窗口不在前台时 15 帧。高刷屏上省得最多
    const now = performance.now();
    const budget = dragging ? 16 : document.hasFocus() ? 33 : 66;
    const elapsed = now - lastDraw;
    if (elapsed < budget - 3) return;
    lastDraw = now;
    adaptQuality(elapsed, budget);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    if (spin) {
      rotX = 0.1 + Math.sin(t * 0.1) * 0.06;
      rotY = 0.8 + Math.sin(t * 0.15) * 0.42; // 偏向正面，两个半球都看得到
    }
    pivot.rotation.set(rotX + userRotX, rotY + userRotY, 0);
    camera.position.copy(camHome).setLength(distance);
    camera.lookAt(lookAt);

    if (flowing) shared.uTime.value += dt;
    shared.uPower.value += (0.7 + activity * 0.6 - shared.uPower.value) * 0.05;
    // 思考波每隔几秒从后往前扫一次，越活跃越快
    shared.uWave.value = -2.4 + ((t * (0.35 + activity * 0.6)) % 1) * 5.2;

    // 节点
    REGION_IDS.forEach((id, i) => {
      const n = regionNodes[id];
      n.act += (n.target - n.act) * Math.min(1, dt * 3);
      const pulse = 1 + Math.sin(t * 3 + n.sprite.position.x * 5) * 0.08;
      n.sprite.scale.setScalar((0.06 + n.act * 0.16) * pulse);
      n.sprite.material.opacity = 0.2 + n.act * 0.55;
      shared.uRegionAct.value[i] = n.act;
    });

    // 信号
    pathFlow.update(dt, flowing);

    pivot.updateMatrixWorld();
    // 悬停检测（屏幕空间）
    if (mode === 'ocean') {
      const hit = mouse.inside && !dragging ? ocean.pick((v) => projectFrom(ocean.group, v), mouse.x, mouse.y) : null;
      if (!hit) ocean.clearHot();
      lastHover = hit;
      if (mouse.inside) onHover?.(hit);
      ocean.updateLabels((v) => projectFrom(ocean.group, v));
    } else if (mouse.inside && !dragging) {
      let best = null, bd = 14;
      for (const [id, n] of Object.entries(regionNodes)) {
        const s = project(n.sprite.position);
        const d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
        if (d < bd) { bd = d; best = { type: 'region', id, x: s.x, y: s.y }; }
      }
      for (const m of memNodes) {
        // 转到背面的记忆被大脑挡住了，不能选中
        facing.copy(m.pos).applyMatrix4(brain.matrixWorld);
        toCamera.copy(camera.position).sub(facing);
        if (facing.copy(m.normal).transformDirection(brain.matrixWorld).dot(toCamera) < 0) continue;
        const s = project(m.pos);
        const d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
        if (d < bd * 0.8) { bd = d; best = { type: 'memory', item: m.item, x: s.x, y: s.y }; }
      }
      lastHover = best;
      onHover?.(best);
    } else {
      lastHover = null;
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
  buildArcs([]);
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
    setMemories(items) {
      setMemories(items);
      buildArcs(items);
      ocean.setData(items);
    },
    setMode(m) {
      mode = m;
      brain.visible = m === 'brain';
      ocean.setVisible(m === 'ocean');
      lastHover = null;
      onHover?.(null);
    },
    setOceanLabels: (on) => ocean.setLabels(on),
    /** 一条消息走主路：感觉皮层 → 丘脑 → 杏仁核 → 海马体 → 前额叶 → 语言区 */
    firePath(path = CHAT_PATH) {
      path.forEach((id, i) => {
        setTimeout(() => {
          if (regionNodes[id]) regionNodes[id].act = 1;
          if (i < path.length - 1) {
            const c = regionCurve(id, path[i + 1]);
            for (let j = 0; j < 6; j++) setTimeout(() => pathFlow.spawn(c, palette[3], 0.9), j * 60);
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
