// 开发用：用 Electron 依次截下三个界面，输出到 apps/desktop/.shots/。
// 数据目录用系统临时目录，不会碰到你自己的存档。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const electron = require('electron');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.shots');
const data = path.join(root, '.shots-data');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(data, { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // 有些终端（比如被包装过的 Agent 环境）会设这个变量，Electron 会退化成纯 Node

const args = ['.'];
// 无显卡/远程桌面环境可以用 DFY_DISABLE_GPU=1 跑通截图
if (process.env.DFY_DISABLE_GPU) args.push('--disable-gpu', '--no-sandbox');

const child = spawn(electron, args, {
  cwd: root,
  env: {
    ...env,
    DFY_SHOT: out,
    DFY_DATA_DIR: data,
    DFY_SHOT_VIEWS: process.env.DFY_SHOT_VIEWS || 'brain,life,links',
    DFY_SHOT_SAY: process.env.DFY_SHOT_SAY || '',
  },
  stdio: 'inherit',
});
child.on('exit', (code) => {
  if (code === 0) console.log(`截图输出到 ${out}`);
  process.exit(code ?? 0);
});
