// 端到端测试：启动真实的 Electron 应用，用假 DeepSeek 把主流程走一遍。
//   npm run e2e
// 每个场景用独立的临时存档，不会碰到你自己的数据。

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const electron = require('electron');

const body = require('../src/main/body');
const life = require('../src/main/life');
const { JsonStore } = require('../src/main/store');

const root = path.resolve(__dirname, '..');
const base = path.join(root, '.shots-data', `e2e-${process.pid}`);

function seed(dir, patch) {
  const now = Date.now();
  const b = body.initialBody(now);
  const s = { ...life.initialState(now), lastTick: now, asleep: false };
  patch(b, s);
  b.lastTick = now;
  const store = new JsonStore(path.join(dir, 'data'));
  store.save('body', b);
  store.save('state', s);
}

// 升级场景：.testdata/upgrade 是用旧版本 Electron 生成的存档（带加密的 Key），只在本机有。
// 生成方法见 docs/notes/electron-upgrade.md；没有这个目录就跳过。
const UPGRADE_FIXTURE = path.join(root, '.testdata', 'upgrade');

const SCENARIOS_ALL = [
  // 内核：真的拉起内嵌的 DSH。跑完检查没有残留进程，也没动过你自己的 ~/.dsh
  { name: 'kernel', dir: 'kernel', after: kernelAfter },
  { name: 'main', dir: 'main' },
  { name: 'restart', dir: 'main' },
  { name: 'fever', dir: 'fever', seed: (b) => { b.fever = true; b.immunity = 40; b.temp = 38.1; } },
  { name: 'hungry', dir: 'hungry', seed: (b, s) => { s.satiety = 10; b.stomach = 0; b.intestine = 0; } },
  { name: 'upgrade', dir: 'upgrade', copyFrom: UPGRADE_FIXTURE },
  // 刚主动找过人、也不孤单：启动后不会马上开口，存档里保持一条记忆都没有
  // 鲸鱼娘素材不存在：指向一个空目录
  { name: 'noskin', dir: 'noskin', env: { DFY_PET_DIR: path.join(base, 'no-pet-skin') } },
  { name: 'empty', dir: 'empty', seed: (b, s) => { s.social = 90; s.mood = 0.1; s.lastProactiveAt = Date.now(); s.lastUserAt = Date.now(); } },
];
// 只跑部分场景：E2E_ONLY=hungry,upgrade npm run e2e
const SCENARIOS = process.env.E2E_ONLY ? SCENARIOS_ALL.filter((s) => process.env.E2E_ONLY.split(',').includes(s.name)) : SCENARIOS_ALL;

const os = require('os');
const { execFileSync } = require('child_process');
const USER_DSH = path.join(os.homedir(), '.dsh');

/** ~/.dsh 顶层目录和每一项的修改时间（只读 stat，不打开任何文件）；目录不存在返回 null */
function dshStamp() {
  if (!fs.existsSync(USER_DSH)) return null;
  const top = fs.statSync(USER_DSH).mtimeMs;
  const items = fs.readdirSync(USER_DSH).sort().map((n) => `${n}:${fs.statSync(path.join(USER_DSH, n)).mtimeMs}`);
  return JSON.stringify({ top, items });
}

function alive(pid) {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' });
    return out.includes(String(pid));
  } catch {
    return false;
  }
}

let dshBefore;
async function kernelAfter(data) {
  let ok = true;
  const file = path.join(data, 'dsh-pids.txt');
  const pids = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\s+/).filter(Boolean).map(Number) : [];
  await new Promise((r) => setTimeout(r, 1000));
  const left = pids.filter(alive);
  const pass = pids.length > 0 && left.length === 0;
  console.log(`${pass ? '  ✓' : '  ✗'} 内核：退出应用后没有残留进程  (${pids.length} 个内核进程${left.length ? `，还活着：${left.join(',')}` : ''})`);
  ok = ok && pass;
  const after = dshStamp();
  if (dshBefore === null && after === null) console.log('  · 内核：你自己的 DSH 目录不存在，跳过检查');
  else {
    const same = dshBefore === after;
    console.log(`${same ? '  ✓' : '  ✗'} 内核：你自己的 DSH 目录没被动过`);
    ok = ok && same;
  }
  return ok;
}

function run({ name, dir, seed: patch, copyFrom, env: extraEnv, after }) {
  if (name === 'kernel') dshBefore = dshStamp();
  const data = path.join(base, dir);
  if (copyFrom) {
    if (!fs.existsSync(copyFrom)) {
      console.log(`E2E ${name}：跳过（没有 ${path.relative(root, copyFrom)}）`);
      return Promise.resolve(true);
    }
    fs.cpSync(copyFrom, data, { recursive: true });
  }
  fs.mkdirSync(data, { recursive: true });
  if (patch) seed(data, patch);
  const env = { ...process.env, DFY_DATA_DIR: data, E2E_SCENARIO: name, ...(extraEnv || {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DFY_SHOT;
  return new Promise((resolve) => {
    const child = spawn(electron, [path.join(__dirname, 'e2e-main.js'), '--no-sandbox'], { cwd: root, env, stdio: 'inherit' });
    const timer = setTimeout(() => { console.log(`E2E ${name}: 超时`); child.kill(); }, 180000);
    child.on('exit', async (code) => {
      clearTimeout(timer);
      const extra = after ? await after(data) : true;
      resolve(code === 0 && extra);
    });
  });
}

(async () => {
  let ok = true;
  for (const s of SCENARIOS) {
    console.log(`\n=== 场景：${s.name} ===`);
    ok = (await run(s)) && ok;
  }
  fs.rmSync(base, { recursive: true, force: true });
  console.log(ok ? '\nE2E 全部通过' : '\nE2E 有失败');
  process.exit(ok ? 0 : 1);
})();
