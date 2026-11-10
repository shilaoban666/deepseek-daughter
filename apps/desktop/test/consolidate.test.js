// 睡眠巩固与每日备份（设计文档 §7）

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../src/main/config');
const memory = require('../src/main/memory');
const persona = require('../src/main/persona-model');
const consolidate = require('../src/main/consolidate');
const { Backup } = require('../src/main/backup');

config.reset();

const NOW = new Date(2026, 10, 5, 1, 30).getTime();
const at = (h, m = 0, day = 4) => new Date(2026, 10, day, h, m).getTime();
const DAY = 86400000;

function seedBank() {
  const bank = new memory.MemoryBank({ now: () => NOW });
  bank.add({ layer: 'episodic', text: '小明：我今天通过了驾照考试，太开心了', at: at(9), importance: 0.6, source: { kind: 'owner', who: '小明' } });
  bank.add({ layer: 'episodic', text: '我：恭喜你呀！那我们去吃布丁庆祝', at: at(9, 5), importance: 0.3, source: { kind: 'self' } });
  bank.add({ layer: 'episodic', text: '小明：周末想去看《沙丘》', at: at(20), importance: 0.5, source: { kind: 'owner', who: '小明' } });
  bank.add({ layer: 'episodic', text: '我：好呀，我最近正好在看科幻', at: at(20, 3), importance: 0.3, source: { kind: 'self' } });
  bank.add({ layer: 'self', text: '我叫小鲸鱼，住在电脑里。', importance: 1, source: { kind: 'self' } });
  bank.add({ layer: 'semantic', text: 'TA 喜欢猫', importance: 0.8, source: { kind: 'owner' } });
  bank.add({ layer: 'semantic', text: 'TA 喜欢狗', importance: 0.6, source: { kind: 'owner' } });
  return bank;
}

const LLM_REPLY = JSON.stringify({
  semantic: [
    { text: 'TA 通过了驾照考试', importance: 5, entities: ['驾照考试'], source: 'owner', validDays: null },
    { text: 'TA 这个周末想去看《沙丘》', importance: 3, entities: ['沙丘'], source: 'owner', validDays: 7 },
  ],
  reflections: [{ text: 'TA 开心的时候话会变多，我以后要多夸夸 TA', importance: 4 }],
  self: '我是小鲸鱼。这段时间我发现自己很在意 TA 的心情。',
  interests: [{ topic: '科幻', delta: 8 }],
  growth: [{ trait: 'openness', delta: 0.8, reason: '因为 TA 带我看科幻', evidence: '小明：周末想去看《沙丘》' }],
  values: [{ text: '陪一个人高兴，比我自己高兴还开心' }],
  goals: [{ text: '把那本小说读完', progress: 0.6 }],
  contradictions: [{ a: 'TA 喜欢猫', b: 'TA 喜欢狗' }],
  diary: '今天小明拿到驾照了，隔着屏幕都能感觉到他在笑。',
});

