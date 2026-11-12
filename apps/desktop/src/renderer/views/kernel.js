// 发现探索 › 内核：内嵌的 DSH 跑得怎么样，以及“通过内核跟她说一句话”。
// 这一期没有 QQ、微信，这个输入框就是证明整条路通的办法：输入框 → DSH → 生命网关 → 她的大脑 → DeepSeek。

import { esc, fmtClock, fmtDur } from '../util.js';
import { lead, card } from './ui.js';
import { C, bars, donut } from './charts.js';

const PLUGIN_ROLE = {
  '@deepseek-ai/dsh-sdk-jsonrpc-server': '对外的接口：大肥鱼通过它给内核发消息',
  '@deepseek-ai/dsh-llm-deepseek': '模型适配器：地址指向本机的生命网关，不是 DeepSeek',
  '@deepseek-ai/dsh-agent-spine-demo': '智能体主干：管会话和消息的收发，工具全部关掉',
};
const EVENT_WORD = { stopped: '停止了', starting: '开始启动', running: '启动成功', crashed: '出错了' };

const STATE = {
  stopped: { word: '未运行', cls: 'off' },
  starting: { word: '启动中…', cls: 'busy' },
  running: { word: '运行中', cls: 'on' },
  crashed: { word: '出错了', cls: 'bad' },
};

let status = null; // 主进程推过来的最新状态
let subscribed = false;
let busy = null; // 'start' | 'stop' | 'restart' | 'say'
let draft = ''; // 输入框里还没发出去的字
const said = []; // 这次打开程序以来通过内核说过的话 {text, reply?, error?, at}
let currentEl = null, currentCtx = null;

/** 插件页顶部那行小字也用它 */
export function kernelStatus() {
  return status;
}

/** 第一次用到时拿一次状态，并订阅之后的变化 */
export function ensureKernel(ctx, onChange) {
  if (!subscribed) {
    subscribed = true;
    ctx.fish.onDsh((st) => {
      status = st;
      patchStatus();
      onChange?.();
    });
  }
  if (!status) {
    return ctx.fish.dshStatus().then((st) => {
      status = st;
      return st;
    });
  }
  return Promise.resolve(status);
}

export function kernelLine(st) {
  if (!st) return '';
  const s = STATE[st.state] || STATE.stopped;
  const tail = st.state === 'running' ? ` · 进程 ${st.pid}` : st.state === 'crashed' ? ' · 点这里查看' : ' · 用到时自动启动';
  return `<button class="kernel-line" data-go="explore/kernel"><i class="kdot ${s.cls}"></i>内核：${esc(s.word)}${esc(tail)} ›</button>`;
}

function statusCard() {
  const st = status || { state: 'stopped', plugins: [] };
  const s = STATE[st.state] || STATE.stopped;
  const up = st.state === 'running' && st.since ? fmtDur(Date.now() - st.since) : '—';
  const btn = (act, label, enabled, cls = 'ghost') => `<button class="${cls}" data-k-act="${act}" ${enabled && !busy ? '' : 'disabled'}>${busy === act ? '…' : label}</button>`;
  const row = (k, v, cls = '') => `<div class="k-row"><span class="dim">${k}</span><span class="${cls}">${v}</span></div>`;
  return `<div class="k-state"><i class="kdot ${s.cls}"></i><b>${esc(s.word)}</b>
      <span class="k-btns">${btn('start', '启动', st.state === 'stopped' || st.state === 'crashed', 'primary')}${btn('stop', '停止', st.state === 'running' || st.state === 'starting')}${btn('restart', '重新启动', st.state !== 'stopped')}</span></div>
    <div class="k-info">
      ${row('DSH 版本', esc(st.version || '—'))}
      ${row('进程号', st.pid ? esc(st.pid) : '—')}
      ${row('已运行', `<span id="kUp">${esc(up)}</span>`)}
      ${row('重启次数', esc(st.restarts ?? 0))}
      ${row('最近一次错误', st.lastError ? esc(st.lastError) : '没有', st.lastError ? 'warn' : '')}
      ${row('数据目录', `<code>${esc(st.dataDir || '')}</code>`)}
    </div>`;
}

