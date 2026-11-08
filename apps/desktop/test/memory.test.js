// 记忆系统测试：六层、五路检索、时间查询、遗忘、溯源与矛盾（设计文档 §7）

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/main/config');
const memory = require('../src/main/memory');

config.reset();

const T = (day, h = 12, m = 0) => new Date(2026, 10, day, h, m).getTime();
const NOW = T(8, 15);

const makeBank = () => new memory.MemoryBank({ now: () => NOW, config: config.get() });

test('六层记忆：层名齐全，旧 facts 自动迁移成语义记忆', () => {
  const bank = makeBank();
  bank.load([
    { id: 'old', text: 'TA 喜欢橘猫', importance: 4, createdAt: T(7, 9) },
    { id: 'bad' },
  ]);
  assert.equal(bank.records.length, 1);
  const r = bank.records[0];
  assert.equal(r.layer, 'semantic');
  assert.equal(r.importance, 0.8);
  assert.equal(r.source.kind, 'owner');
  assert.ok(r.entities.includes('橘猫'));
  assert.deepEqual(memory.LAYERS, ['episodic', 'semantic', 'procedural', 'reflection', 'self']);

  const added = bank.add({ layer: 'procedural', text: '每天早上先刷一会儿视频', source: { kind: 'self' } });
  assert.equal(added.action, 'new');
  assert.equal(bank.byLayer('procedural').length, 1);
  assert.equal(bank.toJSON().length, 2);
});

test('五路混合检索：问“橘猫”先找到养猫那条，并给出每一路的分数', () => {
  const bank = makeBank();
  bank.add({ layer: 'semantic', text: 'TA 养了一只橘猫叫大橘', importance: 0.6, at: T(1) });
  bank.add({ layer: 'semantic', text: 'TA 在准备期末考试', importance: 0.6, at: T(2) });
  bank.add({ layer: 'episodic', text: 'TA 今天中午吃了番茄牛腩饭', importance: 0.3, at: T(8, 12) });
  const got = bank.search('大橘今天怎么样');
  assert.equal(got.mode, 'semantic');
  assert.equal(got.items[0].text, 'TA 养了一只橘猫叫大橘');
  assert.deepEqual(Object.keys(got.items[0].parts).sort(), ['entity', 'freshness', 'importance', 'keyword', 'vector']);
  assert.ok(got.items[0].parts.entity > 0);
  assert.ok(got.confident);
});

test('五路混合检索：recall@5 在小型中文问题集上达标', () => {
  const bank = makeBank();
  const facts = [
    ['主人的生日是 3 月 14 日', '我的生日是哪天'],
    ['TA 是一名大三学生，学的是计算机', '我是学什么的'],
    ['TA 最喜欢的乐队是万能青年旅店', '我喜欢哪个乐队'],
    ['TA 对花生过敏', '我有什么过敏'],
    ['TA 养了一只橘猫叫大橘', '我养的猫叫什么'],
    ['TA 下个月要去成都出差', '我下个月要去哪'],
    ['TA 的妈妈住在杭州', '我妈住在哪里'],
  ];
  facts.forEach(([text], i) => bank.add({ layer: 'semantic', text, importance: 0.7, at: T(1, 10 + i) }));
  for (let i = 0; i < 20; i++) bank.add({ layer: 'episodic', text: `第 ${i} 天 TA 和我聊了会儿天，没什么特别的`, importance: 0.2, at: T(2, 10 + (i % 10)) });

  let hit = 0;
  facts.forEach(([text, q]) => {
    const top = bank.search(q, { limit: 5 }).items.map((x) => x.text);
    if (top.includes(text)) hit += 1;
  });
  assert.ok(hit >= facts.length - 1, `recall@5 太低：${hit}/${facts.length}`);
});

test('时间查询：昨天早上按时间直接取原话，闲聊里带时间词不会误判', () => {
  const range = memory.parseTimeQuery('昨天早上聊了什么', NOW);
  assert.equal(range.label, '昨天早上');
  assert.equal(range.from, T(7, 5));
  assert.equal(range.to, T(7, 11));
  assert.equal(memory.parseTimeQuery('我今天有点累', NOW), null);
  assert.equal(memory.parseTimeQuery('早上好呀', NOW), null);
  assert.ok(memory.parseTimeQuery('昨天', NOW));

  const bank = makeBank();
  bank.add({ layer: 'episodic', text: '我说昨天早上我做了个很奇怪的梦', at: T(7, 8) });
  bank.add({ layer: 'episodic', text: '中午一起吃了面', at: T(8, 12) });
  const got = bank.search('昨天早上我说了什么', { now: NOW });
  assert.equal(got.mode, 'time');
  assert.deepEqual(got.items.map((x) => x.text), ['我说昨天早上我做了个很奇怪的梦']);
});

test('遗忘：艾宾浩斯衰减，低重要性归档，重要记忆受保护且能恢复', () => {
  const bank = makeBank();
  const low = bank.add({ layer: 'episodic', text: '随手聊了一句天气', importance: 0.1, at: T(8) }).record;
  const high = bank.add({ layer: 'semantic', text: 'TA 的生日是 3 月 14 日', importance: 0.95, at: T(8) }).record;
  const later = NOW + 400 * memory.DAY;
  const archived = bank.decay(later);
  assert.ok(archived >= 1);
  assert.ok(bank.get(low.id).archived);
  assert.equal(bank.get(high.id).archived, false, '重要性高的记忆不该被忘记');
  assert.equal(bank.search('生日', { now: later, includeArchived: true }).items[0].text, 'TA 的生日是 3 月 14 日');
  bank.restore(low.id);
  assert.equal(bank.get(low.id).archived, false);
  assert.equal(bank.get(low.id).strength, 0.2);
});

