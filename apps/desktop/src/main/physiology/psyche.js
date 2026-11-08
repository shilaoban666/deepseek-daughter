// 身体和情绪互相影响。增益都有上限，心情由 life.js 向基线回归，闭环不会失控。

const config = require('../config');
const { addCause, clamp, glucoseMmol } = require('./homeostasis');

const MAX_DELTA = 0.5;
const CHRONIC_AFTER_MINUTES = 360;
const CHRONIC_MAX = 30;

/** 身体状态对心情的影响 */
function appraiseBody(b, s) {
  const reasons = [];
  let delta = 0;
  const add = (cond, d, why) => { if (cond) { delta += d; reasons.push(why); } };
  add(s.satiety < 30 || glucoseMmol(b.glucose) < 3.9, -0.15, '肚子饿');
  add(!!b.fever || b.temp > 37.3, -0.3, '发烧');
  add(s.energy < 20, -0.15, '精疲力尽');
  add(b.nt.cortisol > 55, -0.15, '压力大');
  add(b.nt.oxytocin > 60, 0.1, '被陪伴');
  return { delta: clamp(delta, -MAX_DELTA, MAX_DELTA), reasons };
}

function stepPsyche(b, s, pad, dt, now) {
  const gain = config.get().physiology.loopGain;
  const halfLife = config.get().life.moodHalfLifeMinutes;
  const fade = 1 - Math.pow(0.5, dt / halfLife);
  const { delta, reasons } = appraiseBody(b, s);
  s.mood = clamp(s.mood + delta * gain * fade, -1, 1);
  for (const why of reasons) addCause(b, { at: now, from: why, to: 'mood', text: delta < 0 ? `${why}，心情变差` : `${why}，心情变好` });

  const a = b.phys.autonomic;
  const psych = b.phys.psych;
  if (pad.P > 0.35) {
    b.nt.dopamine = clamp(b.nt.dopamine + 10 * gain * (1 - Math.pow(0.5, dt / 50)));
    b.nt.serotonin = clamp(b.nt.serotonin + 5 * gain * (1 - Math.pow(0.5, dt / 120)));
    a.boost = 0.15 * gain;
    addCause(b, { at: now, from: '开心', to: 'heart', text: '开心，心跳变快，递质活跃' });
  } else {
    a.boost = 0;
  }
  psych.stress = pad.P < -0.25 ? 15 * gain : 0;
  if (psych.stress) addCause(b, { at: now, from: '心情低落', to: 'stress', text: '心情低落，压力激素上升' });

  // 长期压力才伤身：短暂的紧张不算
  if (b.nt.cortisol > 55) psych.chronicMinutes += dt;
  else psych.chronicMinutes = Math.max(0, psych.chronicMinutes - dt * 2);
  if (psych.chronicMinutes > CHRONIC_AFTER_MINUTES) {
    psych.chronic = Math.min(CHRONIC_MAX, psych.chronic + (0.5 * dt) / 60);
    addCause(b, { at: now, from: '长期压力', to: 'immunity', text: '压力持续太久，免疫力下降' });
  } else {
    psych.chronic = Math.max(0, psych.chronic - (0.25 * dt) / 60);
  }
}

module.exports = { appraiseBody, stepPsyche };