function pluginsCard() {
  const list = status?.plugins || [];
  if (!list.length) return '<div class="dim sm">启动后显示内核加载了哪些插件。</div>';
  return `<ul class="k-plugins">${list.map((p) => `<li><code>${esc(p.name)}</code><span class="dim">${esc(p.version || '')}</span><div class="k-role">${esc(PLUGIN_ROLE[p.name] || '')}</div></li>`).join('')}</ul>`;
}

/** 一句话走过的路：入口 → 内核 → 生命网关 → 她的大脑 → DeepSeek */
function pipeline() {
  const st = status || {};
  const on = st.state === 'running';
  const gw = st.gateway || {};
  const port = (gw.url || '').split(':').pop() || '—';
  const nodes = [
    { x: 20, title: '入口', sub: '这里的输入框', note: '以后是 QQ、微信', ok: true },
    { x: 215, title: 'DSH 内核', sub: on ? `进程 ${st.pid}` : (STATE[st.state] || STATE.stopped).word, note: '只管收发，没有工具', ok: on, warn: st.state === 'crashed' },
    { x: 410, title: '生命网关', sub: gw.running ? `127.0.0.1:${port}` : '没有运行', note: '只听本机，要令牌', ok: !!gw.running },
    { x: 605, title: '她的大脑', sub: '人格 · 身体 · 记忆', note: '回答从这里来', ok: true },
    { x: 800, title: 'DeepSeek', sub: '语言模型', note: '用的是你的 Key', ok: true },
  ];
  return `<svg class="organ k-pipe" viewBox="0 0 1000 132" role="img" aria-label="一句话走过的路：入口、DSH 内核、生命网关、她的大脑、DeepSeek">
    ${nodes.map((n, i) => `${i ? `<path d="M${n.x - 35} 52 H${n.x - 4}" class="kp-flow${on || i > 2 ? ' on' : ''}"/><path d="M${n.x - 11} 47 L${n.x - 4} 52 L${n.x - 11} 57" class="kp-head${on || i > 2 ? ' on' : ''}"/>` : ''}
      <rect x="${n.x}" y="14" width="160" height="76" rx="10" class="kp-node${n.warn ? ' bad' : n.ok ? ' on' : ''}"/><circle cx="${n.x + 16}" cy="33" r="4.5" class="kp-dot${n.warn ? ' bad' : n.ok ? ' on' : ''}"/>
      <text x="${n.x + 28}" y="38" class="kp-title">${esc(n.title)}</text><text x="${n.x + 16}" y="60" class="kp-sub">${esc(n.sub)}</text><text x="${n.x + 16}" y="78" class="kp-note">${esc(n.note)}</text>`).join('')}
    <path d="M880 96 V114 H490 V96" class="kp-back"/><path d="M485 103 L490 96 L495 103" class="kp-backhead"/><text x="685" y="128" class="kp-note" text-anchor="middle">她的回答原路返回，内核拿不到你的 Key</text>
  </svg>`;
}

const chats = () => (status?.gateway?.recent || []).filter((r) => r.kind === 'chat' && r.ok);
const sec = (ms) => (ms / 1000).toFixed(1);

function numbers() {
  const c = status?.gateway?.counts || { chat: 0, other: 0, unauthorized: 0, retries: 0 };
  const list = chats();
  const avg = list.length ? list.reduce((a, r) => a + r.ms, 0) / list.length : null;
  const last = list[list.length - 1];
  const tile = (v, name, cls = '') => `<div class="stat"><b class="${cls}">${esc(v)}</b><span>${esc(name)}</span></div>`;
  return `<div class="stats k-stats">${tile(c.chat, '她听到的话')}${tile(avg == null ? '—' : `${sec(avg)} 秒`, '平均多久回答')}${tile(last ? `${sec(last.ms)} 秒` : '—', '最近一次')}${tile(c.retries, '内核重试')}${tile(c.other, '没打扰她的请求')}${tile(c.unauthorized, '令牌不对被拒', c.unauthorized ? 'warn' : '')}${tile(status?.restarts ?? 0, '内核重启', status?.restarts ? 'warn' : '')}</div>`;
}