test('回忆一次就加强一次，强度影响之后的衰减速度', () => {
  const bank = makeBank();
  const r = bank.add({ layer: 'semantic', text: 'TA 喜欢下雨天', importance: 0.4, at: T(8) }).record;
  bank.recall([r.id]);
  assert.equal(bank.get(r.id).recallCount, 1);
  assert.ok(bank.get(r.id).strength > 0.5);
  bank.recall([r.id, r.id]);
  assert.equal(bank.get(r.id).recallCount, 3);
});

test('溯源：陌生人不能覆盖主人说过的话，矛盾被记录并标成待求证', () => {
  const bank = makeBank();
  bank.add({ layer: 'semantic', text: 'TA 喜欢猫', importance: 0.8, source: { kind: 'owner' } });
  const got = bank.add({ layer: 'semantic', text: 'TA 不喜欢猫', importance: 0.6, source: { kind: 'stranger', who: '路人甲' } });
  assert.equal(got.action, 'provisional');
  assert.equal(got.record.provisional, true);
  const owner = bank.records.find((r) => r.source.kind === 'owner');
  assert.equal(owner.text, 'TA 喜欢猫');
  assert.ok(owner.conflict);
  assert.equal(bank.stats().conflicts, 1);
  assert.equal(got.record.source.credibility, 0.35);

  // 主人自己纠正自己：可以覆盖
  const fixed = bank.add({ layer: 'semantic', text: 'TA 喜欢狗', importance: 0.8, source: { kind: 'owner' } });
  assert.equal(fixed.record.source.kind, 'owner');
  bank.resolveConflict(bank.conflicts[0]?.id, owner.id);
  assert.equal(bank.stats().conflicts, 0);
});

test('合并相似记忆：同一件事只留一条，原文归档不删除', () => {
  const bank = makeBank();
  const a = bank.add({ layer: 'semantic', text: 'TA 每天早上都要喝一杯冰美式', importance: 0.5, source: { kind: 'owner' } }).record;
  const b = bank.add({ layer: 'semantic', text: 'TA 每天早上都要喝一杯冰美式', importance: 0.5, source: { kind: 'self' } });
  assert.equal(b.action, 'merged');
  assert.equal(b.record.id, a.id);
  assert.equal(bank.records.length, 1);

  bank.add({ layer: 'episodic', text: '今天和 TA 一起看了《沙丘》，画面很震撼', at: T(6) });
  bank.add({ layer: 'episodic', text: '今天和 TA 一起看了《沙丘》，画面真的很震撼', at: T(6, 14) });
  const merged = bank.mergeSimilar();
  assert.ok(merged >= 1);
  assert.equal(bank.byLayer('episodic').length, 1);
  assert.equal(bank.byLayer('episodic', { includeArchived: true }).length, 2);
  assert.ok(bank.byLayer('episodic', { includeArchived: true }).some((r) => r.meta.archivedBy === 'merge'));
});

test('时效：过期的事实不再参与检索', () => {
  const bank = makeBank();
  bank.add({ layer: 'semantic', text: 'TA 正在准备期末考试', importance: 0.6, at: T(1), validUntil: T(3) });
  bank.add({ layer: 'semantic', text: 'TA 喜欢看老电影', importance: 0.5, at: T(1) });
  assert.equal(bank.search('考试', { now: NOW }).items.length, 0);
  assert.equal(bank.search('电影', { now: NOW }).items.length, 1);
});

test('持久化：导出再载入，记忆和待求证的矛盾都还在', () => {
  const bank = makeBank();
  bank.add({ layer: 'semantic', text: 'TA 喜欢猫', importance: 0.8, source: { kind: 'owner' } });
  bank.add({ layer: 'semantic', text: 'TA 不喜欢猫', importance: 0.5, source: { kind: 'stranger', who: '路人' } });
  const dump = JSON.parse(JSON.stringify(bank.export()));
  const loaded = makeBank().load(dump);
  assert.equal(loaded.records.length, 2);
  assert.equal(loaded.conflicts.length, 1);
  assert.equal(loaded.stats().conflicts, 1);
  assert.equal(loaded.stats().active, 2);
  // 旧版本只存了数组，也要能读
  const legacy = makeBank().load(dump.records);
  assert.equal(legacy.records.length, 2);
  assert.equal(legacy.conflicts.length, 0);
});

test('记忆统计：分层数量、冲突、受保护的记忆', () => {
  const bank = makeBank();
  bank.add({ layer: 'episodic', text: '今天天气不错', importance: 0.2 });
  bank.add({ layer: 'semantic', text: 'TA 喜欢猫', importance: 0.9, source: { kind: 'owner' } });
  bank.add({ layer: 'reflection', text: '我发现 TA 难过的时候不太想说话', importance: 0.7 });
  const s = bank.stats();
  assert.equal(s.total, 3);
  assert.equal(s.active, 3);
  assert.equal(s.perLayer.semantic.name, '语义记忆');
  assert.equal(s.perLayer.semantic.active, 1);
  assert.ok(s.protected >= 2);
  assert.ok(s.avgStrength > 0.9);
});
