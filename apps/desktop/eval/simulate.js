// 驱力行为模拟：把 7 天压缩到几秒，检查作息、吃饭、想法分布和主动找人的克制（设计文档“驱力行为”）。
//
// 用法：node eval/simulate.js [天数] [--strict]
// 严格模式下会检查：安静时段 0 次主动、每天不超过上限、所有数值不越界。

const life = require('../src/main/life');
const bodyLib = require('../src/main/body');
const drives = require('../src/main/drives');
const persona = require('../src/main/persona-model');
const config = require('../src/main/config');

const DAYS = Math.max(1, Number(process.argv[2]) || 7);
const STRICT = process.argv.includes('--strict');
const STEP_MIN = 5;
const start = new Date(2026, 10, 5, 0, 0, 0, 0).getTime();

let now = start;
let state = life.initialState(now);
let body = bodyLib.initialBody(now);
const profile = persona.initialProfile({ now: start });

const meals = {};
const thoughts = {};
const sendsByDay = {};
const badges = { quiet: 0, sleep: 0, dreams: 0 };
let sends = 0;
let sleeps = 0;
const range = { satiety: [100, 0], energy: [100, 0], social: [100, 0] };

const keyOf = (t) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

for (let i = 0; i < (DAYS * 24 * 60) / STEP_MIN; i++) {
  now += STEP_MIN * 60000;
  const tick = life.tick(state, now);
  state = tick.state;
  for (const e of tick.events) {
    if (e.type === 'meal') meals[e.meal] = (meals[e.meal] || 0) + 1;
    if (e.type === 'sleep') {
      sleeps += 1;
      const r = life.proactiveReason(state, now);
      if (r && new Date(now).getHours() >= 23) badges.sleep += 1;
    }
  }
  const step = bodyLib.stepBody(body, state, STEP_MIN, now, tick.events);
  body = step.body;
  state = step.life;

  const ev = drives.evaluate({ body, state, profile, now });
  drives.syncBody(body, ev);
  const thought = drives.think({ body, state, profile, now });
  if (thought) thoughts[thought.drive] = (thoughts[thought.drive] || 0) + 1;

  for (const k of ['satiety', 'energy', 'social']) {
    range[k][0] = Math.min(range[k][0], state[k]);
    range[k][1] = Math.max(range[k][1], state[k]);
  }

  const reason = life.proactiveReason(state, now);
  if (reason && !state.asleep && ev.top.id === 'social' && ev.top.value >= config.get().drives.threshold) {
    const hour = new Date(now).getHours();
    if (hour >= 23 || hour < 9) badges.quiet += 1; // 不该发生
    const day = keyOf(now);
    sendsByDay[day] = (sendsByDay[day] || 0) + 1;
    sends += 1;
    state = life.markProactive(state, now);
  }
}

const fmt = (obj) => Object.entries(obj).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
console.log(`\n驱力模拟 · ${DAYS} 天 · 每 ${STEP_MIN} 分钟一步`);
console.log(`吃饭      ${fmt(meals)}`);
console.log(`睡觉      ${sleeps} 次`);
console.log(`想法      ${fmt(thoughts)}`);
console.log(`主动找人  ${sends} 次 · ${fmt(sendsByDay)}`);
console.log(`数值范围  饱腹 ${range.satiety[0].toFixed(0)}–${range.satiety[1].toFixed(0)} · 精力 ${range.energy[0].toFixed(0)}–${range.energy[1].toFixed(0)} · 陪伴 ${range.social[0].toFixed(0)}–${range.social[1].toFixed(0)}`);

const dailyLimit = config.get().drives.restraint.dailyProactiveLimit;
const overLimit = Object.entries(sendsByDay).filter(([, n]) => n > dailyLimit);
const badRange = Object.entries(range).filter(([, [lo, hi]]) => lo < 0 || hi > 100 || Number.isNaN(lo) || Number.isNaN(hi));
const thoughtDrives = Object.values(thoughts).filter((n) => n > 0).length;
const ok = badges.quiet === 0 && overLimit.length === 0 && badRange.length === 0 && sleeps >= DAYS * 0.8 && thoughtDrives >= 2 && Object.keys(meals).length >= 3;

console.log(`检查      安静时段主动 ${badges.quiet} 次 · 超每日上限 ${overLimit.length} 天 · 数值越界 ${badRange.length} 项 · 想法覆盖 ${thoughtDrives} 种驱力 · ${ok ? '通过' : '未通过'}`);
if (STRICT && !ok) process.exit(1);
