// 发现探索 › 内核：内嵌的 DSH 跑得怎么样，以及“通过内核跟她说一句话”。
// 这一期没有 QQ、微信，这个输入框就是证明整条路通的办法：输入框 → DSH → 生命网关 → 她的大脑 → DeepSeek。

import { esc, fmtDur } from '../util.js';
import { lead, card } from './ui.js';

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
      ${row('已运行', esc(up))}
      ${row('重启次数', esc(st.restarts ?? 0))}
      ${row('最近一次错误', st.lastError ? esc(st.lastError) : '没有', st.lastError ? 'warn' : '')}
      ${row('数据目录', `<code>${esc(st.dataDir || '')}</code>`)}
    </div>`;
}

function pluginsCard() {
  const list = status?.plugins || [];
  if (!list.length) return '<div class="dim sm">启动后显示内核加载了哪些插件。</div>';
  return `<ul class="k-plugins">${list.map((p) => `<li><code>${esc(p.name)}</code><span class="dim">${esc(p.version || '')}</span></li>`).join('')}</ul>`;
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
    `<div class="g2 k-grid">
      ${card('状态', `<div id="kStatus">${statusCard()}</div>`)}
      ${card('已加载的插件', `<div id="kPlugins">${pluginsCard()}</div><p class="k-note">内核里没有装任何能执行命令或读写文件的工具。她的回答来自她自己的大脑，内核只负责收发。</p>`)}
    </div>` +
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
  if (!el?.querySelector('#kStatus')) return;
  el.querySelector('#kStatus').innerHTML = statusCard();
  el.querySelector('#kPlugins').innerHTML = pluginsCard();
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

// 开发和测试用
window.__kernelSaid = () => said.map((x) => ({ ...x }));
