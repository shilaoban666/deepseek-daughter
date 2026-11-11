// 鲸鱼娘：状态机、选片、节日（执行计划阶段 C）

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const life = require('../src/main/life');
const body = require('../src/main/body');
const behavior = require('../src/main/physiology/behavior');
const { report } = require('../src/main/physiology/report');

const load = (f) => import(`../src/renderer/pet/${f}`);
const skinDir = process.env.DFY_PET_DIR || path.join(__dirname, '..', 'assets', 'pet', 'whale-girl');
// 商用时整个 whale-girl/ 目录会被删掉：用到映射表的测试跳过，纯逻辑的测试照跑
const petJson = path.join(__dirname, '..', 'assets', 'pet', 'whale-girl', 'pet.json');
const havePet = fs.existsSync(petJson);
const manifest = havePet ? JSON.parse(fs.readFileSync(petJson, 'utf8')) : null;
const NO_PET = '没有鲸鱼娘素材（商用时删掉了）';
const clipsDir = path.join(skinDir, 'clips');
const haveClips = fs.existsSync(clipsDir);

const NOW = new Date(2026, 10, 10, 14, 0).getTime(); // 普通的周二下午，不是节日
const MIN = 60000;

/** 用真实的身体模型造一个快照，patch 里改想要的字段 */
function snap(patch = {}, now = NOW) {
  const b = body.initialBody(now);
  const s = { ...life.initialState(now), lastTick: now, asleep: false, satiety: 70, energy: 70, social: 60, activity: '发呆' };
  if (patch.body) patch.body(b, s);
  if (patch.state) Object.assign(s, patch.state);
  const pad = body.pad(b, s);
  return {
    state: s,
    body: b,
    mind: { thinking: patch.thinking ?? body.thinkingState(b, s), pad: { ...pad, label: patch.mood ?? pad.label }, report: { states: patch.states ?? report(b, s, now).states } },
  };
}

test('角色：睡着时优先级最高', async () => {
  const { derive, initial } = await load('pet-state.mjs');
  const d = derive(snap({ state: { asleep: true }, states: ['fever', 'hungry'] }), initial(), NOW);
  assert.equal(d.action, 'sleep');
});

test('角色：8 种身体状态各有对应的动作', async () => {
  const { derive, initial } = await load('pet-state.mjs');
  const expect = { fever: 'sick', exhausted: 'drowsy', hungry: 'hungry', thirsty: 'drink', stressed: 'fidget', low: 'idle', lonely: 'wait', happy: 'roll' };
  for (const st of behavior.STATES) {
    const d = derive(snap({ states: [st.id], state: { activity: st.activity } }), initial(), NOW);
    assert.equal(d.action, expect[st.id], `${st.id}（${st.activity}）`);
  }
});

test('角色：作息里出现的每一种活动文字都认得', async () => {
  const { actionForActivity, ACTIONS } = await load('pet-state.mjs');
  const texts = new Set(behavior.STATES.map((x) => x.activity));
  for (let h = 0; h < 24; h++) {
    for (const satiety of [10, 80]) for (const energy of [10, 80]) {
      const at = new Date(2026, 10, 10, h, 30).getTime();
      const s = { ...life.initialState(at), lastTick: at - MIN, satiety, energy, asleep: false };
      texts.add(life.tick(s, at).state.activity);
    }
  }
  const idleOk = new Set(['发呆', '窝着发呆']);
  for (const t of texts) {
    const a = actionForActivity(t);
    assert.ok(ACTIONS.includes(a), t);
    if (!idleOk.has(t)) assert.notEqual(a, 'idle', `活动“${t}”没有配动作`);
  }
});

test('角色：三餐和下午茶各自认得', async () => {
  const { derive, initial } = await load('pet-state.mjs');
  for (const note of ['早饭', '午饭', '晚饭', '下午茶', '饿了']) {
    const d = derive(snap({ body: (b) => { b.intake = [{ at: NOW - MIN, kind: '吃', item: '布丁', note }]; } }), initial(), NOW);
    assert.equal(d.action, 'eat', note);
    assert.equal(d.meal, note);
  }
  const old = derive(snap({ body: (b) => { b.intake = [{ at: NOW - 10 * MIN, kind: '吃', item: '布丁', note: '午饭' }]; } }), initial(), NOW);
  assert.notEqual(old.action, 'eat', '10 分钟前吃的不算正在吃');
});

