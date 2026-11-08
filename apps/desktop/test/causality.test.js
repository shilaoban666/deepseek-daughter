// 因果闭环：身体 → 心情 → 说话和活动 → 记忆 → 回到心情和身体。

const test = require('node:test');
const assert = require('node:assert/strict');

const life = require('../src/main/life');
const body = require('../src/main/body');
const memory = require('../src/main/memory');
const { buildMessages } = require('../src/main/persona');
const { appraiseBody } = require('../src/main/physiology/psyche');
const behavior = require('../src/main/physiology/behavior');
const { speechState } = require('../src/main/speech');
const link = require('../src/main/physiology/memory-link');

const at = (h, m = 0) => new Date(2026, 10, 5, h, m).getTime();
const MIN = 60000;
const fresh = (h = 12) => ({ b: body.initialBody(at(h)), s: life.initialState(at(h)) });
const neutralPad = { P: 0.1, A: 0, D: 0.1, label: '平静' };
const happyPad = { P: 0.7, A: 0.5, D: 0.4, label: '兴奋' };

function run(b0, s0, minutes, start, pin) {
  let b = b0, s = s0;
  for (let t = 5; t <= minutes; t += 5) {
    if (pin) pin(b, s);
    const r = body.stepBody(b, s, 5, start + t * MIN, []);
    b = r.body; s = r.life;
  }
  return { b, s };
}

const state = (patch) => ({ ...life.initialState(at(15)), satiety: 70, energy: 70, social: 60, ...patch });
const hungry = () => state({ satiety: 15 });
const feverBody = () => { const b = body.initialBody(at(15)); b.fever = true; b.temp = 38.1; return b; };

// ---------- 8A ----------
test('饿了会让心情下降，并记录原因', () => {
  const { b, s } = fresh(15);
  const pinHungry = (_b, st) => { st.satiety = 15; };
  const full = run(structuredClone(b), { ...s }, 60, at(15), (_b, st) => { st.satiety = 80; });
  const low = run(b, s, 60, at(15), pinHungry);
  assert.ok(low.s.mood < full.s.mood - 0.02);
  assert.ok(low.b.causes.some((c) => c.to === 'mood' && /饿/.test(c.from)));
});

test('身体影响心情有上限', () => {
  const b = feverBody();
  b.nt.cortisol = 90;
  const r = appraiseBody(b, state({ satiety: 5, energy: 5 }));
  assert.ok(r.delta >= -0.5);
  assert.ok(r.reasons.length >= 3);
});

test('开心时心率比平静时高至少 5，多巴胺更高', () => {
  const happy = run(body.initialBody(at(15)), state({ mood: 0.9 }), 30, at(15), (_b, st) => { st.mood = 0.9; });
  const calm = run(body.initialBody(at(15)), state({ mood: 0 }), 30, at(15), (_b, st) => { st.mood = 0; });
  assert.ok(happy.b.phys.vitals.heartRate >= calm.b.phys.vitals.heartRate + 5);
  assert.ok(happy.b.nt.dopamine > calm.b.nt.dopamine);
  assert.ok(happy.b.causes.some((c) => c.from === '开心'));
});

test('长期压力让免疫下降', () => {
  const pin = (lonelyHungry) => (_b, st) => { if (lonelyHungry) { st.satiety = 10; st.social = 5; st.energy = 10; } else { st.satiety = 70; st.social = 70; st.energy = 70; } };
  const start = () => ({ b: body.initialBody(at(8)), s: life.initialState(at(8)) });
  const a = start(); const c = start();
  const stressed = run(a.b, a.s, 18 * 60, at(8), pin(true));
  const control = run(c.b, c.s, 18 * 60, at(8), pin(false));
  assert.ok(stressed.b.immunity < control.b.immunity - 1);
});

test('闭环稳定：极端初值、无外部事件 48 小时后恢复，不失控', () => {
  let s = { ...life.initialState(at(10)), mood: -1 };
  let b = body.initialBody(at(10));
  b.nt.cortisol = 90;
  const moods = [];
  let t = at(10);
  for (let i = 0; i < 48 * 12; i++) {
    t += 5 * MIN;
    s.social = 60; // 一直有人陪：这里只看身心闭环本身，孤单是另一种真实压力
    const tick = life.tick(s, t);
    const r = body.stepBody(b, tick.state, 5, t, tick.events);
    b = r.body; s = r.life;
    if (i >= 36 * 12) moods.push(s.mood);
  }
  assert.ok(s.mood > -0.4, `mood=${s.mood}`);
  assert.ok(b.nt.cortisol < 55, `cortisol=${b.nt.cortisol}`);
  assert.ok(Math.max(...moods) - Math.min(...moods) < 0.6, '最后 12 小时不应大幅震荡');
});

