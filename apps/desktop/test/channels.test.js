// 插件页（阶段 D）：平台清单、设置校验、加密存储

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const registry = require('../src/main/channels/registry');
const { createSecrets } = require('../src/main/secrets');
const { JsonStore } = require('../src/main/store');

/** 假的系统加密：把字符串倒过来再 base64，足够区分明文和密文 */
function fakeCipher({ available = true } = {}) {
  return {
    available: async () => available,
    encrypt: async (s) => Buffer.from(`ENC:${[...s].reverse().join('')}`),
    decrypt: async (b) => ({ result: [...b.toString().replace(/^ENC:/, '')].reverse().join(''), shouldReEncrypt: false }),
  };
}

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-ch-'));
  return { store: new JsonStore(dir), dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('插件：清单里有 8 个平台，聊天 2 个、内容 6 个', () => {
  assert.equal(registry.PLATFORMS.length, 8);
  assert.equal(registry.PLATFORMS.filter((p) => p.group === 'chat').length, 2);
  assert.equal(registry.PLATFORMS.filter((p) => p.group === 'content').length, 6);
  assert.deepEqual(registry.PLATFORMS.filter((p) => p.availability === 'soon').map((p) => p.id), ['qq', 'wechat']);
  for (const p of registry.PLATFORMS) {
    assert.ok(p.name && p.desc && p.does.length && p.risk && p.fields.length, p.id);
  }
});

test('插件：QQ 号必须是 5–12 位数字，群号列表里混进字母会被拒绝', () => {
  assert.equal(registry.validate('qq', {}).errors.ownerQQ, '请填你的 QQ 号');
  assert.match(registry.validate('qq', { ownerQQ: '1234' }).errors.ownerQQ, /5 到 12 位/);
  assert.match(registry.validate('qq', { ownerQQ: '12345abc' }).errors.ownerQQ, /5 到 12 位/);
  const ok = registry.validate('qq', { ownerQQ: ' 12345678 ', groups: '10001，20002 10001' });
  assert.equal(ok.ok, true);
  assert.equal(ok.values.ownerQQ, '12345678');
  assert.deepEqual(ok.values.groups, ['10001', '20002'], '中文逗号、空格都能分开，重复的去掉');
  assert.match(registry.validate('qq', { ownerQQ: '12345678', groups: '10001,abc' }).errors.groups, /abc/);
});

test('插件：端口必须在 1024–65535 之间，不填用默认 8643', () => {
  assert.equal(registry.validate('qq', { ownerQQ: '12345678' }).values.port, 8643);
  assert.match(registry.validate('qq', { ownerQQ: '12345678', port: 80 }).errors.port, /1024/);
  assert.match(registry.validate('qq', { ownerQQ: '12345678', port: 70000 }).errors.port, /65535/);
  assert.equal(registry.validate('qq', { ownerQQ: '12345678', port: '9000' }).values.port, 9000);
});

test('插件：保存后显示状态从“还没设置”变成“已保存设置”；未排期的平台始终是“未开放”', () => {
  assert.equal(registry.list({}).find((p) => p.id === 'qq').status, 'unset');
  const saved = { qq: registry.validate('qq', { ownerQQ: '12345678' }).values, bilibili: { read: true, write: true } };
  const l = registry.list(saved);
  assert.equal(l.find((p) => p.id === 'qq').status, 'saved');
  assert.equal(l.find((p) => p.id === 'bilibili').status, 'planned');
  assert.equal(l.find((p) => p.id === 'bilibili').values.write, true, '开关照样能保存');
  assert.ok(l.every((p) => !['online', 'connecting'].includes(p.status)), '这一期没有任何平台会显示已连接');
});

test('插件：返回给界面的数据里只有“令牌有没有”，没有令牌内容', async () => {
  const t = tmpStore();
  try {
    const secrets = createSecrets({ store: t.store, cipher: fakeCipher() });
    await secrets.save('channel:qq:token', 'TOPSECRET0123456789abcdef0123456');
    const l = registry.list({}, (n) => secrets.has(n));
    assert.equal(l.find((p) => p.id === 'qq').secretSet, true);
    assert.ok(!JSON.stringify(l).includes('TOPSECRET'));
    assert.ok(!fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8').includes('TOPSECRET'), '存盘的是密文');
    assert.equal(await secrets.read('channel:qq:token'), 'TOPSECRET0123456789abcdef0123456');
  } finally {
    t.done();
  }
});

test('加密存储：旧存档里的 apiKeyEnc 照常能读，读一次就迁移到新格式', async () => {
  const t = tmpStore();
  try {
    const cipher = fakeCipher();
    t.store.save('settings', { apiKeyEnc: (await cipher.encrypt('sk-old-key')).toString('base64'), onebotUrl: 'ws://127.0.0.1:3001', daughterName: '阿栖' });
    const secrets = createSecrets({ store: t.store, cipher });
    assert.equal(secrets.has('deepseek'), true);
    assert.equal(await secrets.read('deepseek'), 'sk-old-key');
    const after = t.store.load('settings', {});
    assert.ok(after.secrets.deepseek.enc, '迁移到 secrets.deepseek');
    assert.equal(after.apiKeyEnc, undefined, '旧字段删掉');
    assert.equal(after.daughterName, '阿栖', '其他设置不动');
  } finally {
    t.done();
  }
});

test('加密存储：系统不支持加密时退回明文，和以前的规则一样', async () => {
  const t = tmpStore();
  try {
    const secrets = createSecrets({ store: t.store, cipher: fakeCipher({ available: false }) });
    await secrets.save('deepseek', 'sk-plain');
    assert.equal(t.store.load('settings', {}).secrets.deepseek.plain, 'sk-plain');
    assert.equal(await secrets.read('deepseek'), 'sk-plain');
    await secrets.save('deepseek', '');
    assert.equal(secrets.has('deepseek'), false);
  } finally {
    t.done();
  }
});