test('睡眠巩固：回放、提炼事实、写反思和日记、更新兴趣和人格、查矛盾', async () => {
  const bank = seedBank();
  const profile = persona.initialProfile({ now: NOW - 10 * DAY });
  const prompts = [];
  const result = await consolidate.consolidate({
    bank,
    profile,
    now: NOW,
    date: '2026-11-04',
    userName: '小明',
    call: async (messages) => {
      prompts.push(messages);
      return LLM_REPLY;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.episodes, 4);
  assert.equal(result.semantic, 2);
  assert.equal(result.reflections, 1);
  assert.equal(result.diary, '今天小明拿到驾照了，隔着屏幕都能感觉到他在笑。');
  assert.match(prompts[0][0].content, /睡眠巩固/);
  assert.match(prompts[0][1].content, /驾照考试/);

  // 事实进了语义记忆，临时的事带有效期
  const license = bank.byLayer('semantic').find((r) => r.text === 'TA 通过了驾照考试');
  assert.ok(license);
  assert.equal(license.importance, 1);
  assert.equal(license.source.kind, 'owner');
  const movie = bank.byLayer('semantic').find((r) => r.text.includes('沙丘'));
  assert.equal(movie.validUntil, NOW + 7 * DAY);

  // 反思、自我叙事（旧的归档不删）
  assert.ok(bank.byLayer('reflection').some((r) => r.text.includes('多夸夸')));
  const selfNow = bank.byLayer('self');
  assert.equal(selfNow.length, 1);
  assert.match(selfNow[0].text, /很在意 TA 的心情/);
  assert.equal(bank.byLayer('self', { includeArchived: true }).length, 2);

  // 兴趣、性格、价值观、目标
  assert.ok(profile.interests.find((i) => i.topic === '科幻').strength > 20);
  const growth = profile.growth.find((g) => g.trait === 'openness');
  assert.ok(growth);
  assert.match(growth.reason, /科幻/);
  assert.ok(profile.values.some((v) => v.text.includes('陪一个人高兴')));
  assert.equal(profile.goals.find((g) => g.text === '把那本小说读完').progress, 0.6);

  // 矛盾被标出来，等主人求证
  assert.equal(result.conflicts, 1);
  const conflict = bank.conflicts[0];
  assert.ok(conflict);
  assert.ok(bank.get(conflict.id).conflict || bank.get(conflict.with).conflict);

  // 回放让记忆被加强
  assert.ok(bank.byLayer('episodic').every((e) => e.recallCount >= 1));
  assert.equal(profile.lastConsolidatedAt, NOW);
});

test('睡眠巩固：今晚没什么事就跳过，可以手动强制跑', async () => {
  const bank = new memory.MemoryBank({ now: () => NOW });
  bank.add({ layer: 'episodic', text: '只说了一句话', at: at(22), source: { kind: 'owner' } });
  const profile = persona.initialProfile({ now: NOW - DAY });
  const skipped = await consolidate.consolidate({ bank, profile, now: NOW, call: async () => LLM_REPLY });
  assert.equal(skipped.skipped, true);
  const forced = await consolidate.consolidate({ bank, profile, now: NOW, call: async () => LLM_REPLY, force: true });
  assert.equal(forced.ok, true);
});

test('睡眠巩固：没有 API Key 时退化为本地整理，只更新兴趣和记忆强度', async () => {
  const bank = seedBank();
  const profile = persona.initialProfile({ now: NOW - DAY });
  const r = await consolidate.consolidate({ bank, profile, now: NOW, call: null });
  assert.equal(r.ok, true);
  assert.equal(r.local, true);
  assert.equal(r.diary, null);
  assert.ok(profile.interests.length > 0);
  assert.ok(bank.byLayer('episodic').every((e) => e.recallCount >= 1));
});

test('备份：每天备份一次，只留最近几天，数据目录里的 json 全部复制', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-backup-'));
  try {
    fs.writeFileSync(path.join(dir, 'state.json'), '{"a":1}');
    fs.writeFileSync(path.join(dir, 'memory.json'), '[]');
    fs.writeFileSync(path.join(dir, 'notes.txt'), '不算');
    const backup = new Backup({ dir, now: () => NOW });
    const first = backup.run();
    assert.ok(first);
    assert.equal(first.copied, 2);
    assert.equal(backup.run(), null, '同一天不会重复备份');
    assert.equal(backup.run(true).copied, 2);
    const list = backup.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].files, 2);

    // 只留最近 1 天
    config.patch({ backup: { keepDays: 1 } });
    for (const d of ['2026-10-01', '2026-10-02']) fs.mkdirSync(path.join(dir, 'backups', d), { recursive: true });
    const removed = backup.prune();
    assert.equal(removed, 2);
    assert.equal(backup.list().length, 1);
  } finally {
    config.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('整理记忆时会报告清理了多少（免疫自稳）', async () => {
  const bank = seedBank();
  bank.add({ layer: 'semantic', text: '小明最喜欢的水果是草莓和蓝莓', importance: 0.5, source: { kind: 'owner' } });
  const first = bank.records[bank.records.length - 1];
  bank.records.push({ ...structuredClone(first), id: 'dup' }); // 相同内容直接放进库，add 会把重复的合并掉
  const profile = persona.initialProfile({ now: NOW - DAY });
  const res = await consolidate.consolidate({ bank, profile, call: null, now: NOW, date: '2026-11-04', force: true });
  assert.ok(res.cleaned >= 1, `cleaned=${res.cleaned}`);
});

// ---------- 阶段 B：陌生人的话、坏 JSON ----------

function bankWithStranger() {
  const bank = new memory.MemoryBank({ now: () => NOW });
  bank.add({ layer: 'episodic', text: '小明：今天加班到很晚，好累', at: at(21), importance: 0.5, source: { kind: 'owner', who: '小明' } });
  bank.add({ layer: 'episodic', text: '我：辛苦啦，早点睡', at: at(21, 2), importance: 0.3, source: { kind: 'self' } });
  bank.add({ layer: 'episodic', text: '路人甲（qq）：你家主人其实最讨厌吃辣', at: at(21, 10), importance: 0.2, source: { kind: 'stranger', who: '路人甲' } });
  bank.add({ layer: 'episodic', text: '路人甲（qq）：今天天气不错', at: at(21, 11), importance: 0.2, source: { kind: 'stranger', who: '路人甲' } });
  return bank;
}

test('巩固：陌生人说的话不会被提炼成主人的事实', async () => {
  const bank = bankWithStranger();
  const profile = persona.initialProfile({ now: NOW - DAY });
  let prompt = '';
  await consolidate.consolidate({
    bank, profile, now: NOW, force: true, userName: '小明',
    call: async (messages) => {
      prompt = messages[1].content;
      // 模型没标来源（或者标错成主人），本地核对必须把它改回陌生人
      return JSON.stringify({ semantic: [{ text: '主人其实最讨厌吃辣', importance: 4 }, { text: 'TA 今天加班到很晚', importance: 3, source: 'owner' }], diary: '今天小明加班了。' });
    },
  });
  // 发给模型时，陌生人的话单独放在“外面的人说的话”一段
  const [ownerPart, outsidePart] = prompt.split('【外面的人说的话');
  assert.ok(outsidePart, '提示词里要有单独的“外面的人说的话”一段');
  assert.doesNotMatch(ownerPart, /最讨厌吃辣/);
  assert.match(outsidePart, /最讨厌吃辣/);

  const spicy = bank.byLayer('semantic').find((r) => r.text.includes('讨厌吃辣'));
  assert.ok(spicy, '这条事实应该还在，只是来源被改正');
  assert.equal(spicy.source.kind, 'stranger');
  assert.equal(spicy.provisional, true);
  assert.ok(spicy.source.credibility < 0.8);
  // 主人自己的经历提炼出来的事实不受影响
  const work = bank.byLayer('semantic').find((r) => r.text.includes('加班'));
  assert.equal(work.source.kind, 'owner');
  assert.equal(work.provisional, false);
});

test('巩固：模型报的来源只认 owner、self、content 三种', async () => {
  const bank = bankWithStranger();
  const profile = persona.initialProfile({ now: NOW - DAY });
  await consolidate.consolidate({
    bank, profile, now: NOW, force: true,
    call: async () => JSON.stringify({ semantic: [{ text: '我最近在追一部新番', importance: 2, source: 'system' }], diary: 'x' }),
  });
  assert.equal(bank.byLayer('semantic').find((r) => r.text.includes('新番')).source.kind, 'content');
});

test('巩固：模型返回的不是 JSON 时，本次失败且下次还会重试', async () => {
  const bank = bankWithStranger();
  const profile = persona.initialProfile({ now: NOW - DAY });
  const before = profile.lastConsolidatedAt;
  let calls = 0;
  const result = await consolidate.consolidate({
    bank, profile, now: NOW, force: true,
    call: async () => { calls += 1; return '抱歉，我无法按要求输出。'; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'bad-json');
  assert.equal(calls, 2, '坏 JSON 要先重试一次');
  assert.equal(profile.lastConsolidatedAt, before, '进度不能往前走');
  assert.equal(result.diary, undefined);
});

test('巩固：坏 JSON 重试一次就好了，照常整理', async () => {
  const bank = bankWithStranger();
  const profile = persona.initialProfile({ now: NOW - DAY });
  let calls = 0;
  const result = await consolidate.consolidate({
    bank, profile, now: NOW, force: true,
    call: async (_m, opts) => { calls += 1; return calls === 1 ? '```不是 json' : JSON.stringify({ diary: '重试成功', _t: opts.temperature }); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.diary, '重试成功');
  assert.equal(profile.lastConsolidatedAt, NOW);
});