function latency() {
  const list = chats().slice(-16);
  if (!list.length) return '<div class="dim sm">通过内核说一句话，这里就会记下她用了多久回答。</div>';
  return bars(list.map((r, i) => ({ label: i % 2 ? '' : fmtClock(r.at), title: `${fmtClock(r.at)} · ${sec(r.ms)} 秒 · 回了 ${r.chars} 个字`, value: Number(sec(r.ms)), color: r.ms > 15000 ? C.amber : C.cyan })), { height: 96, unit: ' 秒' });
}

function mix() {
  const c = status?.gateway?.counts || {};
  const parts = [{ name: '聊天', value: c.chat || 0, color: C.cyan }, { name: '内核重试', value: c.retries || 0, color: C.violet }, { name: '非聊天请求', value: c.other || 0, color: C.blue }, { name: '被拒绝', value: c.unauthorized || 0, color: C.amber }];
  const total = parts.reduce((a, x) => a + x.value, 0);
  if (!total) return '<div class="dim sm">还没有请求经过生命网关。</div>';
  return donut(parts.filter((x) => x.value), String(total), '次请求');
}

function safety() {
  const st = status || {};
  const gw = st.gateway || {};
  const plugins = st.plugins || [];
  const bad = plugins.filter((p) => /bash|pwsh|terminal|fs-local|web|subagent|mcp|tool-skill|tool-jobs|editor/.test(p.name));
  const rows = [
    [/^http:\/\/127\.0\.0\.1:\d+$/.test(gw.url || ''), '生命网关只听本机', gw.url ? gw.url.replace('http://', '') : '没有运行'],
    [true, '每次启动换一个令牌', '不对一律拒绝'],
    [true, '回答里没有工具调用', '内核从结构上动不了电脑'],
    [!bad.length, '没有能执行命令、读写文件的插件', plugins.length ? `加载了 ${plugins.length} 个，都在白名单里` : '启动后检查'],
    [true, '内核拿不到你的 DeepSeek Key', '它只知道本机网关的地址'],
    [!/[\\/]\.dsh$/.test(st.dataDir || ''), '不碰你自己的 DSH', '数据在大肥鱼自己的目录里'],
  ];
  return `<div class="k-safe">${rows.map(([ok, name, note]) => `<div><i class="${ok ? 'ok' : 'warn'}">${ok ? '✓' : '⚠'}</i><span>${esc(name)}</span><em>${esc(note)}</em></div>`).join('')}</div>`;
}

function events() {
  const list = [...(status?.events || [])].reverse().slice(0, 8);
  if (!list.length) return '<div class="dim sm">这次打开程序以来，内核的状态还没有变过。</div>';
  return list.map((e) => `<div class="li"><time>${fmtClock(e.at)}</time><span class="${e.state === 'crashed' ? 'warn' : ''}">${esc(EVENT_WORD[e.state] || e.state)}</span><em>${esc(e.error || '')}</em></div>`).join('');
}

/** 状态变化时要跟着变的几块 */
function dash() {
  return `${card('一句话走过的路', pipeline(), status?.state === 'running' ? '整条路是通的' : '内核没在运行，说话时会自动启动')}
    <div class="g2 k-grid">
      ${card('状态', `<div id="kStatus">${statusCard()}</div>`)}
      ${card('运行数字', numbers(), '这次打开程序以来')}
    </div>
    <div class="g3 wide1">
      ${card('她回答用了多久', latency(), '最近 16 次，单位秒')}
      ${card('请求构成', mix(), '经过生命网关的')}
      ${card('安全检查', safety(), '实时检查')}
    </div>
    <div class="g2 k-grid">
      ${card('已加载的插件', `<div id="kPlugins">${pluginsCard()}</div><p class="k-note">内核里没有装任何能执行命令或读写文件的工具。她的回答来自她自己的大脑，内核只负责收发。</p>`)}
      ${card('内核的状态变化', events(), '最近 8 次')}
    </div>`;
}

