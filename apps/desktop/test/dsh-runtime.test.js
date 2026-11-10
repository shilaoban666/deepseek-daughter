// 内嵌 DSH 的子进程管理（阶段 E3）。用假的内核进程代替真 DSH，用假时钟控制重启间隔。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { createDshRuntime, childEnv, ENV_PASSTHROUGH } = require('../src/main/dsh/runtime');

const FAKE = path.join(__dirname, 'fixtures', 'fake-dsh-child.js');

/** 假时钟：记下排了哪些定时器，测试里手动触发 */
function fakeTimers() {
  let seq = 0;
  const queue = new Map();
  const scheduled = [];
  return {
    scheduled,
    setTimeout(fn, ms) {
      const id = ++seq;
      queue.set(id, { fn, ms });
      scheduled.push(ms);
      return id;
    },
    clearTimeout(id) {
      queue.delete(id);
    },
    /** 触发下一个“重启”定时器（排除 60 秒的健康计时） */
    fireRetry() {
      for (const [id, t] of queue) {
        if (t.ms < 60000) {
          queue.delete(id);
          t.fn();
          return t.ms;
        }
      }
      return null;
    },
    pendingRetries: () => [...queue.values()].filter((t) => t.ms < 60000).length,
  };
}

/** 假 harness：真的拉起一个子进程（假内核），按 modes 依次决定每次启动的结局 */
function fakeHarnessFactory(modes) {
  const launches = [];
  const children = [];
  let i = 0;
  const factory = async (launch) => {
    launches.push(launch);
    const mode = modes[Math.min(i++, modes.length - 1)];
    let child = null;
    return {
      get child() {
        return child;
      },
      start() {
        child = spawn(process.execPath, [FAKE, mode], { env: { ...launch.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
        children.push(child);
        return new Promise((resolve, reject) => {
          child.stdout.once('data', (d) => (String(d).includes('ready') ? resolve() : reject(new Error('没准备好'))));
          child.once('exit', (code) => reject(new Error(`假内核启动失败（${code}）`)));
        });
      },
      async run(text) {
        return `回：${text}`;
      },
      close() {
        if (!child || child.exitCode != null) return Promise.resolve();
        return new Promise((r) => {
          child.once('exit', r);
          child.stdin.end();
        });
      },
    };
  };
  return { factory, launches, children };
}

const gateway = { start: async () => ({ url: 'http://127.0.0.1:45678', token: 'tok-test-0123456789' }), info: () => ({ lastError: null }) };
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitFor = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-dshrt-'));
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('DSH 运行时：子进程退出后会重启，间隔越来越长', async () => {
  const t = tmp();
  const timers = fakeTimers();
  const h = fakeHarnessFactory(['die']);
  const rt = createDshRuntime({ userData: t.dir, gateway, createHarness: h.factory, timers, execPath: 'dafeiyu.exe', entry: 'bin.js' });
  try {
    await rt.start();
    assert.equal(rt.status().state, 'running');
    const delays = [];
    for (let k = 0; k < 3; k++) {
      assert.ok(await waitFor(() => timers.pendingRetries() > 0), `第 ${k + 1} 次退出后应该排了重启`);
      assert.equal(rt.status().state, 'starting');
      delays.push(timers.fireRetry());
      assert.ok(await waitFor(() => rt.status().state === 'running' || timers.pendingRetries() > 0));
    }
    assert.deepEqual(delays, [2000, 4000, 8000]);
    assert.equal(rt.status().restarts, 3);
    assert.match(rt.status().lastError || '', /意外退出/);
  } finally {
    await rt.stop();
    t.done();
  }
});

test('DSH 运行时：连续失败 5 次后停止，状态是 crashed', async () => {
  const t = tmp();
  const timers = fakeTimers();
  const h = fakeHarnessFactory(['fail']);
  const rt = createDshRuntime({ userData: t.dir, gateway, createHarness: h.factory, timers });
  try {
    await assert.rejects(rt.start(), /启动失败/);
    for (let k = 0; k < 10 && timers.pendingRetries(); k++) {
      timers.fireRetry();
      await waitFor(() => timers.pendingRetries() > 0 || rt.status().state === 'crashed');
    }
    assert.equal(rt.status().state, 'crashed');
    assert.equal(h.launches.length, 5, '一共试了 5 次');
    assert.equal(timers.pendingRetries(), 0, '不再排重启');
    assert.deepEqual(timers.scheduled.filter((ms) => ms < 60000), [2000, 4000, 8000, 16000]);
    // 用户点“重新启动”可以再来（这次假内核也还是起不来，但会重新计数）
    await assert.rejects(rt.restart(), /启动失败/);
    assert.equal(h.launches.length, 6);
    assert.equal(rt.status().state, 'starting');
  } finally {
    await rt.stop();
    t.done();
  }
});

test('DSH 运行时：传给子进程的环境变量里没有 DeepSeek Key', async () => {
  const t = tmp();
  const saved = { ...process.env };
  process.env.DEEPSEEK_API_KEY = 'sk-real-key-should-not-leak';
  process.env.DFY_API_BASE = 'https://api.deepseek.com';
  process.env.SOME_SECRET = 'x';
  const h = fakeHarnessFactory(['ok']);
  const rt = createDshRuntime({ userData: t.dir, gateway, createHarness: h.factory, execPath: 'dafeiyu.exe', entry: 'bin.js' });
  try {
    await rt.start();
    const { env, command, args, cwd } = h.launches[0];
    assert.equal(env.DEEPSEEK_API_KEY, undefined);
    assert.ok(!JSON.stringify(env).includes('sk-real-key'));
    assert.equal(env.SOME_SECRET, undefined);
    assert.equal(env.DFY_API_BASE, undefined);
    assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(env.DFY_GATEWAY_TOKEN, 'tok-test-0123456789', '它的“Key”是网关的临时令牌');
    assert.equal(env.DSH_HOME, path.join(t.dir, 'dsh'), '数据目录在大肥鱼自己的目录里，不是 ~/.dsh');
    const allowed = new Set(['ELECTRON_RUN_AS_NODE', 'DSH_HOME', 'DFY_GATEWAY_TOKEN', ...ENV_PASSTHROUGH]);
    for (const k of Object.keys(env)) assert.ok(allowed.has(k), `多传了 ${k}`);
    assert.equal(command, 'dafeiyu.exe', '用大肥鱼自己当 Node');
    assert.deepEqual(args, ['--expose-internals', 'bin.js', path.join(t.dir, 'dsh', 'profile', 'cordis.yml')]);
    assert.equal(cwd, path.join(t.dir, 'dsh', 'work'));
    assert.ok(fs.readFileSync(args[2], 'utf8').includes("baseURL: 'http://127.0.0.1:45678'"));
    assert.deepEqual(childEnv({ dshHome: 'h', token: 't', source: { PATH: 'p', DEEPSEEK_API_KEY: 'k' } }), { ELECTRON_RUN_AS_NODE: '1', DSH_HOME: 'h', DFY_GATEWAY_TOKEN: 't', PATH: 'p' });
  } finally {
    await rt.stop();
    process.env = saved;
    t.done();
  }
});

test('DSH 运行时：stop 之后没有残留进程', async () => {
  const t = tmp();
  const h = fakeHarnessFactory(['ok']);
  const rt = createDshRuntime({ userData: t.dir, gateway, createHarness: h.factory });
  try {
    const st = await rt.start();
    assert.equal(st.state, 'running');
    const pid = st.pid;
    assert.ok(pid && alive(pid));
    assert.equal(await rt.say('你好'), '回：你好');
    await rt.stop();
    assert.ok(await waitFor(() => !alive(pid)), '进程已经结束');
    assert.equal(rt.status().state, 'stopped');
    assert.equal(rt.status().pid, null);
    assert.match(fs.readFileSync(path.join(t.dir, 'logs', 'dsh.log'), 'utf8'), /假内核：已启动/, '标准错误写进了 dsh.log');
  } finally {
    await rt.stop();
    t.done();
  }
});

test('DSH 运行时：没启动时说话会先启动；手动杀掉进程后自动拉起', async () => {
  const t = tmp();
  const timers = fakeTimers();
  const h = fakeHarnessFactory(['ok']);
  const rt = createDshRuntime({ userData: t.dir, gateway, createHarness: h.factory, timers });
  try {
    assert.equal(rt.status().state, 'stopped');
    assert.equal(await rt.say('在吗'), '回：在吗');
    const pid = rt.status().pid;
    h.children[0].kill();
    assert.ok(await waitFor(() => timers.pendingRetries() > 0));
    timers.fireRetry();
    assert.ok(await waitFor(() => rt.status().state === 'running'));
    assert.notEqual(rt.status().pid, pid);
    assert.equal(await rt.say('还在吗'), '回：还在吗');
  } finally {
    await rt.stop();
    t.done();
  }
});
