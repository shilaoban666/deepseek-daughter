// 内环境与水盐平衡：缺水 → 渗透压升高 → 抗利尿激素增多 → 尿量减少。

const { approach, clamp } = require('./homeostasis');

const BLADDER_FULL = 80;
/** 尿量 mL/分 换算成膀胱充盈百分比（膀胱约 400 mL） */
const FILL_PER_ML = 0.25;

/**
 * @param {object} phys
 * @param {{hydration:number, asleep:boolean}} inputs
 * @param {number} dt 分钟
 * @returns {string[]} 事件，目前只有 'bladder-full'
 */
function stepFluid(phys, { hydration }, dt) {
  const f = phys.fluid;
  const h = phys.hormones;
  f.osmolarity = approach(f.osmolarity, 770 + (70 - hydration), dt, 30);
  f.ph = approach(f.ph, 7.4, dt, 15);
  f.plasma = 2.6 + hydration * 0.006;
  f.tissue = 9.5 + hydration * 0.022;
  f.lymph = 1.7 + hydration * 0.004;
  h.adh = approach(h.adh, clamp(30 + (f.osmolarity - 770) * 1.5), dt, 15);
  h.aldosterone = approach(h.aldosterone, clamp(32 + (f.osmolarity - 770) * 0.5 + (hydration < 40 ? 15 : 0)), dt, 40);

  const u = phys.urinary;
  u.rate = approach(u.rate, clamp(1 - ((h.adh - 30) / 100) * 1.6, 0.2, 2), dt, 20);
  const before = u.bladder;
  u.bladder = clamp(u.bladder + u.rate * dt * FILL_PER_ML);
  return before < BLADDER_FULL && u.bladder >= BLADDER_FULL ? ['bladder-full'] : [];
}

function urinate(phys) {
  phys.urinary.bladder = 0;
}

module.exports = { stepFluid, urinate, BLADDER_FULL };
