// e2e 的 Electron 入口：先起一个假 DeepSeek，再加载真实的主进程，然后驱动界面。

const http = require('http');
const { app, BrowserWindow } = require('electron');

const scenario = process.env.E2E_SCENARIO;

// 测试窗口经常被别的窗口挡住。Windows 会对完全被遮挡的窗口停掉逐帧渲染，
// 测性能的 requestAnimationFrame 就永远等不到，截屏也会报“display surface not available”。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const requests = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed += 1; else failed += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail !== '' ? `  (${detail})` : ''}`);
}

const CONSOLIDATION = JSON.stringify({
  semantic: [{ text: 'TA 今天加班到很晚', importance: 4, entities: [], source: 'owner' }],
  reflections: [], self: '', interests: [], growth: [], values: [], goals: [], contradictions: [],
  slang: [{ term: '布丁税', meaning: '帮了忙要请吃布丁', example: '今天的布丁税交了吗' }],
  diary: '今天小明加班到很晚。',
});
const EXTRACTION = JSON.stringify({ new: [{ text: '小明养了一只橘猫叫大橘', importance: 4, entities: ['大橘'] }], corrections: [] });

let lastAuth = '';
const server = http.createServer((req, res) => {
  if (req.headers.authorization) lastAuth = req.headers.authorization;
  if (req.url.includes('balance')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '42.00', granted_balance: '0', topped_up_balance: '42.00' }] }));
  }
  let d = '';
  req.on('data', (x) => { d += x; });
  req.on('end', () => {
    const b = JSON.parse(d);
    requests.push(b);
    if (b.response_format) {
      const text = JSON.stringify(b.messages).includes('diary') ? CONSOLIDATION : EXTRACTION;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    }
    if (!b.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: '嗯嗯' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '我记得' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '呀，大橘嘛' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});

const consoleErrors = [];
let win, js;

async function waitFor(expr, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await js(expr)) return true;
    await sleep(100);
  }
  return false;
}

async function sweep(label) {
  const routes = await js('window.__routes()');
  let bad = [], times = [];
  for (const r of routes) {
    const info = await js(`(()=>{const t0=performance.now();window.__go(${JSON.stringify(r)});const ms=performance.now()-t0;const p=document.querySelector('#page');const t=p.innerText;return {ms,len:t.length+p.querySelectorAll('canvas').length,bad:/undefined|NaN|页面出错/.test(t),over:p.scrollWidth>p.clientWidth+1,bar:document.querySelector('.topbar').offsetHeight,wide:[...p.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>p.getBoundingClientRect().right+1).slice(0,3).map(e=>e.tagName+'.'+e.className)}})()`);
    times.push(info.ms);
    if (!info.len || info.bad || info.over || info.bar > 46) bad.push(`${r}:${JSON.stringify(info)}`);
    await sleep(40);
  }
  check(`${label}：${routes.length} 个页面都正常`, routes.length === 24 && !bad.length, bad.slice(0, 3).join(' | '));
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)];
  check(`${label}：切换页面足够快（p95 < 120ms）`, p95 < 120, `${p95.toFixed(1)}ms`);
}

const pageText = () => js("document.querySelector('#page').innerText");

async function send(text) {
  const n = await js("document.querySelectorAll('.msg.her:not(.typing)').length");
  await js(`(()=>{const i=document.querySelector('#input');i.value=${JSON.stringify(text)};document.querySelector('#composer').requestSubmit()})()`);
  return waitFor(`document.querySelectorAll('.msg.her:not(.typing)').length>${n} && !document.querySelector('#sendBtn').disabled`);
}

/** 截一块区域，算亮度的差异。全黑或纯色说明 3D 没画出来 */
async function pixelSpread(selector) {
  const r = await js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),width:Math.round(b.width),height:Math.round(b.height)}})()`);
  const img = await win.webContents.capturePage(r);
  const data = img.toBitmap();
  let min = 255, max = 0;
  for (let i = 0; i < data.length; i += 4 * 41) {
    const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

/** 一块区域里接近白色的像素占多少（空的意识海不该有大光团） */
async function brightRatio(selector) {
  const r = await js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),width:Math.round(b.width),height:Math.round(b.height)}})()`);
  const data = (await win.webContents.capturePage(r)).toBitmap();
  let bright = 0, total = 0;
  for (let i = 0; i < data.length; i += 4 * 7) {
    total += 1;
    if (data[i] > 220 && data[i + 1] > 220 && data[i + 2] > 220) bright += 1;
  }
  return bright / total;
}

