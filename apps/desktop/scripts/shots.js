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

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // 有些终端（比如被包装过的 Agent 环境）会设这个变量，Electron 会退化成纯 Node

const args = ['.'];
// 无显卡/远程桌面环境可以用 DFY_DISABLE_GPU=1 跑通截图
if (process.env.DFY_DISABLE_GPU) args.push('--disable-gpu', '--no-sandbox');

// DFY_SHOT_PREVIEW=1：插件页的一组截图（总览、各个抽屉、QQ 的四种预览状态），不截别的页面
const PREVIEW_SCENES = [
  {
    name: '01-插件页总览',
    // 隐藏窗口只在截屏时才推进动画，抽屉的滑入会被截在半路，截图时关掉动画
    js: `document.head.insertAdjacentHTML('beforeend', '<style>*{animation:none!important;transition:none!important}</style>'); window.__channelOpen(null)`,
  },
  { name: '02-QQ抽屉-没填', js: `window.__channelOpen('qq')` },
  {
    name: '03-QQ抽屉-填错了',
    js: `(async () => {
      const set = (k, v) => { const i = document.querySelector('[data-field="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('input')); };
      set('ownerQQ', '1234'); set('groups', '10001, abc');
      document.querySelector('[data-save]').click();
    })()`,
  },
  {
    name: '04-QQ抽屉-已保存',
    wait: 1200,
    js: `(async () => {
      const set = (k, v) => { const i = document.querySelector('[data-field="' + k + '"]'); i.value = v; i.dispatchEvent(new Event('input')); };
      set('ownerQQ', '12345678'); set('groups', '10001，20002');
      document.querySelector('[data-save]').click();
      await new Promise((r) => setTimeout(r, 500));
      document.querySelector('[data-secret="generate"]').click();
      await new Promise((r) => setTimeout(r, 500));
      document.querySelector('.drawer details').open = true;
    })()`,
  },
  { name: '05-插件页总览-QQ已保存', js: `window.__channelOpen(null)` },
  { name: '06-微信抽屉', js: `window.__channelOpen('wechat')` },
  { name: '07-B站抽屉', js: `window.__channelOpen('bilibili')` },
  { name: '08-QQ预览-连接中', js: `window.__channelOpen('qq'); window.__channelPreview('qq', 'connecting')` },
  { name: '09-QQ预览-已连接', js: `window.__channelPreview('qq', 'online', '3 分钟前收到过消息')` },
  { name: '10-QQ预览-出错', js: `window.__channelPreview('qq', 'error', '端口 8643 被别的程序占用了', '换一个端口，或者关掉占用它的程序')` },
  { name: '11-QQ预览-已关闭', js: `window.__channelPreview('qq', 'off')` },
  { name: '12-插件页总览-预览状态', js: `window.__channelOpen(null)` },
];
const preview = process.env.DFY_SHOT_PREVIEW === '1';
if (preview) fs.rmSync(data, { recursive: true, force: true }); // 每次从“还没设置”开始
fs.mkdirSync(data, { recursive: true });

const child = spawn(electron, args, {
  cwd: root,
  env: {
    ...env,
    DFY_SHOT: out,
    DFY_DATA_DIR: data,
    DFY_SHOT_VIEWS: preview ? 'explore/platforms' : process.env.DFY_SHOT_VIEWS || '',
    DFY_SHOT_SCENES: preview ? JSON.stringify(PREVIEW_SCENES) : process.env.DFY_SHOT_SCENES || '',
    DFY_SHOT_SAY: process.env.DFY_SHOT_SAY || '',
  },
  stdio: 'inherit',
});
child.on('exit', (code) => {
  if (code === 0) console.log(`截图输出到 ${out}`);
  process.exit(code ?? 0);
});