test('角色：回复的过程是 思考 → 说话 → 庆祝 → 回到原来的动作', async () => {
  const { derive, initial, reduce } = await load('pet-state.mjs');
  const sn = snap();
  let m = initial();
  m = reduce(m, { type: 'reply-start', id: 'a', at: NOW });
  assert.equal(derive(sn, m, NOW + 100).action, 'think');
  m = reduce(m, { type: 'reply-delta', id: 'a', at: NOW + 500 });
  assert.equal(derive(sn, m, NOW + 600).action, 'talk');
  m = reduce(m, { type: 'reply-end', id: 'a', at: NOW + 2000 });
  const d = derive(sn, m, NOW + 2100);
  assert.equal(d.action, 'idle');
  assert.equal(d.reaction, 'done');
  m = reduce(m, { type: 'reaction-done' });
  assert.equal(derive(sn, m, NOW + 4000).reaction, null);
});

test('角色：回复出错时播失败反应，不会卡在思考', async () => {
  const { derive, initial, reduce } = await load('pet-state.mjs');
  const sn = snap();
  let m = reduce(initial(), { type: 'reply-start', id: 'a', at: NOW });
  assert.equal(derive(sn, m, NOW + 31000).action, 'idle', '30 秒没动静就不算在思考了');
  m = reduce(m, { type: 'reply-end', id: 'a', at: NOW + 1000, error: '连不上' });
  assert.equal(derive(sn, m, NOW + 1100).reaction, 'fail');
});

test('角色：一次性反应排队播放，最多攒 2 个', async () => {
  const { initial, reduce } = await load('pet-state.mjs');
  let m = initial();
  for (const type of ['poke', 'proactive', 'poke', 'wallet', 'hold']) m = reduce(m, { type, at: NOW });
  assert.deepEqual(m.pending.map((x) => x.name), ['wallet', 'hold']);
});

test('角色：隔了 3 小时再来消息会挥手，刚聊过不会', async () => {
  const { initial, reduce } = await load('pet-state.mjs');
  let m = reduce(initial(), { type: 'vitals', at: NOW, events: [{ type: 'user' }] });
  assert.equal(m.pending.length, 0, '第一次来消息不挥手（不知道上次是什么时候）');
  m = reduce(m, { type: 'vitals', at: NOW + 10 * MIN, events: [{ type: 'user' }] });
  assert.equal(m.pending.length, 0);
  m = reduce(m, { type: 'vitals', at: NOW + 4 * 60 * MIN, events: [{ type: 'user' }] });
  assert.deepEqual(m.pending.map((x) => x.name), ['greet']);
});

test('角色：被夸害羞、被凶生气', async () => {
  const { initial, reduce } = await load('pet-state.mjs');
  assert.equal(reduce(initial(), { type: 'vitals', at: NOW, events: [{ type: 'user', intent: { praise: true } }] }).pending[0].name, 'blush');
  assert.equal(reduce(initial(), { type: 'vitals', at: NOW, events: [{ type: 'user', intent: { criticism: true } }] }).pending[0].name, 'pout');
});

test('角色：睡着时点她只会惊醒一下', async () => {
  const { derive, initial, reduce } = await load('pet-state.mjs');
  const m = reduce(initial(), { type: 'poke', at: NOW });
  const d = derive(snap({ state: { asleep: true } }), m, NOW);
  assert.equal(d.action, 'sleep');
  assert.equal(d.reaction, 'startle');
});

test('角色：余额换档才播钱包动画，同一档不重复播', async () => {
  const { initial, reduce, balanceTier } = await load('pet-state.mjs');
  assert.deepEqual([0.5, 1, 4.9, 5, 12, 20, 49, 50, 300].map((y) => balanceTier(y)), [0, 1, 1, 2, 3, 4, 4, 5, 5]);
  let m = reduce(initial(), { type: 'balance', yuan: 42, at: NOW });
  assert.equal(m.pending.length, 0, '第一次知道余额只记下档位');
  m = reduce(m, { type: 'balance', yuan: 30, at: NOW });
  assert.equal(m.pending.length, 0, '还在同一档');
  m = reduce(m, { type: 'balance', yuan: 8, at: NOW });
  assert.deepEqual(m.pending.map((x) => x.name), ['wallet']);
});

test('角色：陪伴感低时加爱心图标，发烧时色调偏红，睡着时变暗', { skip: havePet ? false : NO_PET }, async () => {
  const { derive, initial } = await load('pet-state.mjs');
  const { decorations } = await load('pet-director.mjs');
  const lonely = decorations(manifest, derive(snap({ state: { social: 10 }, states: [] }), initial(), NOW));
  assert.ok(lonely.icons.includes('heart'));
  const sick = decorations(manifest, derive(snap({ states: ['fever'] }), initial(), NOW));
  assert.equal(sick.tint, 'fever');
  assert.ok(sick.icons.includes('icepack'));
  const asleep = decorations(manifest, derive(snap({ state: { asleep: true, social: 10 } }), initial(), NOW));
  assert.equal(asleep.tint, 'dim');
  assert.ok(!asleep.icons.includes('heart'), '睡着时不显示想你');
});

// ---------- 选片 ----------

