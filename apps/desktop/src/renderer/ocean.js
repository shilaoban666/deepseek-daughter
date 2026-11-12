// 意识海：把记忆画成一张 3D 知识图谱。自我在中心，记忆层是枢纽，记忆和它提到的人、物连在一起，
// 共享同一实体的记忆就这样被串起来。节点漂在海面上，光点沿连线流动。

import * as THREE from './vendor/three/three.module.js';

const LAYERS = {
  semantic: { name: '语义记忆', color: '#ffc247' },
  episodic: { name: '情景记忆', color: '#4fd6ff' },
  procedural: { name: '程序记忆', color: '#7dffb8' },
  reflection: { name: '反思', color: '#c6a8ff' },
  diary: { name: '日记', color: '#ff9fc0' },
  self: { name: '自我叙事', color: '#9fd0ff' },
};
const ENTITY_COLOR = '#ffe6a8';
const CONTRADICT_COLOR = '#ff6a7a';
const MAX_ENTITIES = 60;
const MAX_LABELS = 26;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// 节点和连线用同一个起伏函数，连线才不会和节点脱开
const bob = 'vec3 bob(vec3 p){ p.y += sin(uTime * 0.6 + p.x * 1.3 + p.z * 1.7) * 0.07; return p; }';

const nodeShader = {
  vertexShader: /* glsl */ `
    attribute vec3 aColor;
    attribute float aSize, aIdx, aKind;
    uniform float uTime, uDpr, uHot;
    varying vec3 vColor;
    varying float vHot, vKind, vTw;
    ${bob}
    void main() {
      vec4 mv = modelViewMatrix * vec4(bob(position), 1.0);
      gl_Position = projectionMatrix * mv;
      vHot = abs(aIdx - uHot) < 0.5 ? 1.0 : 0.0;
      vKind = aKind;
      // 每颗星按自己的节奏轻轻闪
      vTw = 0.86 + 0.14 * sin(uTime * (1.1 + fract(aIdx * 0.37) * 1.4) + aIdx * 2.3);
      // 枢纽和“自我”画大一点，给星芒和光环留地方
      float room = aKind > 1.5 ? 2.3 : aKind > 0.5 ? 1.5 : 1.25;
      gl_PointSize = clamp(aSize * room * uDpr * 9.0 / max(1.0, -mv.z) * (1.0 + vHot * 0.5), 2.0, 150.0);
      vColor = aColor;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec3 vColor;
    varying float vHot, vKind, vTw;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float room = vKind > 1.5 ? 2.3 : vKind > 0.5 ? 1.5 : 1.25;
      float d = length(uv) * 2.0 * room; // 换回“星体半径 = 1”的尺度
      float core = smoothstep(0.5, 0.22, d);
      float glow = exp(-d * d * 3.2);
      float halo = exp(-d * 1.6) * 0.22;
      // 四道星芒，只有实体、枢纽和“自我”有
      vec2 q = abs(uv) * room;
      float flare = vKind > 0.5 ? (exp(-q.y * 42.0) * exp(-q.x * 3.6) + exp(-q.x * 42.0) * exp(-q.y * 3.6)) * 0.7 : 0.0;
      // 枢纽外面一圈缓缓呼吸的光环
      float ring = vKind > 1.5 ? smoothstep(0.07, 0.0, abs(d - (1.55 + 0.1 * sin(uTime * 1.3 + vColor.r * 6.0)))) * 0.42 : 0.0;
      float a = max(max(core, glow * 0.6), max(flare, ring)) + halo;
      if (a < 0.008) discard;
      vec3 col = mix(vColor, vec3(1.7), core * 0.6) * (1.0 + vHot) * vTw;
      gl_FragColor = vec4(col, min(a, 1.0));
    }`,
};

// 节点在海面上的倒影：压扁、拉长、很淡，随波纹晃
const reflShader = {
  vertexShader: /* glsl */ `
    attribute vec3 aColor;
    attribute float aSize;
    uniform float uTime, uDpr;
    varying vec3 vColor;
    void main() {
      vec3 p = position;
      p.y = -1.5 - (position.y + 1.5) * 0.12;
      p.x += sin(uTime * 0.9 + position.z * 2.0) * 0.03;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(aSize * uDpr * 16.0 / max(1.0, -mv.z), 2.0, 120.0);
      vColor = aColor;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    void main() {
      vec2 uv = (gl_PointCoord - 0.5) * 2.0;
      float d = length(vec2(uv.x, uv.y * 2.6));
      if (d > 1.0) discard;
      gl_FragColor = vec4(vColor, exp(-d * d * 3.0) * 0.16);
    }`,
};

