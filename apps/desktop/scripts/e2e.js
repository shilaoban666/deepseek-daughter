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

const SCENARIOS = [
  { name: 'main', dir: 'main' },
  { name: 'restart', dir: 'main' },
  { name: 'fever', dir: 'fever', seed: (b) => { b.fever = true; b.immunity = 40; b.temp = 38.1; } },
  { name: 'hungry', dir: 'hungry', seed: (b, s) => { s.satiety = 10; b.stomach = 0; b.intestine = 0; } },
  { name: 'upgrade', dir: 'upgrade', copyFrom: UPGRADE_FIXTURE },
];

function run({ name, dir, seed: patch, copyFrom }) {
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
  const env = { ...process.env, DFY_DATA_DIR: data, E2E_SCENARIO: name };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DFY_SHOT;
  return new Promise((resolve) => {
    const child = spawn(electron, [path.join(__dirname, 'e2e-main.js'), '--no-sandbox'], { cwd: root, env, stdio: 'inherit' });
    const timer = setTimeout(() => { console.log(`E2E ${name}: 超时`); child.kill(); }, 180000);
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0); });
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
