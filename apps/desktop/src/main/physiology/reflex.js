// 反射：非条件反射生来就有；条件反射靠重复建立，长期不用会消退。

const config = require('../config');

const REFLEXES = [
  { id: 'startle', label: '受惊', stimulus: '突然被吵醒或被吓到', centers: ['脑干', '下丘脑'], response: '心跳加快，一下清醒' },
  { id: 'thirst', label: '口渴', stimulus: '血浆渗透压升高', centers: ['下丘脑', '大脑皮层'], response: '想喝水' },
  { id: 'yawn', label: '困倦', stimulus: '褪黑素升高', centers: ['脑干'], response: '打哈欠，想睡' },
];

const MAX_RECENT = 20;
const FIRE_STRENGTH = 0.5;

function observePair(phys, cue, response, now) {
  const c = phys.reflex.conditioned;
  const r = c[cue] || { response, strength: 0, lastAt: now };
  r.response = response;
  r.strength = Math.min(1, r.strength + 0.2);
  r.lastAt = now;
  c[cue] = r;
}

function stepReflex(phys, dtMin) {
  const days = config.get().physiology.conditionedHalfLifeDays;
  for (const r of Object.values(phys.reflex.conditioned)) r.strength *= Math.pow(0.5, dtMin / (days * 24 * 60));
}

/** 这句话触发了哪些条件反射 */
function triggered(phys, text) {
  return Object.entries(phys.reflex.conditioned)
    .filter(([cue, r]) => r.strength >= FIRE_STRENGTH && String(text).includes(cue))
    .map(([, r]) => r.response);
}

function fire(phys, id, now) {
  phys.reflex.recent.push({ id, at: now });
  if (phys.reflex.recent.length > MAX_RECENT) phys.reflex.recent.splice(0, phys.reflex.recent.length - MAX_RECENT);
}

module.exports = { REFLEXES, observePair, stepReflex, triggered, fire };