// 从枢纽垂到海面的细线：让人看出它们是“漂在海上”的
const dropShader = {
  vertexShader: /* glsl */ `
    attribute vec3 aColor;
    attribute float aT;
    uniform float uTime;
    varying vec3 vColor;
    varying float vT;
    ${bob}
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(aT < 0.5 ? bob(position) : position, 1.0);
      vColor = aColor; vT = aT;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vT;
    void main() { gl_FragColor = vec4(vColor, 0.2 * (1.0 - vT) * (1.0 - vT)); }`,
};

// 海面中央一片发光的水域，外加一圈圈往外走的涟漪
const poolShader = {
  vertexShader: /* glsl */ `
    varying vec2 vP;
    void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec2 vP;
    void main() {
      float r = length(vP);
      float glow = exp(-r * r * 0.14) * 0.09;
      float ripple = smoothstep(0.022, 0.0, abs(fract(r * 0.55 - uTime * 0.07) - 0.5)) * exp(-r * 0.45) * 0.2;
      gl_FragColor = vec4(mix(vec3(0.08, 0.3, 0.75), vec3(0.3, 0.8, 1.0), ripple * 2.0), glow + ripple);
    }`,
};

const edgeShader = {
  vertexShader: /* glsl */ `
    attribute vec3 aColor;
    attribute float aAlong, aPhase, aSpeed;
    attribute vec2 aEnds;
    uniform float uTime, uHot;
    varying vec3 vColor;
    varying float vAlong, vPhase, vSpeed, vHot;
    ${bob}
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(bob(position), 1.0);
      vColor = aColor; vAlong = aAlong; vPhase = aPhase; vSpeed = aSpeed;
      vHot = (abs(aEnds.x - uHot) < 0.5 || abs(aEnds.y - uHot) < 0.5) ? 1.0 : 0.0;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime, uPower;
    varying vec3 vColor;
    varying float vAlong, vPhase, vSpeed, vHot;
    void main() {
      float head = fract(uTime * vSpeed + vPhase) * 1.6 - 0.3;
      float d = head - vAlong;
      float tail = (d >= 0.0 && d < 0.3) ? pow(1.0 - d / 0.3, 2.0) : 0.0;
      float a = 0.07 + 0.09 * abs(vAlong - 0.5) * 2.0 + vHot * 0.55 + tail * 0.9 * uPower;
      gl_FragColor = vec4(vColor * (1.0 + tail * 2.0), min(a, 1.0));
    }`,
};

const seaShader = {
  vertexShader: /* glsl */ `
    uniform float uTime, uDpr;
    varying float vA, vCrest;
    void main() {
      vec3 p = position;
      float r = length(p.xz);
      p.y += sin(p.x * 1.4 + uTime * 0.7) * 0.07 + sin(p.z * 1.9 - uTime * 0.5) * 0.06 + sin((p.x + p.z) * 3.1 + uTime) * 0.025;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = max(1.0, 12.0 * uDpr / max(1.0, -mv.z));
      float ring = sin(r * 3.4 - uTime * 0.9);
      p.y += ring * 0.03 * smoothstep(7.0, 0.5, r);
      float crest = p.y - position.y;
      vA = smoothstep(7.4, 1.5, r) * (0.26 + crest * 2.4);
      vCrest = clamp(crest * 5.0 + 0.4, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying float vA, vCrest;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0 || vA < 0.01) discard;
      gl_FragColor = vec4(mix(vec3(0.07, 0.34, 0.95), vec3(0.35, 0.9, 1.0), vCrest), exp(-d * d * 3.0) * vA);
    }`,
};