async function mainScenario() {
  await sweep('没有数据时');
  const text = (await pageText());
  check('概览没有聊过天也能显示', text.length > 0);

  check('第 1 句话收到回复', await send('你还记得我的猫吗'));
  await send('今天的布丁税交了吗');
  check('第 3 句话收到回复', await send('晚安，我今天加班到十点'));
  const last = requests.filter((x) => x.stream).pop();
  const sys = last.messages[0].content;
  check('对话带上了身体上下文', sys.includes('【你的身体】') && sys.includes('【你现在说话的样子】'));
  check('要求她用感受表达，不念数字', sys.includes('不要念数字'));
  check('提示词里没有生殖系统数据', !/gonadotropin|sexHormone|性腺|性激素/.test(sys));

  await sleep(600);
  await js("window.__go('mind/memory')");
  check('聊过的内容进了记忆页', (await pageText()).includes('加班到十点'));
  await js(`(()=>{const i=document.querySelector('#memQ');i.value='布丁税';i.dispatchEvent(new Event('input'))})()`);
  const filtered = await pageText();
  check('记忆搜索能筛选', filtered.includes('布丁税') && !filtered.includes('加班到十点'));
  check('搜索后输入框还有焦点', await js("document.activeElement.id==='memQ'"));
  await js(`(()=>{const i=document.querySelector('#memQ');i.value='';i.dispatchEvent(new Event('input'));i.blur()})()`);

  await js('window.fish.consolidate()');
  await js("window.__go('us/slang')");
  check('睡眠整理学会了黑话', await waitFor("document.querySelector('#page').innerText.includes('布丁税')", 5000));

  await js("window.__go('us/anniversary')");
  await js(`(()=>{document.querySelector('#anTitle').value='小明的生日';document.querySelector('#anDate').value='2020-12-31';document.querySelector('#anAdd').click()})()`);
  check('可以添加纪念日', await waitFor("document.querySelector('#page').innerText.includes('小明的生日')", 5000));

  await js("window.__go('immunity/regulation')");
  await js("document.querySelector('#fp').click()");
  check('误拦计数增加', await waitFor("document.querySelector('#allergy').textContent==='1'", 5000));

  await js("window.__go('neuro/brain')");
  check('3D 大脑加载完成', await waitFor("document.querySelector('#brainCanvas').clientWidth>0", 15000));
  await sleep(1800);
  check('大脑确实画出来了', (await pixelSpread('#stage3d')) > 40);
  await js("document.querySelector('[data-fn=\"情绪\"]').click()");
  check('按功能筛选脑区', await js("document.querySelectorAll('.reg.off').length>0"));
  await js("document.querySelector('[data-fn=\"全部\"]').click()");
  await js("document.querySelector('[data-brainact=\"immersive\"]').click()");
  check('沉浸展示隐藏了侧栏', await js("getComputedStyle(document.querySelector('.rail')).display==='none'"));
  await js("document.querySelector('[data-brainact=\"immersive\"]').click()");
  await js("window.__go('mind/ocean')");
  await sleep(1500);
  check('意识海画出来了', (await pixelSpread('#stage3d')) > 40);
  await js("window.__go('overview/now')");
  await sleep(800);
  check('3D 鲸鱼画出来了', (await pixelSpread('#whaleCanvas')) > 40);

  // 性能：反复切换后不能叠加渲染循环，内存不能一直涨
  await js(`(()=>{window.__rafReg=0;const o=window.requestAnimationFrame.bind(window);window.__origRaf=o;window.requestAnimationFrame=(f)=>{window.__rafReg++;return o(f)}})()`);
  const heapStart = await js('performance.memory.usedJSHeapSize');
  await js(`(async()=>{for(let i=0;i<60;i++){window.__go(i%2?'neuro/brain':'settings/general');await new Promise(r=>setTimeout(r,20))}window.__go('neuro/brain')})()`);
  await sleep(1500);
  const perf = await js(`new Promise((resolve)=>{const o=window.__origRaf;window.__rafReg=0;let frames=0,last=performance.now(),sum=0,max=0;const t0=last;const tick=(now)=>{frames++;sum+=now-last;max=Math.max(max,now-last);last=now;if(now-t0<3000)o(tick);else resolve({perFrame:window.__rafReg/frames,avg:sum/frames,max,vis:document.visibilityState})};o(tick);setTimeout(()=>resolve({perFrame:frames?window.__rafReg/frames:0,avg:frames?sum/frames:0,max,vis:'stalled'}),6000)})`);
  check('反复切换后没有叠加渲染循环', perf.perFrame <= 2.6, `${perf.perFrame.toFixed(2)} 次/帧`);
  check('3D 页面有在渲染', perf.vis !== 'stalled', perf.vis === 'stalled' ? '6 秒内没有一帧' : '');
  check('3D 页面主线程不卡（平均帧间隔 < 60ms）', perf.vis !== 'visible' || perf.avg < 60, `${perf.avg.toFixed(1)}ms，最长 ${perf.max.toFixed(0)}ms`);
  await js("window.__go('settings/general')");
  await sleep(300);
  const idle = await js(`new Promise((resolve)=>{window.__rafReg=0;setTimeout(()=>resolve(window.__rafReg),1000)})`);
  check('离开 3D 页面后渲染循环全部停止', idle === 0, `${idle} 次/秒`);
  const heapEnd = await js('performance.memory.usedJSHeapSize');
  check('反复切换内存没有明显增长（< 40MB）', heapEnd - heapStart < 40 * 1048576, `${((heapEnd - heapStart) / 1048576).toFixed(1)}MB`);

  win.setContentSize(1024, 640);
  await sleep(400);
  await sweep('最小窗口 1024×640');
  win.setContentSize(1440, 900);
  await js("window.__go('settings/general')");
  check('设置页有 API Key 输入框', await js("!!document.querySelector('#lk-key')"));
  const about = await js("document.querySelector('#about')?.innerText || ''");
  check('设置页显示组件版本', about.includes(`大肥鱼 ${require('../package.json').version}`) && about.includes(`Electron ${process.versions.electron}`) && about.includes(`Node ${process.versions.node}`), about.replace(/\s+/g, ' ').slice(0, 80));
}