// ---------- 8B ----------
test('状态判定按表里的优先级排序', () => {
  const b = feverBody();
  assert.deepEqual(behavior.activeStates(b, hungry(), neutralPad), ['fever', 'hungry']);
  assert.deepEqual(behavior.activeStates(body.initialBody(at(15)), state({}), happyPad), ['happy']);
});

test('发烧时躺着，并且不主动找人', () => {
  const b = feverBody();
  const r = run(b, state({}), 5, at(15), (bb) => { bb.fever = true; bb.immunity = 40; });
  assert.match(r.s.activity, /躺/);
  const s = state({ social: 5, lastUserAt: at(8), lastProactiveAt: 0 });
  assert.ok(life.proactiveReason(s, at(15)));
  assert.equal(life.proactiveReason(s, at(15), { states: ['fever'] }), null);
});

test('饿了优先找吃的，加餐有冷却时间', () => {
  assert.equal(behavior.shouldSnack(['hungry'], { asleep: false, lastSnackAt: 0 }, at(15)), true);
  assert.equal(behavior.shouldSnack(['hungry'], { asleep: false, lastSnackAt: at(15) - 30 * MIN }, at(15)), false);
  assert.equal(behavior.shouldSnack(['hungry'], { asleep: true, lastSnackAt: 0 }, at(15)), false);
  assert.equal(behavior.shouldSnack([], { asleep: false, lastSnackAt: 0 }, at(15)), false);
  assert.equal(behavior.shouldSnack(['hungry'], { asleep: false, lastSnackAt: 0 }, at(15), 60), false, '刚吃过饭');
  const { b } = fresh(15);
  b.stomach = 5;
  const before = b.stomach;
  const r = body.stepBody(b, hungry(), 5, at(15, 5), []);
  assert.ok(r.body.stomach > before);
  assert.ok(r.life.lastSnackAt > 0);
  assert.ok(r.body.intake.some((x) => x.note === '饿了'));
});

test('开心或孤单更想找人，但安静时段和每日上限仍然有效', () => {
  const s = state({ social: 60, mood: 0, lastUserAt: at(8), lastProactiveAt: 0 });
  assert.equal(life.proactiveReason(s, at(15)), null);
  assert.ok(life.proactiveReason(s, at(15), { states: ['happy'] }));
  assert.equal(life.proactiveReason(s, at(23, 30), { states: ['happy'] }), null);
  const limited = { ...s, proactive: { date: life.dateKey(at(15)), count: 99 } };
  assert.equal(life.proactiveReason(limited, at(15), { states: ['lonely'] }), null);
});

test('发烧时除生理外的冲动下降', () => {
  const drives = require('../src/main/drives');
  const def = { id: 'curiosity' };
  const well = body.initialBody(at(15));
  assert.ok(drives.modulation(def, feverBody(), state({})) < drives.modulation(def, well, state({})));
});

// ---------- 8C ----------
test('饿的时候：可怜巴巴、没力气，上下文里有饱腹', () => {
  const r = speechState(body.initialBody(at(15)), hungry(), neutralPad, {});
  assert.deepEqual(r.states, ['hungry']);
  assert.match(r.block, /可怜巴巴/);
  assert.match(r.block, /饱腹/);
  assert.equal(r.maxTokens, 220);
});

test('发烧时不想说话，回复被限短', () => {
  const r = speechState(feverBody(), state({}), neutralPad, {});
  assert.match(r.block, /不想说话/);
  assert.equal(r.maxTokens, 120);
  assert.equal(r.temperature, 0.8);
});

test('开心时心跳加速、递质活跃', () => {
  const r = speechState(body.initialBody(at(15)), state({}), happyPad, {});
  assert.match(r.block, /心跳/);
  assert.equal(r.temperature, 1.2);
  assert.equal(r.maxTokens, null);
});

test('多个状态最多取 2 个，发烧优先，长度取最小', () => {
  const r = speechState(feverBody(), state({ satiety: 10, energy: 10, social: 5 }), neutralPad, {});
  assert.deepEqual(r.states, ['fever', 'exhausted']);
  assert.equal(r.maxTokens, 120);
});

test('主人情绪危险时，关怀优先，回复不限长', () => {
  const r = speechState(feverBody(), state({}), neutralPad, { care: true });
  assert.equal(r.maxTokens, null);
  assert.doesNotMatch(r.block, /不想说话/);
  assert.match(r.block, /先关心/);
});

