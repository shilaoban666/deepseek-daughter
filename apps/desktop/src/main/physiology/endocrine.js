// 内分泌：下丘脑—垂体—靶腺的分级调节和负反馈，胰岛素和胰高血糖素调节血糖。

const { approach, clamp } = require('./homeostasis');

const HORMONES = [
  { id: 'insulin', name: '胰岛素', gland: '胰岛', target: '全身细胞', effect: '降血糖' },
  { id: 'glucagon', name: '胰高血糖素', gland: '胰岛', target: '肝脏', effect: '升血糖' },
  { id: 'adrenaline', name: '肾上腺素', gland: '肾上腺', target: '全身', effect: '应急，心跳加快' },
  { id: 'thyroxine', name: '甲状腺激素', gland: '甲状腺', target: '全身细胞', effect: '调节代谢快慢' },
  { id: 'tsh', name: '促甲状腺激素', gland: '垂体', target: '甲状腺', effect: '促进甲状腺分泌' },
  { id: 'trh', name: '促甲状腺激素释放激素', gland: '下丘脑', target: '垂体', effect: '分级调节的起点' },
  { id: 'growth', name: '生长激素', gland: '垂体', target: '全身', effect: '睡觉时分泌，促进生长' },
  { id: 'adh', name: '抗利尿激素', gland: '下丘脑合成、垂体释放', target: '肾', effect: '减少尿量' },
  { id: 'aldosterone', name: '醛固酮', gland: '肾上腺', target: '肾', effect: '保钠' },
];

/**
 * 通用分级调节：释放激素 → 促激素 → 靶激素。靶激素高了就抑制前两级。
 * @param {{releasing:number, tropic:number, target:number}} axis
 * @param {number} drive 上游驱动（0–100）
 */
function stepAxis(axis, drive, dt) {
  const feedback = clamp((axis.target - 50) / 50, -1, 1);
  axis.releasing = approach(axis.releasing, clamp(drive - feedback * 25), dt, 20);
  axis.tropic = approach(axis.tropic, clamp(axis.releasing - feedback * 20), dt, 30);
  axis.target = approach(axis.target, clamp(axis.tropic * 0.9 + 5), dt, 45);
  return axis;
}

/** 甲状腺激素决定基础代谢：血糖消耗乘上这个系数 */
const metabolicRate = (phys) => 0.85 + (clamp(phys.hormones.thyroxine) / 100) * 0.3;

function stepEndocrine(b, s, dt, cfg) {
  const h = b.phys.hormones;
  // 血糖：肝糖原是缓冲，耗尽后血糖才会真正掉下来
  h.insulin = approach(h.insulin, clamp(20 + (b.glucose - 40) * 2.2), dt, 8);
  h.glucagon = approach(h.glucagon, clamp(20 + (40 - b.glucose) * 2.2), dt, 8);
  const net = (h.glucagon - h.insulin) * cfg.liverRate * dt;
  const liver = b.phys.liver;
  if (net > 0) {
    const release = Math.min(net, liver.glycogen / 2);
    liver.glycogen -= release * 2;
    b.glucose = clamp(b.glucose + release);
  } else {
    liver.glycogen = clamp(liver.glycogen - net * 1.5);
    b.glucose = clamp(b.glucose + net);
  }

  const thyroid = { releasing: h.trh, tropic: h.tsh, target: h.thyroxine };
  stepAxis(thyroid, 42, dt);
  h.trh = thyroid.releasing; h.tsh = thyroid.tropic; h.thyroxine = thyroid.target;

  const gonad = { releasing: h.gnrh, tropic: h.gonadotropin, target: h.sexHormone };
  stepAxis(gonad, 32, dt);
  h.gnrh = gonad.releasing; h.gonadotropin = gonad.tropic; h.sexHormone = gonad.target;

  h.adrenaline = approach(h.adrenaline, clamp(10 + (b.nt.norepinephrine - 40) * 0.5 + (b.nt.cortisol - 25) * 0.3), dt, 6);
  h.growth = approach(h.growth, s.asleep ? 60 : 25, dt, 40);
}

module.exports = { HORMONES, stepAxis, stepEndocrine, metabolicRate };
