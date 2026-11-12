// 生命网关（阶段 E1）：DSH 以为自己在调用 DeepSeek，实际上是在和她说话

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseRequest } = require('../src/main/gateway-parse');
const { createGateway, OTHER_REPLY } = require('../src/main/gateway');
const deepseek = require('../src/main/deepseek');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'dsh-chat-request.json'), 'utf8'));

/** 假的她：记下听到了什么，按片段流式回答 */
function fakeDaughter({ reply = '我在呀，你好。', delay = 0, fail = null } = {}) {
  const heard = [];
  return {
    heard,
    async replyFrom({ text, channel, onDelta }) {
      heard.push({ text, channel });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (fail) throw new Error(fail);
      for (const part of reply.match(/.{1,3}/gu) || []) onDelta?.(part);
      return { text: reply };
    },
  };
}

async function withGateway(daughter, fn, opts = {}) {
  const gw = createGateway({ daughter, ...opts });
  const { url, token } = await gw.start();
  try {
    return await fn({ gw, url, token });
  } finally {
    await gw.stop();
  }
}

const post = (url, token, body, headers = {}) =>
  fetch(`${url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });

// ---------- 解析 ----------

test('网关：取最后一句用户消息，忽略系统提示词和历史', () => {
  assert.deepEqual(parseRequest(fixture.body), { kind: 'chat', text: '你好 0' });
  const long = { messages: [{ role: 'system', content: '你是编程助手' }, { role: 'user', content: '第一句' }, { role: 'assistant', content: '回' }, { role: 'user', content: '  第二句  ' }] };
  assert.deepEqual(parseRequest(long), { kind: 'chat', text: '第二句' });
});

test('网关：没有用户消息的请求不会被当成聊天', () => {
  assert.equal(parseRequest({ messages: [{ role: 'system', content: 'x' }] }).kind, 'other');
  assert.equal(parseRequest({ messages: [] }).kind, 'other');
  assert.equal(parseRequest({}).kind, 'other');
  assert.equal(parseRequest(null).kind, 'other');
  const toolTurn = { messages: [{ role: 'user', content: '帮我跑个命令' }, { role: 'assistant', content: '', tool_calls: [{}] }, { role: 'tool', content: 'ok' }] };
  assert.equal(parseRequest(toolTurn).kind, 'other', '工具结果不是有人在说话');
  assert.equal(parseRequest({ messages: [{ role: 'user', content: '   ' }] }).kind, 'other');
});

test('网关：标题、压缩这类请求被识别出来', () => {
  // E0 实测：DSH 0.0.1 的最小配置只发聊天请求；压缩插件的请求会带 x-deepseek-harness-compact 头
  assert.deepEqual(parseRequest(fixture.body, { 'x-deepseek-harness-compact': '1' }), { kind: 'other', reason: 'compaction' });
  assert.equal(parseRequest({ ...fixture.body, response_format: { type: 'json_object' } }).kind, 'other', '要结构化输出的不是聊天');
});

test('网关：数组形式的内容只取文字', () => {
  const body = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:...' } }, { type: 'text', text: '看这张' }, { type: 'text', text: '图' }] }] };
  assert.deepEqual(parseRequest(body), { kind: 'chat', text: '看这张\n图' });
});

// ---------- HTTP 服务 ----------

test('网关：令牌不对返回 401', async () => {
  const d = fakeDaughter();
  await withGateway(d, async ({ url, token }) => {
    assert.ok(token.length >= 40, '32 字节随机令牌');
    assert.equal((await post(url, 'wrong', fixture.body)).status, 401);
    assert.equal((await fetch(`${url}/chat/completions`, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await post(url, token + 'x', fixture.body)).status, 401);
    assert.equal(d.heard.length, 0);
  });
});

test('网关：每次启动换一个令牌', async () => {
  const gw = createGateway({ daughter: fakeDaughter() });
  const a = await gw.start();
  await gw.stop();
  const b = await gw.start();
  await gw.stop();
  assert.notEqual(a.token, b.token);
});

test('网关：流式回复能被 deepseek.js 的解析器读出来', async () => {
  const d = fakeDaughter({ reply: '我在呀，今天吃了番茄炒蛋。' });
  await withGateway(d, async ({ url, token }) => {
    const deltas = [];
    const r = await deepseek.chat({ apiKey: token, baseUrl: url, model: 'deepseek-chat', messages: fixture.body.messages, onDelta: (x) => deltas.push(x) });
    assert.equal(r.text, '我在呀，今天吃了番茄炒蛋。');
    assert.ok(deltas.length > 1, '是一段一段送回来的');
    assert.ok(r.usage && typeof r.usage.completion_tokens === 'number', '带用量');
    const whole = await deepseek.chat({ apiKey: token, baseUrl: url, model: 'deepseek-chat', messages: [{ role: 'user', content: '不流式' }] });
    assert.equal(whole.text, '我在呀，今天吃了番茄炒蛋。');
    assert.deepEqual(d.heard.map((h) => h.channel), ['kernel', 'kernel']);
  });
});

test('网关：回复里没有 tool_calls', async () => {
  await withGateway(fakeDaughter(), async ({ url, token }) => {
    const withTools = { ...fixture.body, tools: [{ type: 'function', function: { name: 'bash', parameters: {} } }], tool_choice: 'required' };
    const raw = await (await post(url, token, withTools)).text();
    assert.ok(!raw.includes('tool_calls'), raw.slice(0, 200));
    assert.ok(raw.trim().endsWith('data: [DONE]'));
    const json = await (await post(url, token, { ...withTools, stream: false, messages: [{ role: 'user', content: '再来' }] })).json();
    assert.equal(json.choices[0].message.tool_calls, undefined);
    assert.equal(json.choices[0].finish_reason, 'stop');
  });
});

test('网关：非聊天请求不会进入她的记忆', async () => {
  const { Daughter } = require('../src/main/daughter');
  const { JsonStore } = require('../src/main/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-gw-'));
  try {
    const d = new Daughter({ store: new JsonStore(dir), getSettings: () => ({}) });
    const before = { history: d.history.length, memory: d.memory.records.length };
    await withGateway(d, async ({ url, token }) => {
      const r1 = await post(url, token, fixture.body, { 'x-deepseek-harness-compact': '1' });
      assert.ok((await r1.text()).includes(OTHER_REPLY.slice(1, 5)));
      await (await post(url, token, { messages: [{ role: 'system', content: '只有系统提示词' }], stream: false })).text();
      await (await post(url, token, { messages: [{ role: 'tool', content: 'ok' }], stream: true })).text();
    });
    assert.equal(d.history.length, before.history);
    assert.equal(d.memory.records.length, before.memory);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('网关：只监听本机', async () => {
  await withGateway(fakeDaughter(), async ({ gw, url }) => {
    assert.equal(gw.address().address, '127.0.0.1');
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

test('网关：其他路径 404', async () => {
  await withGateway(fakeDaughter(), async ({ url, token }) => {
    const h = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${url}/user/balance`, { headers: h })).status, 404);
    assert.equal((await fetch(`${url}/models`, { headers: h })).status, 404);
    assert.equal((await fetch(`${url}/chat/completions`, { headers: h })).status, 404, 'GET 不行');
  });
});

