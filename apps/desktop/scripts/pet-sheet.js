// 出鲸鱼娘的样张：15 个动作、13 个反应、8 种心情各截一张代表画面，拼成一张大图。
//   npm run pet:sheet          → apps/desktop/.shots/pet-sheet.png
// 用临时存档，不碰你自己的数据。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const electron = require('electron');

const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  // 用 Electron 重新运行自己
  const data = path.join(root, '.shots-data', 'pet-sheet');
  fs.rmSync(data, { recursive: true, force: true });
  const env = { ...process.env, DFY_DATA_DIR: data, PET_SHEET: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [__filename], { cwd: root, env, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  return;
}

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
require('../src/main/main.js');

const manifest = require('../assets/pet/whale-girl/pet.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ITEMS = [
  ['动作 · 睡觉', manifest.sleep.loop],
  ...Object.entries(manifest.actions).map(([k, v]) => [`动作 · ${k}`, v[0]]),
  ['动作 · 吃饭（午饭）', manifest.meals['午饭'][0]],
  ['动作 · 闲着', manifest.fallbackClip],
  ...Object.entries(manifest.reactions).map(([k, v]) => [`反应 · ${k}`, k === 'poke' ? v.good[0] : v[0]]),
  ['反应 · 钱包（最富）', manifest.balance.clips[5]],
  ...Object.entries(manifest.moods).map(([k, v]) => [`心情 · ${k}`, v.clips[0]]),
];

app.whenReady().then(async () => {
  await sleep(1500);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (code) => win.webContents.executeJavaScript(code, true);
  win.setContentSize(1440, 900);
  for (let i = 0; i < 60 && !(await js('window.__fishReady === true')); i++) await sleep(250);
  await js("window.__go('overview/now')");
  await sleep(1500);
  if (!(await js('!!window.__petNow()'))) {
    console.error('没有鲸鱼娘素材，出不了样张');
    app.exit(1);
  }
  const shots = [];
  for (const [label, clip] of ITEMS) {
    await js(`window.__petPlay(${JSON.stringify(clip)})`);
    // 动画开头都是从待机姿势起步（为了能无缝衔接），截中段才看得出是什么动作
    await sleep(5000);
    const r = await js("(()=>{const b=document.querySelector('.pet-stage').getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),width:Math.round(b.width),height:Math.round(b.height)}})()");
    await win.webContents.capturePage(r);
    await sleep(150);
    const img = await win.webContents.capturePage(r);
    shots.push({ label: `${label}：${clip}`, url: img.toDataURL() });
    process.stdout.write('.');
  }
  // 在页面里用 canvas 拼图
  const png = await js(`(async () => {
    const shots = ${JSON.stringify(shots)};
    const cols = 5, w = 360, h = 220, pad = 8, lh = 22;
    const rows = Math.ceil(shots.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * (w + pad) + pad; c.height = rows * (h + lh + pad) + pad;
    const g = c.getContext('2d');
    g.fillStyle = '#0a1222'; g.fillRect(0, 0, c.width, c.height);
    g.font = '13px "Microsoft YaHei UI", sans-serif';
    for (let i = 0; i < shots.length; i++) {
      const img = new Image(); img.src = shots[i].url; await img.decode();
      const x = pad + (i % cols) * (w + pad), y = pad + Math.floor(i / cols) * (h + lh + pad);
      g.fillStyle = '#121d33'; g.fillRect(x, y, w, h);
      const s = Math.min(w / img.width, h / img.height);
      g.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
      g.fillStyle = '#c6d6ee'; g.fillText(shots[i].label, x + 4, y + h + 16);
    }
    return c.toDataURL('image/png');
  })()`);
  const out = path.join(root, '.shots', 'pet-sheet.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`\n样张：${out}（${shots.length} 张）`);
  app.exit(0);
});
