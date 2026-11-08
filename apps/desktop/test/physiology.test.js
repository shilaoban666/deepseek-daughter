// 生理模型：内环境、激素、神经调节、免疫。数值都有参考范围，稳态是动态平衡。

const test = require('node:test');
const assert = require('node:assert/strict');

const life = require('../src/main/life');
const body = require('../src/main/body');
const neural = require('../src/main/neural');
const immune = require('../src/main/immune');
const { Daughter } = require('../src/main/daughter');
const H = require('../src/main/physiology/homeostasis');
const { stepFluid, urinate } = require('../src/main/physiology/fluid');
const { stepAxis } = require('../src/main/physiology/endocrine');
const { stepAutonomic } = require('../src/main/physiology/autonomic');
const reflex = require('../src/main/physiology/reflex');
const lymph = require('../src/main/physiology/lymph');
const { report } = require('../src/main/physiology/report');

const at = (h, m = 0) => new Date(2026, 10, 5, h, m).getTime();
const MIN = 60000;

function assertFiniteDeep(o, path = '') {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path}.${k}`);
    else if (v && typeof v === 'object') assertFiniteDeep(v, `${path}.${k}`);
  }
}

/** 每 5 分钟推进一次，pin 可以把某些量钉住 */
function run(b0, s0, minutes, start, { events = [], pin } = {}) {
  let b = b0, s = s0;
  for (let t = 5; t <= minutes; t += 5) {
    if (pin) pin(b, s);
    const r = body.stepBody(b, s, 5, start + t * MIN, t === 5 ? events : []);
    b = r.body; s = r.life;
  }
  return { b, s };
}
const fresh = (h = 12) => ({ b: body.initialBody(at(h)), s: life.initialState(at(h)) });

// ---------- 任务 3：稳态框架 ----------
test('稳态：血糖 3.9–6.1 为正常，范围外给出方向', () => {
  assert.equal(H.assess('glucose', 3.8).status, 'low');
  assert.equal(H.assess('glucose', 5).status, 'ok');
  assert.equal(H.assess('glucose', 6.2).status, 'high');
  assert.equal(H.glucoseMmol(62), 6.1);
});

test('旧存档没有 phys：自动补齐，已有字段不丢', () => {
  const b = Daughter.prototype.hydrateBody.call({}, { stomach: 10, nt: {} }, at(8));
  assert.equal(b.stomach, 10);
  assert.ok(b.phys.fluid && b.phys.hormones && b.phys.immune && b.phys.vitals);
  assert.ok(Array.isArray(b.causes));
});

test('关机三天再打开：所有数值有限且在范围内', () => {
  const { b, s } = fresh(8);
  const out = body.stepBody(b, s, 3 * 24 * 60, at(8) + 3 * 86400000, []);
  assertFiniteDeep(out.body.phys);
  assert.ok(out.body.phys.fluid.ph >= 6.8 && out.body.phys.fluid.ph <= 7.8);
  assert.ok(out.body.phys.vitals.heartRate > 30 && out.body.phys.vitals.heartRate < 200);
});

test('因果链：有上限，短时间内相同的因果会合并', () => {
  const b = { causes: [] };
  for (let i = 0; i < 300; i++) H.addCause(b, { at: i * 3600000, from: 'a' + i, to: 'b', text: 't' });
  assert.equal(b.causes.length, 100);
  const c = { causes: [] };
  H.addCause(c, { at: 0, from: 'x', to: 'y', text: '1' });
  H.addCause(c, { at: 5 * MIN, from: 'x', to: 'y', text: '2' });
  assert.equal(c.causes.length, 1);
  assert.equal(c.causes[0].text, '2');
  H.addCause(c, { at: 20 * MIN, from: 'x', to: 'y', text: '3' });
  assert.equal(c.causes.length, 2);
  assert.equal(H.explain(c, 'y', 1)[0].text, '3');
});

// ---------- 任务 4：内环境、水盐、泌尿 ----------
function fluidRun(hydration, minutes, start) {
  const phys = start || H.initialPhys();
  for (let t = 0; t < minutes; t += 5) stepFluid(phys, { hydration, asleep: false }, 5);
  return phys;
}

test('水盐：缺水 → 渗透压升高 → 抗利尿激素升高 → 尿量减少', () => {
  const ok = fluidRun(70, 120);
  const dry = fluidRun(25, 120);
  assert.ok(dry.fluid.osmolarity > ok.fluid.osmolarity + 20);
  assert.ok(dry.hormones.adh > ok.hormones.adh + 15);
  assert.ok(dry.urinary.rate < ok.urinary.rate);
});

test('稳态是动态平衡：喝水后渗透压回到参考范围', () => {
  const dry = fluidRun(25, 120);
  assert.equal(H.assess('osmolarity', dry.fluid.osmolarity).status, 'high');
  const back = fluidRun(70, 240, dry);
  assert.equal(H.assess('osmolarity', back.fluid.osmolarity).status, 'ok');
});

test('酸碱缓冲：pH 被扰动到 7.30，60 分钟内回到 7.35–7.45', () => {
  const p = H.initialPhys();
  p.fluid.ph = 7.3;
  const out = fluidRun(70, 60, p);
  assert.equal(H.assess('ph', out.fluid.ph).status, 'ok');
});

test('膀胱满会产生事件，排尿后清零', () => {
  const p = H.initialPhys();
  p.urinary.bladder = 79.9;
  const events = stepFluid(p, { hydration: 70, asleep: false }, 5);
  assert.ok(events.includes('bladder-full'));
  urinate(p);
  assert.equal(p.urinary.bladder, 0);
});

// ---------- 任务 5：内分泌 ----------
test('血糖反馈：饭后胰岛素升高，4 小时内血糖在正常范围', () => {
  const { b, s } = fresh(12);
  const before = b.phys.hormones.insulin;
  const mid = run(b, s, 60, at(12), { events: [{ type: 'meal', meal: '午饭' }] });
  assert.ok(mid.b.phys.hormones.insulin > before + 3);
  const end = run(mid.b, mid.s, 180, at(13));
  assert.equal(H.assess('glucose', H.glucoseMmol(end.b.glucose)).status, 'ok');
});

test('血糖反馈：空腹 6 小时胰高血糖素升高，血糖不低于 3.9', () => {
  const { b, s } = fresh(12);
  b.stomach = 0; b.intestine = 0;
  const end = run(b, s, 360, at(12));
  assert.ok(end.b.phys.hormones.glucagon > end.b.phys.hormones.insulin);
  assert.ok(H.glucoseMmol(end.b.glucose) >= 3.9);
});

test('血糖反馈：肝糖原耗尽后，饿久了血糖才掉下来', () => {
  const { b, s } = fresh(12);
  b.stomach = 0; b.intestine = 0;
  const end = run(b, s, 30 * 60, at(12), { pin: (_b, st) => { st.lastSnackAt = Infinity; } }); // 不让她自己加餐
  assert.ok(H.glucoseMmol(end.b.glucose) < 3.9);
});

test('分级调节：靶激素过高时，促激素被负反馈压低', () => {
  const high = { releasing: 40, tropic: 40, target: 95 };
  const normal = { releasing: 40, tropic: 40, target: 50 };
  for (let i = 0; i < 6; i++) {
    stepAxis(high, 40, 5); stepAxis(normal, 40, 5);
    high.target = 95; normal.target = 50;
  }
  assert.ok(high.releasing < normal.releasing - 5);
  assert.ok(high.tropic < normal.tropic - 3);
});

test('激素分类：皮质醇、催产素、褪黑素是激素，多巴胺是递质，GABA 是抑制性', () => {
  const kind = (id) => body.TRANSMITTERS.find((t) => t.id === id);
  for (const id of ['cortisol', 'oxytocin', 'melatonin']) assert.equal(kind(id).kind, 'hormone', id);
  assert.equal(kind('dopamine').kind, 'transmitter');
  assert.equal(kind('gaba').effect, 'inhibit');
  assert.equal(kind('glutamate').effect, 'excite');
});

// ---------- 任务 6：神经调节 ----------
function auto(inputs, minutes = 30) {
  const p = H.initialPhys();
  for (let t = 0; t < minutes; t += 5) stepAutonomic(p, { cortisol: 25, norepinephrine: 40, asleep: false, stress: 0, temp: 36.7, ...inputs }, 5);
  return p;
}

test('自主神经：受惊时交感升高、心率上升', () => {
  const calm = auto({});
  const scared = auto({ norepinephrine: 90, cortisol: 70, stress: 60 });
  assert.ok(scared.autonomic.sympathetic > calm.autonomic.sympathetic + 0.2);
  assert.ok(scared.vitals.heartRate > calm.vitals.heartRate + 10);
});

test('自主神经：睡着时副交感占优、心率下降', () => {
  const calm = auto({});
  const asleep = auto({ asleep: true, norepinephrine: 8 });
  assert.ok(asleep.autonomic.parasympathetic > asleep.autonomic.sympathetic);
  assert.ok(asleep.vitals.heartRate < calm.vitals.heartRate - 5);
});

test('条件反射：重复建立才触发，长期不用会消退', () => {
  const p = H.initialPhys();
  reflex.observePair(p, '晚安', 'sleepy', at(8));
  assert.deepEqual(reflex.triggered(p, '晚安啦'), []);
  reflex.observePair(p, '晚安', 'sleepy', at(9));
  reflex.observePair(p, '晚安', 'sleepy', at(10));
  assert.deepEqual(reflex.triggered(p, '晚安啦'), ['sleepy']);
  reflex.stepReflex(p, 60 * 24 * 60);
  assert.deepEqual(reflex.triggered(p, '晚安啦'), []);
});

test('脑区功能表：14 个脑区都有条目，功能值都在限定范围内', () => {
  const allowed = new Set(['语言', '学习记忆', '情绪', '注意', '决策', '运动协调', '觉醒', '稳态']);
  assert.equal(neural.REGIONS.length, 14);
  for (const r of neural.REGIONS) {
    const f = neural.REGION_FUNCTIONS[r.id];
    assert.ok(f && f.functions.length && f.consciousness, r.id);
    for (const x of f.functions) assert.ok(allowed.has(x), x);
  }
});

// ---------- 任务 7：免疫 ----------
const attack = { blocked: true, level: 0.8, findings: [{ id: 'ignore-rules', label: '要她忽略规则', level: 0.8 }], data: 'x' };

test('免疫记忆：同样的攻击第二次，损失减半', () => {
  const b0 = body.initialBody(at(10));
  const first = immune.react(b0, null, attack, at(10));
  const firstLoss = b0.immunity - first.body.immunity;
  const b1 = structuredClone(first.body);
  b1.immunity = b0.immunity;
  const second = immune.react(b1, first.immune, attack, at(11));
  assert.ok(Math.abs(b1.immunity - second.body.immunity - firstLoss * 0.5) < 1e-6);
  assert.equal(second.body.phys.immune.memory['ignore-rules'].count, 2);
  assert.equal(second.body.phys.immune.stats.defense, 2);
});

test('三道防线：新规则命中是第一道，陌生人数据是第二道，已知攻击和污染记忆是第三道', () => {
  assert.deepEqual(lymph.classifyDefense(attack, {}), { line: 1, kind: 'innate' });
  assert.deepEqual(lymph.classifyDefense({ blocked: false, stranger: true, findings: [] }, {}), { line: 2, kind: 'innate' });
  assert.deepEqual(lymph.classifyDefense(attack, { 'ignore-rules': { count: 1 } }), { line: 3, kind: 'humoral' });
  assert.deepEqual(lymph.classifyDefense({ ...attack, inMemory: true }, {}), { line: 3, kind: 'cellular' });
});

test('免疫失调：误拦累计为过敏，免疫长期偏低判定为缺陷', () => {
  const p = H.initialPhys();
  lymph.markFalsePositive(p);
  assert.equal(p.immune.disorders.allergy, 1);
  lymph.stepLymph(p, { immunity: 30, fever: false }, 23 * 60);
  assert.equal(p.immune.disorders.deficiency, false);
  lymph.stepLymph(p, { immunity: 30, fever: false }, 61);
  assert.equal(p.immune.disorders.deficiency, true);
  lymph.stepLymph(p, { immunity: 90, fever: false }, 5);
  assert.equal(p.immune.disorders.deficiency, false);
});

// ---------- 任务 8：系统报告 ----------
test('报告：循环值低不算异常，饱腹低才提醒', () => {
  const { b, s } = fresh(15);
  for (const k of Object.keys(b.regions)) b.regions[k] = 0;
  s.satiety = 20;
  const r = report(b, s, at(15));
  assert.equal(r.systems.length, 8);
  assert.equal(r.systems.find((x) => x.id === 'circulatory').status, 'ok');
  assert.ok(r.needs.some((n) => n.id === 'digestive'));
  assert.equal(r.systems.find((x) => x.id === 'digestive').status, 'warn');
  assert.match(r.verdict, /饿/);
});