/** 力导向布局。初始位置由 ID 散列决定，同样的数据每次排出来一样，记忆不会到处乱跳 */
function layout(nodes, edges) {
  const n = nodes.length;
  const p = new Float32Array(n * 3);
  nodes.forEach((node, i) => {
    p[i * 3] = (hash('x' + node.key) - 0.5) * 4;
    p[i * 3 + 1] = (hash('y' + node.key) - 0.5) * 4;
    p[i * 3 + 2] = (hash('z' + node.key) - 0.5) * 4;
  });
  const f = new Float32Array(n * 3);
  for (let it = 0; it < 240; it++) {
    const heat = 0.09 * (1 - it / 240) + 0.008;
    f.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = p[i * 3] - p[j * 3], dy = p[i * 3 + 1] - p[j * 3 + 1], dz = p[i * 3 + 2] - p[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.02;
        const k = 0.34 / d2;
        f[i * 3] += dx * k; f[i * 3 + 1] += dy * k; f[i * 3 + 2] += dz * k;
        f[j * 3] -= dx * k; f[j * 3 + 1] -= dy * k; f[j * 3 + 2] -= dz * k;
      }
    }
    for (const e of edges) {
      const dx = p[e.b * 3] - p[e.a * 3], dy = p[e.b * 3 + 1] - p[e.a * 3 + 1], dz = p[e.b * 3 + 2] - p[e.a * 3 + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-3;
      const k = (d - e.rest) * 0.55 / d;
      f[e.a * 3] += dx * k; f[e.a * 3 + 1] += dy * k; f[e.a * 3 + 2] += dz * k;
      f[e.b * 3] -= dx * k; f[e.b * 3 + 1] -= dy * k; f[e.b * 3 + 2] -= dz * k;
    }
    for (let i = 0; i < n * 3; i++) f[i] -= p[i] * 0.12;
    for (let i = 0; i < n * 3; i++) p[i] += Math.max(-1, Math.min(1, f[i] * heat * 2));
    p[0] = p[1] = p[2] = 0; // “自我”永远在正中间
  }
  // 压扁成一片浮在海面上的云，并缩放到舞台大小
  let radius = 1e-3;
  for (let i = 0; i < n; i++) radius = Math.max(radius, Math.hypot(p[i * 3], p[i * 3 + 2]));
  const s = 3.1 / radius;
  nodes.forEach((node, i) => node.pos.set(p[i * 3] * s, p[i * 3 + 1] * s * 0.42 + 0.35, p[i * 3 + 2] * s));
}

function buildGraph(items) {
  const nodes = [{ key: 'self', type: 'entity', label: '自我', detail: '意识海的中心', color: '#ffffff', size: 26, pos: new THREE.Vector3() }];
  const edges = [];
  const link = (a, b, rest, color) => edges.push({ a, b, rest, color });
  const hubOf = {};
  const hub = (kind) => {
    if (hubOf[kind] !== undefined) return hubOf[kind];
    const def = LAYERS[kind] || { name: kind, color: '#92caff' };
    hubOf[kind] = nodes.length;
    nodes.push({ key: 'hub:' + kind, type: 'entity', label: def.name, detail: '记忆层', color: def.color, size: 19, pos: new THREE.Vector3() });
    link(0, hubOf[kind], 1.5, def.color);
    return hubOf[kind];
  };
  // 被提到次数最多的实体才进图，避免一团乱麻
  const counts = new Map();
  for (const it of items) for (const e of it.entities || []) counts.set(e, (counts.get(e) || 0) + 1);
  const entityOf = new Map();
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTITIES).forEach(([name, degree]) => {
    entityOf.set(name, nodes.length);
    nodes.push({ key: 'e:' + name, type: 'entity', label: name, detail: `${degree} 条记忆提到`, color: ENTITY_COLOR, size: 8 + Math.min(10, degree * 2), degree, pos: new THREE.Vector3() });
  });
  const memOf = new Map();
  for (const it of items) {
    const def = LAYERS[it.kind] || { color: '#92caff' };
    const idx = nodes.length;
    memOf.set(it.id, idx);
    nodes.push({ key: 'm:' + it.id, type: 'memory', item: it, color: def.color, size: 5.5 + Math.min(1, (it.importance || 2) / 5) * 5, pos: new THREE.Vector3() });
    link(hub(it.kind), idx, 0.95, def.color);
    for (const e of it.entities || []) if (entityOf.has(e)) link(idx, entityOf.get(e), 0.75, ENTITY_COLOR);
  }
  for (const it of items) {
    for (const l of it.links || []) {
      if (memOf.has(l.to) && it.id < l.to) link(memOf.get(it.id), memOf.get(l.to), 0.6, l.type === 'contradicts' ? CONTRADICT_COLOR : '#92caff');
    }
  }
  return { nodes, edges };
}

