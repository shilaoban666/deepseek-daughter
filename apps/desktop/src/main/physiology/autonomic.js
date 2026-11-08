// 自主神经：交感和副交感作用相反，决定心率和呼吸。

const { approach, clamp } = require('./homeostasis');

/**
 * @param {object} phys
 * @param {{cortisol:number, norepinephrine:number, asleep:boolean, stress:number, temp:number}} inputs
 */
function stepAutonomic(phys, { cortisol, norepinephrine, asleep, stress, temp }, dt) {
  const a = phys.autonomic;
  const v = phys.vitals;
  const drive = clamp(0.2 + norepinephrine / 250 + cortisol / 400 + stress / 200 + (a.boost || 0), 0, 1) * (asleep ? 0.5 : 1);
  a.sympathetic = approach(a.sympathetic, drive, dt, 5);
  a.parasympathetic = approach(a.parasympathetic, clamp(0.85 - drive * 0.7 + (asleep ? 0.2 : 0), 0, 1), dt, 5);
  const fever = Math.max(0, temp - 37) * 10;
  v.heartRate = approach(v.heartRate, clamp(72 + (a.sympathetic - 0.42) * 35 - (a.parasympathetic - 0.55) * 10 + fever, 45, 170), dt, 3);
  v.co2 = approach(v.co2, asleep ? 43 : 40, dt, 10);
  v.respRate = approach(v.respRate, clamp(15 + (a.sympathetic - 0.42) * 10 + (v.co2 - 40) * 0.8 + fever * 0.3, 8, 40), dt, 3);
}

module.exports = { stepAutonomic };