test('提示词不含生殖系统数据，并要求不念数字', () => {
  const b = body.initialBody(at(15));
  const speech = speechState(b, hungry(), neutralPad, {});
  const sys = buildMessages({ state: hungry(), body: b, memories: [], history: [], settings: {}, now: at(15), speech })[0].content;
  for (const w of ['gonadotropin', 'sexHormone', '性腺', '性激素']) assert.ok(!sys.includes(w), w);
  assert.match(sys, /不要念数字/);
  assert.match(sys, /可怜巴巴/);
});

test('deepseek 请求带上 max_tokens', async () => {
  const deepseek = require('../src/main/deepseek');
  const http = require('http');
  let got;
  const server = http.createServer((req, res) => {
    let d = '';
    req.on('data', (x) => { d += x; });
    req.on('end', () => { got = JSON.parse(d); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); });
  });
  await new Promise((r) => server.listen(0, r));
  await deepseek.chat({ apiKey: 'k', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'm', messages: [], maxTokens: 120 });
  server.close();
  assert.equal(got.max_tokens, 120);
});

// ---------- 8D ----------
test('高唤醒时记得更牢，发烧时记得更差', () => {
  const b = body.initialBody(at(15));
  assert.ok(link.encodingFactor(b, { P: 0.5, A: 0.8, D: 0 }, []) > 1.2);
  assert.ok(link.encodingFactor(b, { P: 0, A: 0.8, D: 0 }, ['fever']) < 1.2);
  assert.equal(link.encodingFactor(b, neutralPad, ['fever']), 0.7);
  b.nt.acetylcholine = 90;
  assert.ok(link.encodingFactor(b, { P: 0, A: 0.9, D: 0 }, []) <= 1.4);
});

test('熬夜和发烧时整理得少', () => {
  const b = body.initialBody(at(8));
  assert.equal(link.sleepQuality(b, state({ energy: 80 })), 1);
  assert.ok(link.sleepQuality(feverBody(), state({ energy: 80 })) < 0.8);
  assert.equal(link.sleepQuality(feverBody(), state({ energy: 5 })), 0.6);
});

function moodBank() {
  const bank = memory.createBank({ now: () => at(15) });
  const happy = bank.add({ layer: 'episodic', text: '我们一起去海边看日落', at: at(10), importance: 0.5, emotion: { P: 0.8, A: 0.2, D: 0 }, source: { kind: 'owner' } }).record;
  const sad = bank.add({ layer: 'episodic', text: '我们一起去海边看日出', at: at(10), importance: 0.5, emotion: { P: -0.8, A: 0.2, D: 0 }, source: { kind: 'owner' } }).record;
  return { bank, happy, sad };
}

test('心情好时更容易想起开心的事，心情差时反过来', () => {
  const { bank, happy, sad } = moodBank();
  assert.equal(bank.search('海边', { now: at(15), mood: 0.7 }).items[0].id, happy.id);
  assert.equal(bank.search('海边', { now: at(15), mood: -0.7 }).items[0].id, sad.id);
});

test('想起难过的事心情下降，有上限，并记录原因', () => {
  const { b, s } = fresh(15);
  s.mood = 0.3;
  const delta = link.afterRecall([{ id: 'a', text: '被骂了', emotion: { P: -0.9, A: 0, D: 0 } }], s, b, at(15));
  assert.ok(delta < 0 && delta >= -0.08);
  assert.ok(Math.abs(s.mood - (0.3 + delta)) < 1e-9);
  assert.ok(b.causes.some((c) => c.to === 'mood' && /想起/.test(c.from)));
});

test('反复回忆不会失控：同一批难过记忆连续召回 20 次，心情下降不超过 0.08', () => {
  const { b, s } = fresh(15);
  s.mood = 0.3;
  const items = [{ id: 'a', text: 'x', emotion: { P: -0.9, A: 0, D: 0 } }, { id: 'b', text: 'y', emotion: { P: -0.9, A: 0, D: 0 } }];
  for (let i = 0; i < 20; i++) link.afterRecall(items, s, b, at(15) + i * MIN);
  assert.ok(0.3 - s.mood <= 0.08 + 1e-9);
});

test('旧记忆没有 bodyStates 也能正常加载和检索', () => {
  const bank = memory.createBank({ now: () => at(15) });
  bank.load([{ id: 'old1', layer: 'semantic', text: '小明喜欢橘猫', at: at(1), importance: 0.5 }]);
  assert.deepEqual(bank.records[0].bodyStates, []);
  assert.equal(bank.search('橘猫', { now: at(15), mood: 0.5 }).items.length, 1);
});