function sayLog() {
  if (!said.length) return '<div class="dim sm">说一句试试。她的回答也会出现在右边的聊天栏里，带“经内核”标记。</div>';
  return said
    .slice(-6)
    .map((x) => `<div class="k-say"><div class="k-q">${esc(x.text)}</div>${x.error ? `<div class="k-err">${esc(x.error)}</div>` : x.reply != null ? `<div class="k-a">${esc(x.reply)}</div>` : '<div class="k-a dim">她在想…</div>'}</div>`)
    .join('');
}

function page() {
  return (
    lead('她的内核', 'DSH 跑在大肥鱼里面，通过生命网关和她的大脑接通') +
    `<div id="kDash" class="k-dash">${dash()}</div>` +
    card(
      '通过内核跟她说一句话',
      `<form id="kForm" class="k-form"><input id="kInput" maxlength="2000" placeholder="${status?.state === 'running' ? '写一句话' : '写一句话（内核没启动的话会先启动它）'}" autocomplete="off" value="${esc(draft)}"><button class="primary" id="kSend" ${busy === 'say' ? 'disabled' : ''}>${busy === 'say' ? '她在想…' : '发送'}</button></form>
       <div id="kLog">${sayLog()}</div>`,
    )
  );
}

/** 状态变化只改状态和插件两块，输入框不动 */
function patchStatus() {
  const el = currentEl;
  if (!el?.querySelector('#kDash')) return;
  el.querySelector('#kDash').innerHTML = dash();
  bindButtons();
}

function bindButtons() {
  currentEl.querySelectorAll('[data-k-act]').forEach((b) =>
    b.addEventListener('click', async () => {
      const act = b.dataset.kAct;
      busy = act;
      patchStatus();
      const fn = { start: 'dshStart', stop: 'dshStop', restart: 'dshRestart' }[act];
      const r = await currentCtx.fish[fn]();
      busy = null;
      if (r.status) status = r.status;
      if (!r.ok) currentCtx.toast(`内核${act === 'stop' ? '停止' : '启动'}失败：${r.error}`);
      patchStatus();
    }),
  );
}

async function send(e) {
  e.preventDefault();
  const input = currentEl.querySelector('#kInput');
  const text = input.value.trim();
  if (!text || busy === 'say') return;
  draft = '';
  input.value = '';
  const item = { text, at: Date.now() };
  said.push(item);
  busy = 'say';
  paint();
  const r = await currentCtx.fish.dshSay(text);
  busy = null;
  if (r.status) status = r.status;
  if (r.ok) item.reply = r.reply;
  else item.error = r.error;
  paint();
  currentEl.querySelector('#kInput')?.focus();
}

function paint() {
  const el = currentEl;
  if (!el) return;
  el.innerHTML = page();
  bindButtons();
  el.querySelector('#kForm').addEventListener('submit', send);
  el.querySelector('#kInput').addEventListener('input', (e) => (draft = e.target.value));
}

export function render(el, ctx) {
  currentEl = el;
  currentCtx = ctx;
  if (!status) {
    el.innerHTML = lead('她的内核', '读取中…');
    ensureKernel(ctx).then(() => {
      if (currentEl === el && el.isConnected && !el.querySelector('#kStatus')) paint();
    });
    return;
  }
  ensureKernel(ctx);
  paint();
}

// “已运行”每秒走一次（只改那一格，不重画页面）
setInterval(() => {
  const el = currentEl?.querySelector('#kUp');
  if (el && status?.state === 'running' && status.since) el.textContent = fmtDur(Date.now() - status.since);
}, 1000);

// 开发和测试用
window.__kernelSaid = () => said.map((x) => ({ ...x }));
