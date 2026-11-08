// 「我们」板块的数据：黑话、纪念日、关系，以及记忆四阶段和菜单结构。

const test = require('node:test');
const assert = require('node:assert/strict');

const slang = require('../src/main/slang');
const anniversary = require('../src/main/anniversary');
const memory = require('../src/main/memory');
const life = require('../src/main/life');
const { buildMessages } = require('../src/main/persona');

const at = (y, mo, d, h = 12) => new Date(y, mo - 1, d, h).getTime();
const DAY = 86400000;

test('菜单：8 个板块、24 个路由，顺序和文字与需求一致', async () => {
  const { NAV, routes } = await import('../src/renderer/nav-data.mjs');
  assert.deepEqual(NAV.map((n) => n.label), ['概览', '意识和记忆', '我们', '神经活动', '代谢活动', '免疫活动', '发现探索', '设置']);
  assert.equal(routes().length, 24);
  assert.deepEqual(NAV[1].tabs.map((t) => t.label), ['意识海', '思想', '人格', '记忆', '情绪']);
  assert.deepEqual(NAV[2].tabs.map((t) => t.label), ['回忆', '黑话', '关系', '纪念日']);
  assert.deepEqual(NAV[3].tabs.map((t) => t.label), ['大脑3D', '神经系统', '神经递质']);
  assert.deepEqual(NAV[4].tabs.map((t) => t.label), ['消化活动', '呼吸与心率', '体液系统', '内分泌系统', '泌尿系统', '生殖系统']);
  assert.deepEqual(NAV[5].tabs.map((t) => t.label), ['淋巴系统', '免疫调节']);
});

test('路由：非法输入回退到概览，只写板块时取第一个 Tab', async () => {
  const { parseRoute } = await import('../src/renderer/nav-data.mjs');
  assert.deepEqual(parseRoute('nope/x'), { view: 'overview', tab: 'now' });
  assert.deepEqual(parseRoute(undefined), { view: 'overview', tab: 'now' });
  assert.deepEqual(parseRoute('neuro/brain'), { view: 'neuro', tab: 'brain' });
  assert.deepEqual(parseRoute('neuro'), { view: 'neuro', tab: 'brain' });
  assert.deepEqual(parseRoute('neuro/nope'), { view: 'neuro', tab: 'brain' });
});

test('黑话：同词合并，使用次数累加', () => {
  let list = slang.add([], { term: '布丁税', meaning: '帮了忙要请吃布丁', example: 'a', at: 1000 });
  list = slang.add(list, { term: '布丁税', meaning: '新解释', example: 'b', at: 2000 });
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 2);
  assert.equal(list[0].meaning, '新解释');
  assert.equal(slang.observe(list, '今天的布丁税交了吗', 3000)[0].count, 3);
});

test('黑话：长期不用会淡化，太淡了归档', () => {
  const list = slang.add([], { term: '关机了', meaning: '要睡觉', at: 0 });
  const later = slang.decay(list, 90 * DAY);
  assert.ok(Math.abs(later[0].strength - 0.5) < 1e-6);
  const gone = slang.decay(list, 400 * DAY);
  assert.equal(gone[0].archived, true);
});

test('黑话：只把本句相关的放进提示词，最多 5 条', () => {
  let list = [];
  for (let i = 0; i < 8; i++) list = slang.add(list, { term: `词${i}`, meaning: 'm', at: i });
  assert.equal(slang.forPrompt(list, '词0 词1 词2 词3 词4 词5 词6').length, 5);
  assert.deepEqual(slang.forPrompt(list, '不相关'), []);
  const sys = buildMessages({ memories: [], history: [], settings: {}, now: 0, slang: slang.forPrompt(list, '词3') })[0].content;
  assert.match(sys, /词3/);
});

test('纪念日：计算还有几天，跨年正确', () => {
  const items = [{ id: 'a', title: '生日', date: '2020-01-02' }];
  const r = anniversary.upcoming(items, at(2026, 12, 30), 10);
  assert.equal(r[0].daysLeft, 3);
  assert.equal(r[0].date, '2027-01-02');
  assert.deepEqual(anniversary.upcoming(items, at(2026, 12, 20), 3), []);
});

test('纪念日：2 月 29 日在平年落到 2 月 28 日', () => {
  const r = anniversary.upcoming([{ id: 'a', title: 'x', date: '2024-02-29' }], at(2027, 2, 20), 30);
  assert.equal(r[0].date, '2027-02-28');
});

test('纪念日当天她会想起来，但仍然遵守安静时段', () => {
  const s = { ...life.initialState(at(2026, 11, 5, 15)), social: 60, mood: 0, lastUserAt: at(2026, 11, 5, 8), lastProactiveAt: 0 };
  assert.match(life.proactiveReason(s, at(2026, 11, 5, 15), { special: '今天是纪念日' }), /纪念日/);
  assert.equal(life.proactiveReason(s, at(2026, 11, 5, 23, 30), { special: '今天是纪念日' }), null);
});

test('关系：聊得越多越亲近，数值在范围内', () => {
  const low = anniversary.relation({ days: 1, messages: 2, memories: 1, proactive: 0 });
  const high = anniversary.relation({ days: 60, messages: 900, memories: 200, proactive: 40 });
  assert.ok(high.intimacy > low.intimacy);
  for (const v of Object.values(high)) assert.ok(v >= 0 && v <= 100);
});

test('记忆四阶段', () => {
  const now = at(2026, 11, 5);
  const stage = (r) => memory.memoryStage({ recallCount: 0, at: now, ...r }, now);
  assert.equal(stage({ layer: 'working' }), 'first');
  assert.equal(stage({ layer: 'episodic' }), 'second');
  assert.equal(stage({ layer: 'self' }), 'third');
  assert.equal(stage({ layer: 'semantic', recallCount: 4, at: now - 40 * DAY }), 'second');
  assert.equal(stage({ layer: 'semantic', recallCount: 5, at: now - 40 * DAY }), 'third');
  assert.equal(stage({ layer: 'semantic', recallCount: 5, at: now - 10 * DAY }), 'second');
});
