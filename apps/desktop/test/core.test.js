// 运行：npm test（Node 内置测试框架，不需要额外依赖）

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const life = require('../src/main/life');
const body = require('../src/main/body');
const memory = require('../src/main/memory');
const deepseek = require('../src/main/deepseek');
const { buildMessages } = require('../src/main/persona');
const { JsonStore } = require('../src/main/store');
const { Daughter } = require('../src/main/daughter');

const at = (h, m = 0) => new Date(2026, 10, 5, h, m).getTime();

test('三餐按时吃，进入消化系统', () => {
  let s = { ...life.initialState(at(8)), lastTick: at(8) };
  const r = life.tick(s, at(8, 20));
  assert.deepEqual(r.events.map((e) => e.type), ['meal']);
  assert.equal(r.events[0].meal, '早饭');
  // 同一顿不会吃两次
  assert.equal(life.tick(r.state, at(9)).events.filter((e) => e.type === 'meal').length, 0);
});

test('凌晨去睡觉，刚聊过天的 30 分钟内不睡', () => {
  const s = { ...life.initialState(at(0)), lastTick: at(0, 59) };
  assert.ok(life.tick(s, at(1, 5)).state.asleep);
  const chatting = { ...s, lastUserAt: at(1) };
  assert.ok(!life.tick(chatting, at(1, 5)).state.asleep);
});

test('睡着时收到消息会被吵醒', () => {
  const s = { ...life.initialState(at(3)), asleep: true };
  const r = life.onUserMessage(s, at(3));
  assert.ok(!r.state.asleep);
  assert.equal(r.events[0].type, 'woken');
});

test('主动找人：孤单才找，安静时段和每日上限都会拦住', () => {
  const lonely = { ...life.initialState(at(15)), social: 10 };
  assert.ok(life.proactiveReason(lonely, at(15)));
  assert.equal(life.proactiveReason(lonely, at(23, 30)), null); // 安静时段
  let s = lonely;
  for (let i = 0; i < 3; i++) s = life.markProactive({ ...s, social: 10 }, at(10 + i * 3));
  assert.equal(life.proactiveReason({ ...s, social: 10 }, at(20)), null); // 今天已经 3 次
});

test('身体：吃下去的东西经过胃和小肠慢慢变成饱腹', () => {
  let b = body.initialBody();
  let s = { ...life.initialState(at(12)), satiety: 20 };
  ({ body: b, life: s } = body.stepBody(b, s, 1, at(12), [{ type: 'meal', meal: '午饭' }], () => 0));
  assert.ok(b.stomach > 60);
  assert.equal(b.intake[0].item, '番茄牛腩饭');
  const before = s.satiety;
  for (let i = 0; i < 200; i++) ({ body: b, life: s } = body.stepBody(b, s, 1, at(12) + i * 60000));
  assert.ok(s.satiety > before + 20, `饱腹应上升，实际 ${before} → ${s.satiety}`);
  assert.ok(b.stomach < 10);
});

test('身体：夜里褪黑素升高，思考状态变成犯困', () => {
  let b = body.initialBody();
  let s = life.initialState(at(23));
  for (let i = 0; i < 90; i++) ({ body: b, life: s } = body.stepBody(b, s, 1, at(23)));
  assert.ok(b.nt.melatonin > 60);
  assert.equal(body.thinkingState(b, s), '犯困');
});

test('身体：所有数值都在范围内', () => {
  let b = body.initialBody();
  let s = life.initialState(at(0));
  for (let i = 0; i < 48; i++) {
    ({ body: b, life: s } = body.stepBody(b, s, 30, at(0) + i * 1800000, [{ type: 'user' }, { type: 'meal', meal: '午饭' }]));
    for (const v of Object.values(b.nt)) assert.ok(v >= 0 && v <= 100);
    const pad = body.pad(b, s);
    for (const k of ['P', 'A', 'D']) assert.ok(pad[k] >= -1 && pad[k] <= 1);
    assert.equal(body.systems(b, s).length, 8);
  }
});

