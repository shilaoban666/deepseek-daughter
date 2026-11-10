// Electron 主进程

const { app, BrowserWindow, ipcMain, Notification, safeStorage, shell, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { JsonStore } = require('./store');
const { Daughter } = require('./daughter');
const { APP_NAME, nameOf } = require('./persona');
const { DEFAULT_BASE } = require('./deepseek');

const DEFAULT_MODEL = 'deepseek-chat';

app.setName(APP_NAME);

// 鲸鱼娘的动画走自定义协议 pet://<皮肤>/<文件名>.webm。页面的 CSP 只放行 media-src pet:，
// 这样页面本身仍然读不了任意本地文件；协议处理器只认皮肤目录 clips/ 下的 .webm。
protocol.registerSchemesAsPrivileged([{ scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

/** 皮肤目录：DFY_PET_DIR 优先（测试用），否则是 assets/pet/<皮肤>；打包后从 app.asar.unpacked 读 */
function petDir(skin) {
  if (process.env.DFY_PET_DIR) return path.resolve(process.env.DFY_PET_DIR);
  return path.join(__dirname, '..', '..', 'assets', 'pet', skin).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

/** 读皮肤：映射表 + 实际有哪些动画文件。素材被删掉（比如商用时）就返回 null，界面改用 3D 鲸鱼 */
function loadPetSkin(skin) {
  try {
    const dir = petDir(skin);
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'pet', skin, 'pet.json'), 'utf8'));
    const clipsDir = path.join(dir, 'clips');
    const available = fs.existsSync(clipsDir) ? fs.readdirSync(clipsDir).filter((f) => f.endsWith('.webm')).map((f) => f.slice(0, -5)) : [];
    if (!available.length) return null;
    let source = null;
    try { source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8')); } catch { /* 没有也行 */ }
    return { skin, manifest, available, baseUrl: `pet://${skin}`, source };
  } catch (err) {
    console.warn('[pet] 读不了皮肤，改用 3D 鲸鱼：', err.message);
    return null;
  }
}
if (process.env.DFY_DATA_DIR) {
  const dir = path.resolve(process.env.DFY_DATA_DIR);
  fs.mkdirSync(dir, { recursive: true }); // 目录不存在时单实例锁会失败
  app.setPath('userData', dir);
}
if (process.platform === 'win32') app.setAppUserModelId('io.github.shilaoban666.deepseekdaughter');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let daughter = null;
  let store = null;
  let settings = null;

  // ---------- 设置（API Key 用系统加密保存） ----------
  // Electron 45 起同步的 encryptString/decryptString 已过时（46 删除），统一用异步接口。
  // 旧版本用 encryptString 存下的数据，decryptStringAsync 可以直接解开。
  async function loadSettings() {
    const raw = store.load('settings', {});
    let apiKey = '';
    if (raw.apiKeyEnc && (await safeStorage.isAsyncEncryptionAvailable())) {
      try {
        const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(raw.apiKeyEnc, 'base64'));
        apiKey = result;
        if (shouldReEncrypt && apiKey) {
          raw.apiKeyEnc = (await safeStorage.encryptStringAsync(apiKey)).toString('base64');
          store.save('settings', raw);
        }
      } catch {
        apiKey = '';
      }
    } else if (raw.apiKeyPlain) {
      apiKey = raw.apiKeyPlain;
    }
    return {
      apiKey: process.env.DEEPSEEK_API_KEY || apiKey,
      baseUrl: process.env.DFY_API_BASE || raw.baseUrl || DEFAULT_BASE,
      model: raw.model || DEFAULT_MODEL,
      userName: raw.userName || '',
      userTitle: raw.userTitle || '',
      onebotUrl: raw.onebotUrl || '',
      daughterName: raw.daughterName || '',
    };
  }

  async function saveSettings(next) {
    const raw = store.load('settings', {});
    if (typeof next.apiKey === 'string' && next.apiKey.trim()) {
      const key = next.apiKey.trim();
      delete raw.apiKeyEnc;
      delete raw.apiKeyPlain;
      if (await safeStorage.isAsyncEncryptionAvailable()) raw.apiKeyEnc = (await safeStorage.encryptStringAsync(key)).toString('base64');
      else raw.apiKeyPlain = key;
    }
    for (const k of ['model', 'userName', 'userTitle', 'baseUrl', 'onebotUrl', 'daughterName']) {
      if (typeof next[k] === 'string') raw[k] = next[k].trim();
    }
    store.save('settings', raw);
    settings = await loadSettings();
  }

  const publicSettings = () => ({
    hasKey: !!settings.apiKey,
    model: settings.model,
    userName: settings.userName,
    userTitle: settings.userTitle,
    baseUrl: settings.baseUrl,
    onebotUrl: settings.onebotUrl,
    daughterName: nameOf(settings),
  });

  // ---------- 窗口 ----------
  function send(channel, ...args) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      title: APP_NAME,
      backgroundColor: '#060a14',
      autoHideMenuBar: true,
      show: !process.env.DFY_SHOT || process.env.DFY_SHOT_SHOW === '1', // 开发截图时不弹出窗口
      webPreferences: {
        backgroundThrottling: !process.env.DFY_SHOT,
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    // Electron 35 起事件参数改成一个对象，level 是字符串
    if (process.env.DFY_SHOT) win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));
    // 外部链接用系统浏览器打开，不在应用里跳转
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
  }

  function notify(text) {
    if (win && win.isFocused()) return;
    if (Notification.isSupported()) {
      const n = new Notification({ title: nameOf(settings), body: text.split('\n')[0] });
      n.on('click', () => {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      });
      n.show();
    }
    if (win) win.flashFrame(true);
  }

  // 开发用：依次截下三个界面后退出（DFY_SHOT=输出目录）
  async function shoot(dir) {
    const fs = require('fs');
    fs.mkdirSync(dir, { recursive: true });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // 页面可能已经加载完，别等一个永远不来的事件
    if (win.webContents.isLoadingMainFrame()) await new Promise((r) => win.webContents.once('did-finish-load', r));
    await wait(2500);
    for (const say of (process.env.DFY_SHOT_SAY || '').split('|').filter(Boolean)) {
      await win.webContents.executeJavaScript(`(() => { const i = document.querySelector('#input'); i.value = ${JSON.stringify(say)}; document.querySelector('#composer').requestSubmit(); })()`);
      await wait(3000);
    }
    // 开发用：在截图前触发一次 IPC（consolidate / backup），检查主进程这条链是不是通的
    for (const act of (process.env.DFY_SHOT_ACTIONS || '').split(',').filter(Boolean)) {
      const r = await win.webContents.executeJavaScript(act === 'backup' ? 'window.fish.backup()' : 'window.fish.consolidate()');
      console.log('[shot] action', act, JSON.stringify(r).slice(0, 200));
      await wait(1500);
    }
    const list = process.env.DFY_SHOT_VIEWS ? process.env.DFY_SHOT_VIEWS.split(',') : await win.webContents.executeJavaScript('window.__routes()');
    for (const r of list) {
      await win.webContents.executeJavaScript(`window.__go(${JSON.stringify(r)})`);
      await wait(Number(process.env.DFY_SHOT_WAIT) || 1500);
      // 隐藏窗口要到截屏时才重绘，第一次拿到的是上一页的画面，所以连拍两次取第二张
      await win.webContents.capturePage();
      await wait(250);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${r.replace('/', '-')}.png`), img.toPNG());
    }
    app.quit();
  }

  // ---------- 启动 ----------
  app.whenReady().then(async () => {
    config.init({ dir: app.getPath('userData') });
    const dataDir = path.join(app.getPath('userData'), 'data');
    store = new JsonStore(dataDir);
    settings = await loadSettings();
    daughter = new Daughter({ store, getSettings: () => settings, dataDir });

    daughter.on('vitals', (v, events) => send('vitals', v, events));
    daughter.on('reply-start', (id) => send('reply-start', id));
    daughter.on('reply-delta', (id, d) => send('reply-delta', id, d));
    daughter.on('reply-end', (id, msg, err) => send('reply-end', id, msg, err));
    daughter.on('proactive', (msg) => {
      send('proactive', msg);
      notify(msg.content);
    });
    daughter.on('memory', (payload) => send('memory', payload));
    daughter.on('profile', (profile) => send('profile', profile));
    daughter.on('thought', (thought) => send('thought', thought));
    daughter.on('diary', (diary) => send('diary', diary.slice(-30)));
    daughter.on('notice', (text) => send('notice', text));
    daughter.on('us', (payload) => send('us', payload));
    daughter.on('error', (err) => {
      console.error('[daughter]', err);
      send('notice', err.message);
    });

    const heartbeatMs = (config.get().heartbeatMinutes || 1) * 60 * 1000;

    // app.getVersion() 在用别的入口启动时（比如端到端测试）会退回 Electron 自己的版本号，直接读 package.json
    const versions = { app: require('../../package.json').version, electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome };
    ipcMain.handle('init', () => ({ name: nameOf(settings), appName: APP_NAME, settings: publicSettings(), versions, petConfig: config.get().pet || {}, ...daughter.snapshot() }));
    ipcMain.handle('refresh-balance', () => daughter.refreshBalance());
    ipcMain.handle('send', async (_e, text) => {
      if (typeof text !== 'string' || !text.trim()) return { ok: false };
      try {
        await daughter.reply(text.trim().slice(0, 4000));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
    ipcMain.handle('save-settings', async (_e, next) => {
      await saveSettings(next || {});
      daughter.refreshBalance().catch(() => {});
      return publicSettings();
    });
    ipcMain.handle('forget', (_e, id) => daughter.forget(String(id)));
    ipcMain.handle('restore-memory', (_e, id) => daughter.restoreMemory(String(id)));
    ipcMain.handle('delete-memory', (_e, id) => daughter.deleteMemory(String(id)));
    ipcMain.handle('edit-memory', (_e, id, text) => daughter.editMemory(String(id), String(text)));
    ipcMain.handle('resolve-conflict', (_e, id, keepId) => daughter.resolveConflict(String(id), String(keepId)));
    ipcMain.handle('undo-growth', (_e, id) => daughter.undoGrowth(String(id)));
    ipcMain.handle('consolidate', () => daughter.consolidateNow({ force: true }));
    ipcMain.handle('receive-external', (_e, payload) => daughter.receiveExternal(payload || {}));
    ipcMain.handle('backup', () => daughter.runBackup(true));
    ipcMain.handle('backups', () => (daughter.backup ? daughter.backup.list() : []));
    ipcMain.handle('usage', () => daughter.snapshot().usageToday);
    // 皮层低模约 6MB。页面的 CSP 不允许 fetch，由主进程读出来传给界面
    ipcMain.handle('cortex', () => {
      const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'cortex', f));
      return { lh: read('lh.lod.bin'), rh: read('rh.lod.bin') };
    });
    const petSkin = loadPetSkin(config.get().pet?.skin || 'whale-girl');
    protocol.handle('pet', (req) => {
      const url = new URL(req.url);
      const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
      // 只认 clips/ 下的 .webm 文件名，不能带路径
      if (!petSkin || url.hostname !== petSkin.skin || !name.endsWith('.webm') || /[\\/]|\.\./.test(name)) return new Response('not found', { status: 404 });
      const file = path.join(petDir(petSkin.skin), 'clips', name);
      if (!fs.existsSync(file)) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(file).href).then((r) => new Response(r.body, { status: r.status, headers: { 'Content-Type': 'video/webm', 'Access-Control-Allow-Origin': '*' } }));
    });
    ipcMain.handle('pet-skin', () => petSkin);
    ipcMain.handle('add-anniversary', (_e, x) => daughter.addAnniversary(x));
    ipcMain.handle('remove-anniversary', (_e, id) => daughter.removeAnniversary(String(id)));
    ipcMain.handle('remove-slang', (_e, term) => daughter.removeSlang(String(term)));
    ipcMain.handle('mark-false-positive', () => daughter.markFalsePositive());
    ipcMain.handle('open-external', (_e, url) => {
      if (/^https:\/\/platform\.deepseek\.com\//.test(url)) shell.openExternal(url);
    });

    createWindow();
    if (process.env.DFY_SHOT) shoot(process.env.DFY_SHOT);
    daughter.heartbeat().catch((err) => console.error(err));
    setInterval(() => daughter.heartbeat().catch((err) => console.error(err)), heartbeatMs);
    daughter.refreshBalance().catch(() => {});
    setInterval(() => daughter.refreshBalance().catch(() => {}), 10 * 60 * 1000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.on('window-all-closed', () => app.quit());
}
