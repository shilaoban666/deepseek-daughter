// 内嵌 DSH 的子进程：启动、守护、关闭。
//
// - 用大肥鱼自己（process.execPath + ELECTRON_RUN_AS_NODE=1）当 Node 运行 dsh-jsonrpc-agent，用户电脑上不需要装 Node。
// - DSH 的数据目录是 <userData>/dsh（DSH_HOME），绝不碰用户自己的 ~/.dsh。
// - 环境变量只给白名单里的几项。不给 DEEPSEEK_API_KEY：DSH 永远拿不到真的 Key，它的“Key”是生命网关的临时令牌。
// - 进程意外退出后按 2、4、8……最长 60 秒的间隔重启；连续失败 5 次停下来，状态是 crashed，等用户点“重新启动”。

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const dshConfig = require('./config');

const ENV_PASSTHROUGH = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
const MAX_FAILURES = 5;
const HEALTHY_MS = 60000; // 稳定运行这么久，连续失败计数清零
const SAY_TIMEOUT_MS = 130000;
const STOP_WAIT_MS = 5000;
const LOG_MAX = 2 * 1024 * 1024;

/** dsh-jsonrpc-agent 的入口。packaged-bin 按已安装的包树解析插件名，所以 cordis.yml 可以放在数据目录里 */
function resolveEntry() {
  const main = require.resolve('@deepseek-ai/dsh-sdk-jsonrpc-demo');
  const entry = path.join(path.dirname(main), 'packaged-bin.js');
  // 打包后 node_modules 在 app.asar 里；子进程要读的文件放在 app.asar.unpacked（见 package.json 的 asarUnpack）
  const unpacked = entry.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return unpacked !== entry && fs.existsSync(unpacked) ? unpacked : entry;
}

function packageVersion(name) {
  try {
    const dir = path.dirname(require.resolve(name));
    for (let d = dir, i = 0; i < 4; i++, d = path.dirname(d)) {
      const f = path.join(d, 'package.json');
      if (fs.existsSync(f)) {
        const p = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (p.name === name) return p.version;
      }
    }
  } catch {
    /* 没装 */
  }
  return null;
}

/** 子进程的完整环境：只有白名单 */
function childEnv({ dshHome, token, source = process.env }) {
  const env = { ELECTRON_RUN_AS_NODE: '1', DSH_HOME: dshHome, DFY_GATEWAY_TOKEN: token };
  for (const k of ENV_PASSTHROUGH) if (source[k] != null) env[k] = source[k];
  return env;
}

/** 默认的 harness：SDK 客户端（ES 模块，按需加载） */
async function sdkHarness(launch) {
  const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client');
  const h = new DeepSeekHarness({ launch, cwd: launch.cwd, provider: 'deepseek-official', model: 'deepseek-chat' });
  return {
    start: () => h.start(),
    get child() {
      return h.client?.child;
    },
    async run(text) {
      // 不传 sessionId：每句话一个新会话，DSH 那边不会越攒越多历史（她的历史在她自己那里）
      const r = await h.run(text);
      return r.finalResponse || '';
    },
    close: () => h.close(),
  };
}

/** 追加写日志，超过 2 MB 轮转，保留 2 份旧的 */
function appender(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (text) => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX) {
        if (fs.existsSync(`${file}.1`)) fs.renameSync(`${file}.1`, `${file}.2`);
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, text);
    } catch {
      /* 日志写不了不影响运行 */
    }
  };
}

/**
 * @param {object} deps
 * @param {string} deps.userData
 * @param {{start:()=>Promise<{url:string, token:string}>, info?:()=>{lastError?:string|null}}} deps.gateway
 * @param {(level:string, msg:string)=>void} [deps.log]
 * @param {(launch:object)=>Promise<{start:()=>Promise<void>, run:(t:string)=>Promise<string>, close:()=>Promise<void>, child?:import('child_process').ChildProcess}>} [deps.createHarness]
 */
