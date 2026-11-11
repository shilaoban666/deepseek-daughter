// 内嵌 DSH 的配置（阶段 E3）：只装白名单里的插件，模型地址只能是本机的生命网关

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfg = require('../src/main/dsh/config');

const URL = 'http://127.0.0.1:43210';

test('DSH 配置：不包含任何能动电脑的插件', () => {
  const yaml = cfg.buildConfig({ gatewayUrl: URL });
  for (const bad of cfg.FORBIDDEN_PLUGINS) assert.ok(!yaml.includes(bad), `不应出现 ${bad}`);
  // 智能体主干自带的工具全部关掉
  assert.match(yaml, /toolBash: false/);
  assert.match(yaml, /toolJobs: false/);
  assert.match(yaml, /workspaceContext: false/);
  assert.match(yaml, /skills:\s*\n\s*enabled: false/);
});

test('DSH 配置：模型地址只能是本机', () => {
  const yaml = cfg.buildConfig({ gatewayUrl: URL });
  const base = yaml.match(/baseURL:\s*'([^']+)'/)[1];
  assert.equal(base, URL);
  assert.ok(base.startsWith('http://127.0.0.1:'));
  for (const bad of ['https://api.deepseek.com', 'http://localhost:1234', 'http://0.0.0.0:1', 'http://127.0.0.1:1/x', '', undefined]) {
    assert.throws(() => cfg.buildConfig({ gatewayUrl: bad }), /本机/, String(bad));
  }
});

test('DSH 配置：YAML 里没有明文密钥', () => {
  const yaml = cfg.buildConfig({ gatewayUrl: URL });
  assert.match(yaml, /apiKeyEnv: DFY_GATEWAY_TOKEN/, '密钥只通过环境变量的名字引用');
  assert.ok(!/apiKey:\s/.test(yaml), '没有字面的 apiKey');
  assert.ok(!/sk-[A-Za-z0-9]{8,}/.test(yaml));
  assert.ok(!yaml.includes('DEEPSEEK_API_KEY'), '不引用真的 DeepSeek Key');
});

test('DSH 配置：插件只能来自白名单', () => {
  const yaml = cfg.buildConfig({ gatewayUrl: URL });
  const names = cfg.pluginNames(yaml);
  assert.deepEqual(names, [...cfg.ALLOWED_PLUGINS]);
  for (const n of names) assert.ok(cfg.ALLOWED_PLUGINS.includes(n), n);
  // 通道插件这一期一个都不许
  assert.throws(() => cfg.buildConfig({ gatewayUrl: URL, channels: [{ id: 'qq', name: 'dsh-onebot-qq' }] }), /白名单/);
});

test('DSH 配置：写到 <userData>/dsh/profile/cordis.yml', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-dshcfg-'));
  try {
    const file = cfg.writeConfig({ userData: dir, gatewayUrl: URL });
    assert.equal(file, path.join(dir, 'dsh', 'profile', 'cordis.yml'));
    assert.equal(fs.readFileSync(file, 'utf8'), cfg.buildConfig({ gatewayUrl: URL }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DSH 打包：内核运行要用到的每个包都写在 dependencies 里（electron-builder 不会自己带上 peer 依赖）', () => {
  const pkg = require('../package.json');
  const roots = Object.keys(pkg.dependencies).filter((n) => n.startsWith('@deepseek-ai/dsh-sdk') || ['@deepseek-ai/dsh-llm-deepseek', '@deepseek-ai/dsh-agent-spine-demo'].includes(n));
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const n = queue.shift();
    if (seen.has(n)) continue;
    seen.add(n);
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node_modules', n, 'package.json'), 'utf8'));
    const optional = p.peerDependenciesMeta || {};
    queue.push(...Object.keys(p.dependencies || {}), ...Object.keys(p.peerDependencies || {}).filter((d) => !optional[d]?.optional));
    assert.equal(pkg.dependencies[n], p.version, `${n}@${p.version} 要写进 dependencies（版本写死）`);
  }
  assert.ok(seen.size > 50, `依赖闭包有 ${seen.size} 个包`);
  for (const n of Object.keys(pkg.dependencies)) assert.ok(seen.has(n), `dependencies 里的 ${n} 不是内核要用的，删掉`);
});

test('DSH 配置：白名单里的插件都装在 package.json 里，版本写死', () => {
  const pkg = require('../package.json');
  for (const n of [...cfg.ALLOWED_PLUGINS, '@deepseek-ai/dsh-sdk-jsonrpc-demo', '@deepseek-ai/dsh-sdk-client']) {
    const v = pkg.dependencies?.[n];
    assert.ok(v, `${n} 要在 dependencies 里`);
    assert.match(v, /^\d+\.\d+\.\d+(-[\w.]+)?$/, `${n} 的版本要写死，现在是 ${v}`);
  }
});
