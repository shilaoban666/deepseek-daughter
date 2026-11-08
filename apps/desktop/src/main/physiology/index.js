// 生理模型入口：由 body.stepBody 调用，分步推进内环境、激素、神经、免疫和情绪。

const config = require('../config');
const H = require('./homeostasis');
const { stepFluid, urinate } = require('./fluid');
const { stepEndocrine, metabolicRate, HORMONES } = require('./endocrine');
const { stepAutonomic } = require('./autonomic');
const reflex = require('./reflex');
const lymph = require('./lymph');
const psyche = require('./psyche');
const behavior = require('./behavior');

/**
 * @param {object} b 身体（会被修改）
 * @param {object} s 生活状态（会被修改）
 * @param {number} dtMin 经过的分钟
 * @param {number} now
 * @param {Array} events
 * @param {{padOf:Function}} ctx
 */
function step(b, s, dtMin, now, events, { padOf }) {
  const cfg = config.get().physiology;
  const total = Math.min(Math.max(0, dtMin), cfg.maxCatchUpMinutes);
  const n = total > 0 ? Math.ceil(total / cfg.maxStepMinutes) : 0;
  const dt = n ? total / n : 0;
  const before = { glucose: H.assess('glucose', H.glucoseMmol(b.glucose)).status, osm: H.assess('osmolarity', b.phys.fluid.osmolarity).status };

  for (let i = 0; i < n; i++) {
    stepEndocrine(b, s, dt, cfg);
    for (const e of stepFluid(b.phys, { hydration: b.hydration, asleep: s.asleep }, dt)) {
      if (e === 'bladder-full' && !s.asleep) {
        urinate(b.phys);
        H.addCause(b, { at: now, from: '膀胱满了', to: 'activity', text: '去了趟厕所' });
      }
    }
    stepAutonomic(b.phys, { cortisol: b.nt.cortisol, norepinephrine: b.nt.norepinephrine, asleep: s.asleep, stress: b.phys.psych.stress, temp: b.temp }, dt);
    reflex.stepReflex(b.phys, dt);
    lymph.stepLymph(b.phys, { immunity: b.immunity, fever: !!b.fever }, dt);
    psyche.stepPsyche(b, s, padOf(b, s), dt, now);
  }

  for (const e of events) {
    if (e.type === 'woken') reflex.fire(b.phys, 'startle', now);
  }
  // 困意上来时打个哈欠，只在变困的那一刻
  const r = b.phys.reflex;
  if (b.nt.melatonin > 60 && !r.sleepy) { r.sleepy = true; reflex.fire(b.phys, 'yawn', now); }
  else if (b.nt.melatonin < 50) r.sleepy = false;

  const glucose = H.assess('glucose', H.glucoseMmol(b.glucose)).status;
  if (glucose === 'low' && before.glucose !== 'low') H.addCause(b, { at: now, from: '空腹太久', to: 'glucose', text: '肝糖原用完，血糖下降' });
  const osm = H.assess('osmolarity', b.phys.fluid.osmolarity).status;
  if (osm === 'high' && before.osm !== 'high') H.addCause(b, { at: now, from: '缺水', to: 'osmolarity', text: '缺水，渗透压升高' });

  const states = behavior.activeStates(b, s, padOf(b, s));
  const activity = s.asleep ? null : behavior.activityFor(states);
  if (activity) {
    s.activity = activity;
    H.addCause(b, { at: now, from: states[0], to: 'activity', text: activity });
  }
}

module.exports = { step, metabolicRate, HORMONES, H, behavior, lymph, reflex };