test('选片：映射表引用的每段动画文件都存在', { skip: haveClips && havePet ? false : NO_PET }, async () => {
  const { referencedClips } = await load('pet-director.mjs');
  const missing = referencedClips(manifest).filter((c) => !fs.existsSync(path.join(clipsDir, `${c}.webm`)));
  assert.deepEqual(missing, []);
});

test('选片：素材里的每一段动画都被用上了', { skip: haveClips && havePet ? false : NO_PET }, async () => {
  const { referencedClips } = await load('pet-director.mjs');
  const used = new Set(referencedClips(manifest));
  const unused = fs.readdirSync(clipsDir).filter((f) => f.endsWith('.webm')).map((f) => f.slice(0, -5)).filter((c) => !used.has(c));
  assert.deepEqual(unused, []);
});

test('选片：右键菜单能点到全部动画，并且没有写错名字', { skip: havePet ? false : NO_PET }, async () => {
  const { referencedClips, menuClips } = await load('pet-director.mjs');
  const menu = menuClips(manifest);
  assert.equal(new Set(menu).size, menu.length, '菜单里有重复');
  assert.deepEqual([...new Set(referencedClips(manifest))].filter((c) => !menu.includes(c)), []);
  if (haveClips) assert.deepEqual(menu.filter((c) => !fs.existsSync(path.join(clipsDir, `${c}.webm`))), []);
});

test('选片：15 个动作、13 个反应、8 种情绪标签在映射表里都有', { skip: havePet ? false : NO_PET }, async () => {
  const { ACTIONS, REACTIONS } = await load('pet-state.mjs');
  for (const a of ACTIONS) {
    if (['sleep', 'eat', 'idle'].includes(a)) continue; // 这三个有专门的表
    assert.ok(manifest.actions[a]?.length, a);
  }
  for (const r of REACTIONS) assert.ok(r === 'wallet' ? manifest.balance.clips.length === 6 : manifest.reactions[r], r);
  for (const mood of ['兴奋', '开心', '期待', '平静', '无聊', '有点闷', '焦虑', '委屈']) assert.ok(manifest.moods[mood]?.clips.length, mood);
});

test('选片：早饭播吃早餐，纪念日那天吃长寿面', { skip: havePet ? false : NO_PET }, async () => {
  const { nextClip } = await load('pet-director.mjs');
  const rnd = () => 0.3;
  assert.equal(nextClip(manifest, { action: 'eat', meal: '早饭', mood: '平静' }, { now: NOW, rnd }).clip, '吃早餐');
  assert.equal(nextClip(manifest, { action: 'eat', meal: '午饭', mood: '平静' }, { now: NOW, rnd, anniversaryToday: true }).clip, '吃长寿面');
});

test('选片：睡觉分入睡、循环、起来三段', { skip: havePet ? false : NO_PET }, async () => {
  const { nextClip } = await load('pet-director.mjs');
  const d = { action: 'sleep', mood: '平静' };
  assert.equal(nextClip(manifest, d, { now: NOW, sleepPhase: 'start' }).clip, '睡觉-开始');
  assert.equal(nextClip(manifest, d, { now: NOW }).clip, '睡觉-循环');
  assert.equal(nextClip(manifest, d, { now: NOW, sleepPhase: 'end' }).clip, '睡觉-起来');
});

/** 固定种子的随机数，测试结果可重复 */
function seeded(seed = 7) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

test('选片：节日当天时节动画的比重变大', { skip: havePet ? false : NO_PET }, async () => {
  const { nextClip } = await load('pet-director.mjs');
  const count = (now) => {
    const rnd = seeded();
    let n = 0;
    for (let i = 0; i < 2000; i++) if (nextClip(manifest, { action: 'idle', mood: '平静' }, { now, rnd }).source === '闲时-时节') n++;
    return n / 2000;
  };
  const midAutumn = new Date(2026, 8, 25, 15).getTime(); // 2026 年中秋
  const fest = count(midAutumn);
  assert.ok(fest > 0.35 && fest < 0.45, `节日当天时节占 ${fest}`);
  const plain = count(new Date(2026, 4, 12, 15).getTime()); // 5 月中旬：不是节日，也没有季节动画
  assert.equal(plain, 0, '平时、而且这个月没有季节动画，就不抽时节');
});

test('选片：不会连着播同一段', { skip: havePet ? false : NO_PET }, async () => {
  const { nextClip } = await load('pet-director.mjs');
  const rnd = seeded(3);
  let last = null;
  for (let i = 0; i < 300; i++) {
    const { clip } = nextClip(manifest, { action: 'roll', mood: '开心' }, { now: NOW, rnd, recent: last ? [last] : [] });
    assert.notEqual(clip, last);
    last = clip;
  }
});