test('记忆：合并去重、更正、重要性范围', () => {
  let facts = memory.mergeFacts([], { new: [{ text: 'TA 喜欢猫', importance: 9 }, { text: '  ' }] }, 1);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].importance, 5);
  facts = memory.mergeFacts(facts, { new: [{ text: 'TA 喜欢猫', importance: 3 }] }, 2);
  assert.equal(facts.length, 1);
  facts = memory.mergeFacts(facts, { corrections: [{ old: 'TA 喜欢猫', text: 'TA 喜欢狗' }] }, 3);
  assert.equal(facts[0].text, 'TA 喜欢狗');
  assert.deepEqual(memory.mergeFacts(facts, null), facts);
});

test('记忆：事实太多时优先取和话题相关的', () => {
  const facts = Array.from({ length: 50 }, (_, i) => ({ id: String(i), text: `无关的事情 ${i}`, importance: 2, createdAt: 0 }));
  facts.push({ id: 'x', text: 'TA 养了一只橘猫叫大橘', importance: 2, createdAt: 0 });
  const got = memory.retrieve(facts, '大橘今天怎么样', 0, 5);
  assert.equal(got[0].id, 'x');
});

test('DeepSeek：SSE 解析和宽松 JSON 解析', () => {
  const [ev, rest] = deepseek.parseSSE('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b"');
  assert.deepEqual(ev, ['{"a":1}', '[DONE]']);
  assert.equal(rest, 'data: {"b"');
  assert.deepEqual(deepseek.parseJSONLoose('```json\n{"new":[]}\n```'), { new: [] });
  assert.equal(deepseek.parseJSONLoose('不是 JSON'), null);
});

test('提示词：包含人设、状态和记忆，只带最近 24 条对话', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  const msgs = buildMessages({ state: life.initialState(at(12)), facts: [{ text: 'TA 喜欢猫' }], history, settings: { userName: '小明' }, now: at(12) });
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /小鲸鱼/);
  const named = buildMessages({ state: life.initialState(at(12)), settings: { daughterName: "阿栖" }, now: at(12) });
  assert.match(named[0].content, /你叫阿栖/);
  assert.match(msgs[0].content, /TA 喜欢猫/);
  assert.match(msgs[0].content, /小明/);
  assert.equal(msgs.length, 25);
});

test('端到端：对着模拟的 DeepSeek 聊天、流式输出、整理记忆、查余额', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url === '/user/balance') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.50' }] }));
      }
      const j = JSON.parse(raw);
      requests.push(j);
      if (j.response_format) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ choices: [{ message: { content: '{"new":[{"text":"TA 叫小明","importance":5}]}' } }] }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"呀"}}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\ndata: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-test-'));
  try {
    const d = new Daughter({ store: new JsonStore(dir), getSettings: () => ({ apiKey: 'sk-test', baseUrl: base, model: 'deepseek-chat' }) });
    const deltas = [];
    d.on('reply-delta', (_id, x) => deltas.push(x));
    const facts = new Promise((r) => d.once('facts', r));
    for (const t of ['我叫小明', '你好', '在干嘛']) await d.reply(t);
    assert.deepEqual(deltas.slice(0, 2), ['你好', '呀']);
    assert.equal(d.history.length, 6);
    assert.equal((await facts)[0].text, 'TA 叫小明');
    assert.equal(d.usage[life.dateKey(Date.now())].calls >= 3, true);
    const bal = await d.refreshBalance();
    assert.equal(bal.total, 12.5);
    // 重启后能恢复
    const d2 = new Daughter({ store: new JsonStore(dir), getSettings: () => ({}) });
    assert.equal(d2.history.length, 6);
    assert.equal(d2.facts.length, 1);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DeepSeek：错误码给出能看懂的提示', async () => {
  const server = http.createServer((_q, res) => {
    res.writeHead(402);
    res.end('Insufficient Balance');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(
      deepseek.chat({ apiKey: 'sk-x', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'm', messages: [] }),
      /余额不足/,
    );
  } finally {
    server.close();
  }
});