test('网关：DSH 重试同一个请求时她只听一次', async () => {
  const d = fakeDaughter({ delay: 30 });
  await withGateway(d, async ({ url, token }) => {
    const h = { 'x-deepseek-harness-session-id': 'session-a' };
    const [a, b] = await Promise.all([post(url, token, fixture.body, h).then((r) => r.text()), post(url, token, fixture.body, h).then((r) => r.text())]);
    assert.ok(a.includes('我在') && b.includes('我在'));
    await (await post(url, token, fixture.body, h)).text();
    assert.equal(d.heard.length, 1, '同一会话同一句话只让她听一次');
    await (await post(url, token, fixture.body, { 'x-deepseek-harness-session-id': 'session-b' })).text();
    assert.equal(d.heard.length, 2, '换了会话就是新的一句');
  });
});

test('网关：她出错时返回 503 和原因，超时返回 504', async () => {
  await withGateway(fakeDaughter({ fail: '连不上 DeepSeek，检查一下网络。' }), async ({ gw, url, token }) => {
    const r = await post(url, token, fixture.body);
    assert.equal(r.status, 503);
    assert.match((await r.json()).error.message, /连不上/);
    assert.match(gw.info().lastError, /连不上/);
  });
  await withGateway(fakeDaughter({ delay: 300 }), async ({ url, token }) => {
    const r = await post(url, token, fixture.body);
    assert.equal(r.status, 504);
  }, { timeoutMs: 50 });
});

test('网关：她“累了”的固定回复也能完整送回去', async () => {
  const d = { replyFrom: async () => ({ text: '我今天好累，先睡了。', tired: true }) };
  await withGateway(d, async ({ url, token }) => {
    const r = await deepseek.chat({ apiKey: token, baseUrl: url, model: 'deepseek-chat', messages: fixture.body.messages, onDelta: () => {} });
    assert.equal(r.text, '我今天好累，先睡了。');
  });
});

test('生命网关：记下最近请求的种类和耗时，不记内容', async () => {
  const gw = createGateway({ daughter: { replyFrom: async () => ({ text: '嗯嗯' }) } });
  const { url, token } = await gw.start();
  try {
    const post = (auth, body) => fetch(`${url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify(body) });
    await (await post(token, { messages: [{ role: 'user', content: '一句只说给她听的话' }] })).text();
    await (await post('wrong', { messages: [{ role: 'user', content: 'x' }] })).text();
    const info = gw.info();
    assert.deepEqual(info.recent.map((r) => r.kind), ['chat', 'unauthorized']);
    assert.equal(info.recent[0].ok, true);
    assert.equal(info.recent[0].chars, 2);
    assert.ok(info.recent[0].ms >= 0);
    assert.ok(info.since > 0);
    assert.ok(!JSON.stringify(info).includes('一句只说给她听的话'), '统计里不能有聊天内容');
    assert.ok(!JSON.stringify(info).includes(token), '统计里不能有令牌');
  } finally {
    await gw.stop();
  }
});