test('选片：季节限定的动画只在对应月份出现', { skip: havePet ? false : NO_PET }, async () => {
  const { nextClip } = await load('pet-director.mjs');
  const seen = (now, action = 'idle', meal) => {
    const rnd = seeded(11);
    const out = new Set();
    for (let i = 0; i < 3000; i++) out.add(nextClip(manifest, { action, meal, mood: '平静' }, { now, rnd }).clip);
    return out;
  };
  const july = seen(new Date(2026, 6, 15, 15).getTime());
  const may = seen(new Date(2026, 4, 12, 15).getTime());
  assert.ok(july.has('摇扇纳凉') && !may.has('摇扇纳凉'));
  assert.ok(!may.has('堆雪人') && !may.has('被落叶淹没'));
  assert.ok(seen(new Date(2026, 0, 12, 15).getTime()).has('堆雪人'));
  assert.ok(seen(new Date(2026, 6, 15, 15).getTime(), 'eat', '下午茶').has('吃西瓜'));
  assert.ok(!seen(new Date(2026, 4, 12, 15).getTime(), 'eat', '下午茶').has('吃西瓜'));
  assert.ok(seen(new Date(2026, 10, 10, 8).getTime()).has('晨间刷牙'));
  assert.ok(!seen(new Date(2026, 10, 10, 15).getTime()).has('晨间刷牙'));
});

test('选片：心情差时点她会生气，心情好时开心', { skip: havePet ? false : NO_PET }, async () => {
  const { reactionClip } = await load('pet-director.mjs');
  assert.equal(reactionClip(manifest, 'poke', { mood: '委屈' }, { rnd: () => 0 }), '点击回应-傲娇生气');
  assert.ok(manifest.reactions.poke.good.includes(reactionClip(manifest, 'poke', { mood: '开心' }, { rnd: () => 0 })));
  assert.equal(reactionClip(manifest, 'wallet', { mood: '平静' }, { balanceTier: 0 }), '余额-分文不剩');
  assert.equal(reactionClip(manifest, 'wallet', { mood: '平静' }, { balanceTier: 5 }), '余额-钱袋满溢');
});

// ---------- 节日 ----------

test('节日：2026–2030 年的春节都对（含内置农历算错、人工更正的两年）', async () => {
  const { festivalsOfYear } = await load('pet-calendar.mjs');
  const spring = { 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03' };
  const eve = { 2026: '2026-02-16', 2027: '2027-02-05', 2028: '2028-01-25', 2029: '2029-02-12', 2030: '2030-02-02' };
  for (const y of Object.keys(spring)) {
    const f = festivalsOfYear(Number(y));
    assert.equal(f.spring, spring[y], `${y} 春节`);
    assert.equal(f.eve, eve[y], `${y} 除夕`);
  }
  // 更正表只核对到 2030 年，快到了就提醒有人补
  assert.ok(new Date().getFullYear() < 2030 || new Date().getMonth() < 6, '节日更正表只核对到 2030 年，请按 docs/notes/pet-festivals.md 补核 2031 年以后');
});

test('节日：端午、中秋、清明、冬至、七夕和公开日历一致', async () => {
  const { festivalsOfYear } = await load('pet-calendar.mjs');
  const known = {
    2026: { dragon: '06-19', midautumn: '09-25', qingming: '04-05', dongzhi: '12-22', qixi: '08-19', ghost: '08-27', double9: '10-18' },
    2027: { dragon: '06-09', midautumn: '09-15', lantern: '02-20' },
    2028: { dragon: '05-28', midautumn: '10-03', lantern: '02-09' },
    2029: { dragon: '06-16', midautumn: '09-22', qixi: '08-16', lantern: '02-27' },
    2030: { dragon: '06-05', midautumn: '09-12', qixi: '08-05', lantern: '02-17' },
  };
  for (const [y, list] of Object.entries(known)) {
    const f = festivalsOfYear(Number(y));
    for (const [id, md] of Object.entries(list)) assert.equal(f[id], `${y}-${md}`, `${y} ${id}`);
  }
});

test('节日：闰月不算，同一个节日一年只有一天（腊八除外）', async () => {
  const { festivalsOfYear, festivalsOn } = await load('pet-calendar.mjs');
  // 2025 年有闰六月：闰六月十五不是中元
  assert.deepEqual(festivalsOn(new Date(2025, 7, 8)), []);
  for (const y of [2026, 2027, 2028, 2029, 2030]) {
    const days = {};
    for (let t = new Date(y, 0, 1); t.getFullYear() === y; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
      for (const id of festivalsOn(t)) (days[id] ||= []).push(t.getDate());
    }
    for (const [id, list] of Object.entries(days)) if (id !== 'laba') assert.equal(list.length, 1, `${y} ${id} 出现了 ${list.length} 次`);
    assert.ok(festivalsOfYear(y).spring);
  }
});