export function createOcean({ stage, dpr, shared }) {
  const group = new THREE.Group();
  group.visible = false;
  const uniforms = { uTime: shared.uTime, uPower: shared.uPower, uDpr: { value: dpr }, uHot: { value: -1 } };
  const additive = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending };
  const nodeMat = new THREE.ShaderMaterial({ ...nodeShader, uniforms, ...additive });
  const edgeMat = new THREE.ShaderMaterial({ ...edgeShader, uniforms, ...additive });
  const reflMat = new THREE.ShaderMaterial({ ...reflShader, uniforms, ...additive });
  const dropMat = new THREE.ShaderMaterial({ ...dropShader, uniforms, ...additive });
  // 发光的水域只在有记忆时出现（空的意识海不能有大块亮光）
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ ...poolShader, uniforms, ...additive, side: THREE.DoubleSide }));
  pool.position.y = -1.52;
  pool.visible = false;
  pool.renderOrder = 1;
  group.add(pool);

  {
    const n = 132, pos = new Float32Array(n * n * 3);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = (i * n + j) * 3;
      pos[k] = (i / (n - 1) - 0.5) * 15; pos[k + 1] = -1.5; pos[k + 2] = (j / (n - 1) - 0.5) * 15;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    group.add(new THREE.Points(g, new THREE.ShaderMaterial({ ...seaShader, uniforms, ...additive })));
  }

  let nodes = [], nodeObj = null, edgeObj = null, reflObj = null, dropObj = null, signature = '', labels = [], labelsOn = true;
  // 左上角的图例：每一层是什么颜色、有多少条
  const legend = document.createElement('div');
  legend.className = 'ocean-legend';
  legend.hidden = true;
  stage.appendChild(legend);
  const SEG = 14; // 每条连线分成几段画成弧
  const A = new THREE.Vector3(), B = new THREE.Vector3(), M = new THREE.Vector3(), P = new THREE.Vector3();
  // 一条记忆都没有时不画节点，只显示一句提示（以前只剩“自我”一个点，会被缩放到角落变成一团白光）
  const emptyHint = document.createElement('div');
  emptyHint.className = 'ocean-empty';
  emptyHint.textContent = '还没有记忆，和她聊几句就会长出来';
  emptyHint.hidden = true;
  stage.appendChild(emptyHint);
  let isEmpty = true;
  const color = new THREE.Color();

  function clearLabels() {
    for (const l of labels) l.el.remove();
    labels = [];
  }
  function buildLabels() {
    clearLabels();
    if (!labelsOn || !group.visible) return;
    nodes.filter((x) => x.type === 'entity').sort((a, b) => b.size - a.size).slice(0, MAX_LABELS).forEach((node) => {
      const el = document.createElement('div');
      el.className = 'region-label ocean-label';
      el.textContent = node.label;
      stage.appendChild(el);
      labels.push({ el, node });
    });
  }

  function setData(items) {
    const sig = JSON.stringify(items.map((i) => [i.id, i.kind, i.entities, i.links]));
    if (sig === signature) return;
    signature = sig;
    isEmpty = !items.length;
    emptyHint.hidden = !(isEmpty && group.visible);
    const graph = isEmpty ? { nodes: [], edges: [] } : buildGraph(items);
    layout(graph.nodes, graph.edges);
    nodes = graph.nodes;
    for (const o of [nodeObj, edgeObj, reflObj, dropObj]) if (o) { o.geometry.dispose(); group.remove(o); }
    pool.visible = !isEmpty;
    const counts = {};
    for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1;
    const entityCount = graph.nodes.filter((x) => x.type === 'entity' && x.key.startsWith('e:')).length;
    legend.innerHTML = `<b>${items.length} 段记忆</b><span>${entityCount} 个人和物 · ${graph.edges.length} 条联想</span>` +
      Object.entries(LAYERS).filter(([k]) => counts[k]).map(([k, v]) => `<div><i style="background:${v.color};box-shadow:0 0 6px ${v.color}"></i>${v.name}<em>${counts[k]}</em></div>`).join('') +
      `<div><i style="background:${ENTITY_COLOR};box-shadow:0 0 6px ${ENTITY_COLOR}"></i>提到的人和物<em>${entityCount}</em></div>`;
    legend.hidden = !(group.visible && !isEmpty);

    const np = new Float32Array(nodes.length * 3), nc = new Float32Array(nodes.length * 3), ns = new Float32Array(nodes.length), ni = new Float32Array(nodes.length), nk = new Float32Array(nodes.length);
    nodes.forEach((node, i) => {
      node.pos.toArray(np, i * 3);
      color.set(node.color).toArray(nc, i * 3);
      ns[i] = node.size;
      ni[i] = i;
      nk[i] = node.key === 'self' ? 3 : node.key.startsWith('hub:') ? 2 : node.type === 'entity' ? 1 : 0;
    });
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(np, 3));
    ng.setAttribute('aColor', new THREE.BufferAttribute(nc, 3));
    ng.setAttribute('aSize', new THREE.BufferAttribute(ns, 1));
    ng.setAttribute('aIdx', new THREE.BufferAttribute(ni, 1));
    ng.setAttribute('aKind', new THREE.BufferAttribute(nk, 1));
    nodeObj = new THREE.Points(ng, nodeMat);
    nodeObj.renderOrder = 3;
    group.add(nodeObj);
    reflObj = new THREE.Points(ng.clone(), reflMat);
    reflObj.renderOrder = 1;
    group.add(reflObj);

    // 枢纽、实体各垂一根细线到海面
    const anchors = nodes.filter((x) => x.type === 'entity');
    const dp = new Float32Array(anchors.length * 6), dc = new Float32Array(anchors.length * 6), dt = new Float32Array(anchors.length * 2);
    anchors.forEach((node, i) => {
      node.pos.toArray(dp, i * 6);
      dp[i * 6 + 3] = node.pos.x; dp[i * 6 + 4] = -1.5; dp[i * 6 + 5] = node.pos.z;
      color.set(node.color);
      color.toArray(dc, i * 6); color.toArray(dc, i * 6 + 3);
      dt[i * 2 + 1] = 1;
    });
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dg.setAttribute('aColor', new THREE.BufferAttribute(dc, 3));
    dg.setAttribute('aT', new THREE.BufferAttribute(dt, 1));
    dropObj = new THREE.LineSegments(dg, dropMat);
    dropObj.renderOrder = 1;
    group.add(dropObj);

    const m = graph.edges.length * SEG * 2;
    const ep = new Float32Array(m * 3), ec = new Float32Array(m * 3), ea = new Float32Array(m), ef = new Float32Array(m), es = new Float32Array(m), ee = new Float32Array(m * 2);
    graph.edges.forEach((e, i) => {
      const phase = hash(`${e.a}:${e.b}`), speed = 0.1 + hash(`${e.b}:${e.a}`) * 0.16;
      color.set(e.color);
      A.copy(nodes[e.a].pos); B.copy(nodes[e.b].pos);
      // 控制点往上抬一点，连线就成了一道弧
      M.copy(A).add(B).multiplyScalar(0.5);
      M.y += A.distanceTo(B) * (0.14 + phase * 0.1);
      for (let k = 0; k < SEG; k++) for (let end = 0; end < 2; end++) {
        const t = (k + end) / SEG, u = 1 - t;
        const v = (i * SEG + k) * 2 + end;
        P.set(u * u * A.x + 2 * u * t * M.x + t * t * B.x, u * u * A.y + 2 * u * t * M.y + t * t * B.y, u * u * A.z + 2 * u * t * M.z + t * t * B.z);
        P.toArray(ep, v * 3);
        color.toArray(ec, v * 3);
        ea[v] = t; ef[v] = phase; es[v] = speed;
        ee[v * 2] = e.a; ee[v * 2 + 1] = e.b;
      }
    });
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    eg.setAttribute('aColor', new THREE.BufferAttribute(ec, 3));
    eg.setAttribute('aAlong', new THREE.BufferAttribute(ea, 1));
    eg.setAttribute('aPhase', new THREE.BufferAttribute(ef, 1));
    eg.setAttribute('aSpeed', new THREE.BufferAttribute(es, 1));
    eg.setAttribute('aEnds', new THREE.BufferAttribute(ee, 2));
    edgeObj = new THREE.LineSegments(eg, edgeMat);
    edgeObj.renderOrder = 2;
    group.add(edgeObj);
    buildLabels();
  }

  return {
    group,
    setData,
    setVisible(v) {
      group.visible = v;
      emptyHint.hidden = !(isEmpty && v);
      legend.hidden = !(v && !isEmpty);
      if (v) buildLabels(); else clearLabels();
    },
    setLabels(on) {
      labelsOn = on;
      buildLabels();
    },
    setDpr(v) { uniforms.uDpr.value = v; },
    /** project(v) 把节点坐标换成屏幕坐标。返回鼠标下的节点，并高亮它 */
    pick(project, mx, my) {
      let best = -1, bd = 16, hit = null;
      nodes.forEach((node, i) => {
        const s = project(node.pos);
        const d = Math.hypot(s.x - mx, s.y - my);
        if (d < bd) { bd = d; best = i; hit = s; }
      });
      uniforms.uHot.value = best;
      if (best < 0) return null;
      const node = nodes[best];
      return node.type === 'memory' ? { type: 'memory', item: node.item, x: hit.x, y: hit.y } : { type: 'entity', label: node.label, detail: node.detail, x: hit.x, y: hit.y };
    },
    clearHot() { uniforms.uHot.value = -1; },
    updateLabels(project) {
      for (const l of labels) {
        const s = project(l.node.pos);
        l.el.style.transform = `translate(${s.x + 10}px, ${s.y - 8}px)`;
      }
    },
  };
}