function createDshRuntime({ userData, gateway, log = () => {}, createHarness = sdkHarness, execPath = process.execPath, entry = null, now = Date.now, timers = { setTimeout, clearTimeout }, maxFailures = MAX_FAILURES } = {}) {
  const ev = new EventEmitter();
  const dshHome = path.join(userData, 'dsh');
  const workDir = path.join(dshHome, 'work'); // 子进程的工作目录：空目录（DSH 启动时会读当前目录的 .env）
  const writeLog = appender(path.join(userData, 'logs', 'dsh.log'));

  let state = 'stopped';
  let harness = null;
  let pid = null;
  let since = null;
  let lastError = null;
  let restarts = 0;
  let failures = 0;
  let plugins = [];
  let retryTimer = null;
  let healthyTimer = null;
  let starting = null;
  let stopping = false;
  let lastEnv = null;

  const version = packageVersion('@deepseek-ai/dsh-sdk-jsonrpc-demo');

  function status() {
    return { state, pid, since, version, plugins, lastError, restarts, dataDir: dshHome };
  }
  function setState(s) {
    state = s;
    ev.emit('status', status());
  }

  function clearTimers() {
    if (retryTimer) timers.clearTimeout(retryTimer);
    if (healthyTimer) timers.clearTimeout(healthyTimer);
    retryTimer = healthyTimer = null;
  }

  function backoff(n) {
    return Math.min(60000, 2000 * 2 ** Math.max(0, n - 1));
  }

  /** 失败一次：没超过上限就按退避时间重试，超过就停在 crashed */
  function failed(err) {
    failures += 1;
    lastError = err?.message || String(err);
    harness = null;
    pid = null;
    if (failures >= maxFailures) {
      log('error', `内核连续失败 ${failures} 次，停止重试：${lastError}`);
      writeLog(`[${new Date(now()).toISOString()}] 连续失败 ${failures} 次，停止重试\n`);
      return setState('crashed');
    }
    const delay = backoff(failures);
    log('warn', `内核出错（第 ${failures} 次），${delay / 1000} 秒后重启：${lastError}`);
    setState('starting');
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      restarts += 1;
      launch().catch(() => {});
    }, delay);
  }

  async function launch() {
    if (stopping) return;
    let h = null;
    try {
      h = await spawnAndHandshake();
    } catch (err) {
      // 握手失败：SDK 已经回收了它拉起的进程，这里再关一次保证干净
      const half = harness;
      harness = null;
      if (half) await half.close().catch(() => {});
      if (!stopping) failed(err);
      throw err;
    }
    if (!h || stopping || harness !== h) return;
    watch(h);
  }

  async function spawnAndHandshake() {
    const gw = await gateway.start();
    const configPath = dshConfig.writeConfig({ userData, gatewayUrl: gw.url });
    plugins = dshConfig.pluginNames(fs.readFileSync(configPath, 'utf8')).map((name) => ({ name, version: packageVersion(name) }));
    fs.mkdirSync(workDir, { recursive: true });
    const env = childEnv({ dshHome, token: gw.token });
    lastEnv = env;
    // --expose-internals：DSH 的插件加载器靠 Node 内部的模块加载器，才能从安装目录（而不是 cordis.yml 所在的数据目录）解析插件名。
    // 这是 DSH 支持的两条路之一（另一条是原生模块 node-addon-require-builtin，我们不装原生模块）。
    const h = await createHarness({ command: execPath, args: ['--expose-internals', entry || resolveEntry(), configPath], cwd: workDir, env });
    harness = h;
    await h.start();
    return h;
  }

  /** 握手成功：记下进程号，盯住它的退出 */
  function watch(h) {
    const child = h.child;
    pid = child?.pid ?? null;
    since = now();
    // lastError 不清：内核页要能看到“最近一次错误”，哪怕已经自动恢复了
    child?.stderr?.on('data', (d) => writeLog(String(d)));
    child?.once('exit', (code, signal) => {
      if (harness !== h || stopping) return;
      writeLog(`[${new Date(now()).toISOString()}] 内核进程退出 code=${code} signal=${signal}\n`);
      h.close().catch(() => {});
      clearTimers();
      failed(new Error(`内核进程意外退出（${signal || code}）`));
    });
    healthyTimer = timers.setTimeout(() => {
      healthyTimer = null;
      failures = 0;
    }, HEALTHY_MS);
    writeLog(`[${new Date(since).toISOString()}] 内核已启动 pid=${pid}\n`);
    log('info', `内核已启动（进程 ${pid}）`);
    setState('running');
  }

  async function start() {
    if (state === 'running') return status();
    if (starting) return starting;
    stopping = false;
    clearTimers();
    if (state === 'crashed' || state === 'stopped') failures = 0;
    setState('starting');
    starting = launch()
      .then(() => status())
      .finally(() => {
        starting = null;
      });
    return starting;
  }

  async function stop() {
    stopping = true;
    clearTimers();
    const h = harness;
    const child = h?.child;
    harness = null;
    if (h) {
      let timer;
      await Promise.race([h.close().catch(() => {}), new Promise((r) => (timer = timers.setTimeout(r, STOP_WAIT_MS)))]);
      timers.clearTimeout(timer);
    }
    // 协议关闭没在 5 秒内走完：直接结束进程，保证不留残留
    if (child && child.exitCode == null && child.signalCode == null) {
      try {
        child.kill();
      } catch {
        /* 已经没了 */
      }
    }
    pid = null;
    since = null;
    setState('stopped');
    return status();
  }

  async function restart() {
    await stop();
    failures = 0;
    restarts += 1;
    return start();
  }

  async function say(text) {
    if (state !== 'running') await start();
    if (!harness) throw new Error('内核没有在运行');
    let timer;
    try {
      const reply = await Promise.race([
        harness.run(String(text)),
        new Promise((_, reject) => (timer = timers.setTimeout(() => reject(new Error('等了太久，内核没有回复')), SAY_TIMEOUT_MS))),
      ]);
      if (!reply) throw new Error(gateway.info?.().lastError || '内核没有返回回复');
      return reply;
    } finally {
      timers.clearTimeout(timer);
    }
  }

  return {
    start,
    stop,
    restart,
    say,
    status,
    on: (name, fn) => ev.on(name, fn),
    off: (name, fn) => ev.off(name, fn),
    /** 测试用：最近一次传给子进程的环境变量 */
    _lastEnv: () => lastEnv,
  };
}

module.exports = { createDshRuntime, childEnv, resolveEntry, ENV_PASSTHROUGH };
