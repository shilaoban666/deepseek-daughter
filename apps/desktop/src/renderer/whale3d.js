// 她的 3D 卡通形象：原创的小鲸鱼，全部用代码生成，没有外部模型。
// 拖动旋转，点一下或按按钮做动作；睡着时闭眼、动作变慢。只在可见时渲染，平时 30 帧。

import * as THREE from './vendor/three/three.module.js';

const BASE_YAW = Math.PI + 0.95; // 头朝左前方，和图标一致
const BODY = 0x3fc4f5;
const BELLY = 0xf2fbff;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function toonRamp() {
  const tex = new THREE.DataTexture(Uint8Array.from([120, 185, 235, 255]), 4, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** 头在 +x，尾在 -x 的身体，腹部用顶点色染白 */
function bodyGeometry() {
  const pts = [];
  for (let i = 0; i <= 44; i++) {
    const t = 1 - i / 44; // 从尾到头，车削面的法线才朝外
    const r = 0.86 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.62))), 0.8) * (1 - 0.25 * t);
    pts.push(new THREE.Vector2(Math.max(r, 0.0005), 1.05 - 2.4 * t));
  }
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateZ(-Math.PI / 2);
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color(BODY), b = new THREE.Color(BELLY), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const belly = smooth(0.12, 0.2, -n.getY(i) - 0.28 * smooth(0.0, -1.1, p.getX(i)));
    c.copy(a).lerp(b, belly).toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function createWhale(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, 0.35, 6);
  camera.lookAt(0, -0.02, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a78c8, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(-2, 3.5, 4);
  scene.add(sun);

  const ramp = toonRamp();
  const toon = (color, extra) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
  const skin = toon(BODY);
  const ball = (r, mat, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), mat);
    m.scale.set(sx, sy, sz);
    return m;
  };

  const root = new THREE.Group();
  scene.add(root);
  root.add(new THREE.Mesh(bodyGeometry(), toon(0xffffff, { vertexColors: true })));

  const eyes = [];
  const dark = new THREE.MeshBasicMaterial({ color: 0x12263f });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blush = new THREE.MeshBasicMaterial({ color: 0xff9db5, transparent: true, opacity: 0.75 });
  for (const s of [1, -1]) {
    const eye = new THREE.Group();
    eye.position.set(0.7, 0.25, 0.62 * s);
    eye.add(ball(0.1, dark));
    const glint = ball(0.034, shine);
    glint.position.set(0.05, 0.05, 0.075 * s);
    eye.add(glint);
    root.add(eye);
    eyes.push(eye);
    const cheek = ball(0.11, blush, 0.8, 0.5, 0.25);
    cheek.position.set(0.62, -0.1, 0.725 * s);
    cheek.rotation.y = -0.65 * s;
    root.add(cheek);
  }
  {
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 18, Math.PI), dark);
    smile.geometry.rotateZ(Math.PI);
    smile.geometry.rotateY(Math.PI / 2);
    smile.position.set(1.02, -0.1, 0);
    root.add(smile);
  }

  const flippers = [1, -1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.18, -0.4, 0.62 * s);
    const fin = ball(0.34, skin, 1, 0.16, 0.55);
    fin.position.set(-0.12, -0.04, 0.26 * s);
    fin.rotation.y = 0.5 * s;
    pivot.add(fin);
    root.add(pivot);
    return pivot;
  });

  const tail = new THREE.Group();
  tail.position.set(-1.15, 0.06, 0);
  tail.rotation.z = -0.55;
  for (const s of [1, -1]) {
    const fluke = ball(0.4, skin, 1, 0.14, 0.58);
    fluke.position.set(-0.24, 0, 0.24 * s);
    fluke.rotation.y = -0.65 * s;
    tail.add(fluke);
  }
  root.add(tail);

  // 喷出的水珠
  const DROPS = 12;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xbff0ff }), DROPS);
  drops.visible = false;
  root.add(drops);
  const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), noRot = new THREE.Quaternion();

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------- 交互 ----------
  let dragging = false, last = null, moved = 0, userYaw = 0, userPitch = 0, idleSince = 0;
  let asleep = false;
  let action = null; // {name, start, dur}
  const NAMES = ['spin', 'jump', 'spout', 'wag'];

  const act = (name) => { action = { name, start: performance.now() / 1000, dur: name === 'spin' ? 1.2 : name === 'jump' ? 0.9 : 1.6 }; };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = 0;
    last = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved += Math.abs(e.clientX - last[0]) + Math.abs(e.clientY - last[1]);
    userYaw += (e.clientX - last[0]) * 0.012;
    userPitch = Math.max(-0.7, Math.min(0.7, userPitch + (e.clientY - last[1]) * 0.008));
    last = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
    idleSince = performance.now() / 1000;
    if (moved < 5) act(NAMES[Math.floor(Math.random() * NAMES.length)]);
  });

  // ---------- 动画 ----------
  let lastDraw = 0, blinkAt = 2, nextSpout = 9, raf = 0, running = true;
  function frame(nowMs) {
    raf = requestAnimationFrame(frame);
    if (nowMs - lastDraw < 30 || document.hidden) return;
    lastDraw = nowMs;
    const t = nowMs / 1000;
    const speed = asleep ? 0.45 : 1;

    let yaw = 0, jump = 0, squash = 0, wag = 1, spout = -1;
    if (action) {
      const k = (t - action.start) / action.dur;
      if (k >= 1) action = null;
      else if (action.name === 'spin') yaw = (1 - (1 - k) ** 3) * Math.PI * 2;
      else if (action.name === 'jump') { jump = Math.sin(k * Math.PI) * 0.55; squash = Math.sin(k * Math.PI * 2) * 0.07; }
      else if (action.name === 'wag') wag = 3;
      else spout = k;
    }
    if (!asleep && !action && t > nextSpout) {
      act('spout');
      nextSpout = t + 12 + Math.random() * 10;
    }

    // 松手几秒后慢慢转回默认朝向
    if (!dragging && t - idleSince > 4) {
      const wrapped = ((userYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      userYaw = wrapped * 0.97;
      userPitch *= 0.97;
    }
    root.rotation.set(userPitch, BASE_YAW + userYaw + yaw, Math.sin(t * 0.9 * speed) * 0.05);
    root.position.y = Math.sin(t * 1.6 * speed) * 0.06 + jump;
    root.scale.set(1 + squash, 1 - squash, 1 + squash);
    tail.rotation.z = -0.55 + Math.sin(t * 2.6 * speed * (wag > 1 ? 2.4 : 1)) * 0.2 * wag;
    tail.rotation.y = Math.sin(t * 1.3 * speed) * 0.2;
    flippers.forEach((f, i) => { f.rotation.x = (i ? -1 : 1) * (0.25 + Math.sin(t * 2.1 * speed) * 0.22); });

    // 眨眼，睡着时闭着
    if (t > blinkAt + 0.14) blinkAt = t + 2 + Math.random() * 4;
    const open = asleep ? 0.1 : t > blinkAt ? 0.12 : 1;
    eyes.forEach((e) => { e.scale.y += (open - e.scale.y) * 0.6; });

    drops.visible = spout >= 0;
    if (spout >= 0) {
      for (let i = 0; i < DROPS; i++) {
        const a = (i / DROPS) * Math.PI * 2, life = (spout * 1.6 + i * 0.07) % 1;
        const up = life * (1.15 - life * 0.75);
        pos.set(0.32 + Math.cos(a) * life * 0.34, 0.82 + up, Math.sin(a) * life * 0.34);
        const s = (1 - life) * 1.05 + 0.15;
        drops.setMatrixAt(i, matrix.compose(pos, noRot, one.set(s, s, s)));
      }
      drops.instanceMatrix.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    act,
    pause() { running = false; cancelAnimationFrame(raf); },
    resume() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
    setState(s) { asleep = !!s.asleep; },
  };
}