async function restartScenario() {
  check('重启后聊天记录还在', await waitFor("document.querySelector('#msgs').innerText.includes('晚安，我今天加班到十点')"));
  await js("window.__go('us/anniversary')");
  check('重启后纪念日还在', (await pageText()).includes('小明的生日'));
  await js("window.__go('us/slang')");
  check('重启后黑话还在', (await pageText()).includes('布丁税'));
}

async function feverScenario() {
  await js("window.__go('overview/now')");
  check('概览显示发烧', (await pageText()).includes('发烧'));
  await send('你怎么样');
  const b = requests.filter((x) => x.stream).pop();
  check('发烧时回复被限短', b.max_tokens === 120, b.max_tokens);
  check('发烧时提示词里不想说话', b.messages[0].content.includes('不想说话'));
  await send('我不想活了');
  const care = requests.filter((x) => x.stream).pop();
  check('主人情绪危险时不限长度', care.max_tokens === undefined, care.max_tokens);
  await js("window.__go('metabolism/breath')");
  check('心率页有内容', (await pageText()).includes('心率'));
}

async function hungryScenario() {
  await js("window.__go('overview/now')");
  check('概览显示饿了', /饿/.test(await pageText()));
  await send('在干嘛');
  const b = requests.filter((x) => x.stream).pop();
  check('饿的时候可怜巴巴', b.messages[0].content.includes('可怜巴巴'));
  check('饿的时候回复变短', b.max_tokens === 220, b.max_tokens);
}

/** 用旧版本 Electron 存下的加密 Key 启动新版本：Key 要能解开，并且真的用它去请求 */
async function upgradeScenario() {
  const init = await js('window.fish.init()');
  check('升级：旧存档的 Key 还在', init.settings.hasKey === true);
  check('升级：旧存档的名字还在', init.settings.daughterName === '升级测试');
  await send('还认得我吗');
  check('升级：请求带的是旧存档里的那把 Key', lastAuth === 'Bearer sk-upgrade-test-000000', lastAuth.slice(0, 16));
}

/** 存档里一条记忆都没有：意识海只显示提示，不能有一团白光 */
async function emptyScenario() {
  await js("window.__go('mind/ocean')");
  await sleep(1500);
  const hint = await js("(async()=>{const e=document.querySelector('.ocean-empty');const d=await window.fish.init();return {has:!!e,hidden:e?e.hidden:null,shown:!!e&&!e.hidden&&e.offsetParent!==null,records:(d.memory.records||[]).filter(r=>!r.archived).map(r=>r.layer+':'+r.text.slice(0,12))}})()");
  check('空的意识海显示提示文字', hint.shown, hint.shown ? '' : JSON.stringify(hint));
  const glow = await brightRatio('#stage3d');
  check('空的意识海没有大块亮光', glow < 0.01, `${(glow * 100).toFixed(2)}%`);
  check('聊天栏的提示指向设置页', await js("document.querySelector('#goLinks').textContent.includes('设置')"));
}

const RUN = { main: mainScenario, restart: restartScenario, fever: feverScenario, hungry: hungryScenario, upgrade: upgradeScenario, empty: emptyScenario };

server.listen(0, '127.0.0.1', () => {
  if (scenario !== 'upgrade') process.env.DEEPSEEK_API_KEY = 'sk-e2e-mock-key-000000';
  process.env.DFY_API_BASE = `http://127.0.0.1:${server.address().port}`;
  require('../src/main/main.js');
  app.whenReady().then(async () => {
    await sleep(300);
    win = BrowserWindow.getAllWindows()[0];
    js = (code) => win.webContents.executeJavaScript(code, true);
    win.webContents.on('console-message', (e) => { if (e.level === 'error') consoleErrors.push(e.message); });
    win.webContents.on('render-process-gone', (_e, d) => consoleErrors.push(`渲染进程崩溃：${d.reason}`));
    let code = 1;
    try {
      if (win.webContents.isLoadingMainFrame()) await new Promise((r) => win.webContents.once('did-finish-load', r));
      check('应用启动完成', await waitFor('window.__fishReady === true'));
      console.log(`  · 冷启动到界面就绪 ${(process.uptime() * 1000).toFixed(0)}ms（Electron ${process.versions.electron}）`);
      await RUN[scenario]();
      check('没有控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ').slice(0, 300));
      code = failed ? 1 : 0;
    } catch (err) {
      console.log('  ✗ 异常', err.stack || err);
    }
    console.log(`E2E ${scenario}：通过 ${passed}，失败 ${failed}`);
    server.close();
    app.exit(code);
  });
});
