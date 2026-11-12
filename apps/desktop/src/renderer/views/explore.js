// 发现探索 › 平台插件：她能住进的地方。
// 这一期只做界面：每个平台能点开、能填设置、能保存、能看接入步骤；“连接”按钮是灰的，写“即将开放”。
// 平台清单和校验规则在主进程（src/main/channels/registry.js），界面完全照它画。

import { esc } from '../util.js';
import { lead } from './ui.js';
import * as kernel from './kernel.js';

const STATUS_TEXT = {
  unset: '还没设置',
  saved: '已保存设置 · 连接功能即将开放',
  planned: '未开放',
  // 下面四种只会出现在预览里（window.__channelPreview），这一期没有真实连接
  connecting: '连接中…',
  online: '已连接',
  error: '出错了',
  off: '已关闭',
};

let platforms = null; // 主进程给的清单
let loading = null;
let openId = null; // 抽屉里打开的平台
let entering = false; // 只在打开的那一下播放滑入动画，之后重画不再播
const drafts = {}; // 还没保存的输入：页面每次心跳都会重画，不能把用户刚输入的弄丢
const errors = {}; // 每个平台每个字段的错误
const previews = {}; // 开发用的状态预览 {id: {state, detail}}
let currentEl = null, currentCtx = null;

const byId = (id) => platforms?.find((p) => p.id === id);
const draftOf = (p) => (drafts[p.id] ||= { ...p.values, groups: (p.values.groups || []).join(', ') });

function statusOf(p) {
  const pv = previews[p.id];
  if (pv) return { key: pv.state, text: pv.state === 'online' ? `已连接 · ${pv.detail || '3 分钟前收到过消息'}` : pv.state === 'error' ? pv.detail || '出错了' : STATUS_TEXT[pv.state], preview: true };
  if (p.status === 'planned') return { key: 'planned', text: `未开放 · ${p.stage}` };
  return { key: p.status, text: STATUS_TEXT[p.status] };
}

// ---------- 页面 ----------
function card(p) {
  const st = statusOf(p);
  const soon = p.availability === 'soon';
  const badge = st.preview ? '<span class="preview-badge">预览</span>' : `<span class="plat-badge ${p.status === 'saved' ? 'saved' : soon ? 'soon' : 'later'}">${p.status === 'saved' ? '✓ 设置好了' : soon ? '下一版开放' : esc(p.stage)}</span>`;
  return `<button class="plat-card${soon ? ' feat' : ' later'}" data-open="${esc(p.id)}" style="--pc:${p.color}" aria-label="${esc(p.name)}：${esc(st.text)}">
    <span class="plat-mark" style="background:${p.color}">${esc(p.mark)}</span>
    <span class="plat-body"><b>${esc(p.name)}</b><span class="plat-st st-${st.key}">${st.key === 'connecting' ? '<i class="dot"></i>' : ''}${esc(st.text)}</span><span class="dim sm">${esc(p.desc)}</span>
      ${soon ? `<span class="plat-does">${p.does.slice(0, 3).map((x) => `<i>${esc(x)}</i>`).join('')}</span>` : ''}
      <span class="plat-go">${p.status === 'saved' ? '查看设置' : soon ? '先把设置填好' : '看看她会做什么'} ›</span></span>
    ${badge}
  </button>`;
}

function page() {
  const ready = platforms.filter((p) => p.availability === 'soon').length;
  const planned = platforms.filter((p) => p.availability === 'planned').length;
  const saved = platforms.filter((p) => p.status === 'saved').length;
  const group = (g, title) => `<div class="plat-group"><div class="plat-group-t">${title}</div><div class="plat-grid">${platforms.filter((p) => p.group === g).map(card).join('')}</div></div>`;
  return (
    lead('她能住进的地方', '这一期先把设置准备好，连接功能下一期开放') +
    `<div class="p plat-hero">
      <div class="stats plat-stats"><div class="stat"><b class="ok">${saved}</b><span>设置好了</span></div><div class="stat"><b>${ready}</b><span>下一版开放</span></div><div class="stat"><b class="dim">${planned}</b><span>以后开放</span></div></div>
      <div class="plat-road">${[['现在', '设置能填、能保存', 'done'], ['下一版 v0.4', 'QQ、微信接通', 'next'], ['阶段 4', 'B 站、小说', ''], ['阶段 5', '抖音、小红书、X、YouTube', '']].map(([t, d, c]) => `<div class="road-step ${c}"><i></i><b>${t}</b><span>${d}</span></div>`).join('')}</div>
      <div class="plat-hero-foot">${kernel.kernelLine(kernel.kernelStatus())}<span class="dim sm">所有平台都经过内核和生命网关，她在哪里说话都是同一个她。</span></div>
    </div>` +
    group('chat', '聊天') +
    group('content', '内容')
  );
}

// ---------- 抽屉 ----------
function field(p, f) {
  const d = draftOf(p);
  const err = errors[p.id]?.[f.key];
  const id = `ch-${p.id}-${f.key}`;
  const errHtml = `<div class="field-err" id="${id}-err" ${err ? '' : 'hidden'}>${esc(err || '')}</div>`;
  if (f.type === 'bool') {
    return `<label class="toggle"><input type="checkbox" id="${id}" data-field="${f.key}" ${d[f.key] ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
  }
  const value = d[f.key] ?? '';
  return `<label class="field" for="${id}"><span>${esc(f.label)}${f.required ? ' <em>必填</em>' : ''}</span>
    <input id="${id}" data-field="${f.key}" value="${esc(value)}" placeholder="${esc(f.placeholder || (f.type === 'port' ? String(f.default) : ''))}" inputmode="numeric" autocomplete="off" aria-describedby="${id}-err" aria-invalid="${err ? 'true' : 'false'}"></label>${errHtml}`;
}

function guideHtml(p) {
  if (!p.guide?.length) return '';
  const port = draftOf(p).port || 8643;
  const steps = p.guide.map((g) => {
    const text = typeof g === 'string' ? g : g.text;
    const link = typeof g === 'object' && g.link ? ` <button class="link" data-ext="${esc(g.link.url)}">${esc(g.link.label)}</button>` : '';
    return `<li>${esc(text.replace('{port}', port))}${link}</li>`;
  }).join('');
  return `<section class="dr-sec"><h4>接入步骤</h4><div class="dr-note">连接功能还没开放，下面是开放后的步骤，可以先看看。</div><ol class="guide">${steps}</ol></section>`;
}

function mainButton(p, st) {
  if (p.availability === 'planned') return `<span class="dim sm dr-foot-note">${esc(p.stage)}开放，开关可以先设好</span>`;
  if (st.preview) {
    const label = { connecting: '取消', online: '断开', error: '重试', off: '连接' }[st.key];
    return `<button class="primary" disabled>${label}</button>`;
  }
  return '<button class="primary" disabled title="下一期开放" data-connect>连接（即将开放）</button>';
}

function drawer(p) {
  const st = statusOf(p);
  const basic = p.fields.filter((f) => !f.advanced).map((f) => field(p, f)).join('');
  const adv = p.fields.filter((f) => f.advanced);
  const pv = previews[p.id];
  const logs = st.key === 'online' ? `<details class="dr-sec" data-k="log-${p.id}"><summary>最近日志</summary><pre class="dr-log">10:21:03 NapCat 已连接（127.0.0.1）
10:21:05 收到私聊消息 · 来自 123*****
10:21:07 已回复</pre></details>` : '';
  const errBox = st.key === 'error' ? `<div class="dr-error">${esc(pv?.detail || '出错了')}<div class="dim sm">${esc(pv?.hint || '换一个端口，或者关掉占用它的程序')}</div></div>` : '';
  return `<div class="dr-back" data-close></div>
  <aside class="drawer${entering ? ' enter' : ''}" role="dialog" aria-modal="true" aria-label="${esc(p.name)} 设置">
    <header class="dr-head"><span class="plat-mark" style="background:${p.color}">${esc(p.mark)}</span>
      <div><b>${esc(p.name)}</b><div class="plat-st st-${st.key}">${st.key === 'connecting' ? '<i class="dot"></i>' : ''}${esc(st.text)}</div></div>
      ${st.preview ? '<span class="preview-badge">预览</span>' : ''}
      <button class="icon dr-x" data-close aria-label="关闭">✕</button></header>
    <div class="dr-body">
      ${errBox}
      <section class="dr-sec"><h4>她会在这里做什么</h4><ul class="does">${p.does.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${p.login ? `<div class="dim sm">登录方式：${esc(p.login)}</div>` : ''}</section>
      ${guideHtml(p)}
      <section class="dr-sec"><h4>设置</h4>${basic}
        ${adv.length ? `<details data-k="adv-${p.id}"><summary>高级</summary>${adv.map((f) => field(p, f)).join('')}</details>` : ''}
        ${p.secret ? `<div class="secret-row"><span>${esc(p.secret.label)}：<b>${p.secretSet ? '已生成' : '还没生成'}</b><span class="dim sm"> · ${esc(p.secret.hint)}</span></span>
          <span class="btns">${p.secretSet ? '<button class="btn" data-secret="copy">复制</button><button class="btn" data-secret="generate">重新生成</button>' : '<button class="btn" data-secret="generate">生成</button>'}</span></div>` : ''}
      </section>
      ${logs}
      <section class="dr-sec dr-risk"><h4>风险</h4><p>${esc(p.risk)}</p></section>
    </div>
    <footer class="dr-foot"><button class="ghost" data-save>保存设置</button>${mainButton(p, st)}</footer>
  </aside>`;
}

// ---------- 校验（和主进程同样的规则，失去焦点时先提示一遍；保存时以主进程为准） ----------
function checkField(p, key) {
  const f = p.fields.find((x) => x.key === key);
  const v = String(draftOf(p)[key] ?? '').trim();
  let msg = '';
  if (f.type === 'digits') {
    if (!v) msg = f.required ? `请填${f.label.replace(/（.*）/, '')}` : '';
    else if (!/^\d+$/.test(v) || v.length < f.min || v.length > f.max) msg = `QQ 号是 ${f.min} 到 ${f.max} 位数字`;
  } else if (f.type === 'digits-list') {
    const bad = v.split(/[,，、\s]+/).filter(Boolean).filter((x) => !/^\d+$/.test(x) || x.length < f.min || x.length > f.max);
    if (bad.length) msg = `群号是 ${f.min} 到 ${f.max} 位数字，这些不对：${bad.slice(0, 3).join('、')}`;
  } else if (f.type === 'port' && v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) msg = '端口要在 1024 到 65535 之间';
  }
  (errors[p.id] ||= {})[key] = msg;
  return msg;
}

// ---------- 渲染与事件 ----------
function paint() {
  const el = currentEl, ctx = currentCtx;
  if (!el || !platforms) return;
  const p = openId && byId(openId);
  el.innerHTML = page() + (p ? drawer(p) : '');
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => open(b.dataset.open)));
  if (!p) return;
  const dr = el.querySelector('.drawer');
  el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  dr.querySelectorAll('[data-field]').forEach((input) => {
    const key = input.dataset.field;
    input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', () => {
      draftOf(p)[key] = input.type === 'checkbox' ? input.checked : input.value;
      if (key === 'port') dr.querySelectorAll('.guide li').forEach((li, i) => { const g = p.guide[i]; if (typeof g === 'string' || g.text) li.firstChild.textContent = (typeof g === 'string' ? g : g.text).replace('{port}', input.value || 8643); });
    });
    if (input.type !== 'checkbox') input.addEventListener('blur', () => {
      const msg = checkField(p, key);
      const box = dr.querySelector(`#${input.id}-err`);
      if (box) { box.textContent = msg; box.hidden = !msg; }
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
  });
  dr.querySelectorAll('[data-ext]').forEach((b) => b.addEventListener('click', () => ctx.fish.openExternal(b.dataset.ext)));
  dr.querySelectorAll('[data-secret]').forEach((b) => b.addEventListener('click', async () => {
    const r = await ctx.fish.channelsSecret(p.id, b.dataset.secret);
    platforms = r.list;
    ctx.toast(b.dataset.secret === 'copy' ? (r.ok ? '已复制到剪贴板' : '还没有令牌') : '已生成新的连接令牌');
    paint();
  }));
  dr.querySelector('[data-save]').addEventListener('click', save);
}

async function save() {
  const p = byId(openId);
  const d = draftOf(p);
  const values = { ...d, groups: d.groups };
  const r = await currentCtx.fish.channelsSave(p.id, values);
  platforms = r.list;
  errors[p.id] = r.ok ? {} : r.errors;
  if (r.ok) {
    delete drafts[p.id];
    currentCtx.toast('已保存');
  }
  paint();
  if (!r.ok) currentEl.querySelector('.drawer [aria-invalid="true"]')?.focus();
}

function open(id) {
  openId = id;
  entering = !!id;
  paint();
  entering = false;
  const first = currentEl.querySelector('.drawer input') || currentEl.querySelector('.drawer .dr-foot button');
  first?.focus();
}

function close() {
  openId = null;
  paint();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openId && currentEl?.querySelector('.drawer')) close();
});

export function render(el, tab, ctx) {
  if (tab === 'kernel') return kernel.render(el, ctx);
  currentEl = el;
  currentCtx = ctx;
  // 顶部那行内核状态：拿一次，之后跟着变化重画那一行
  kernel.ensureKernel(ctx, () => {
    const line = currentEl?.querySelector('.kernel-line');
    if (line) line.outerHTML = kernel.kernelLine(kernel.kernelStatus());
  }).then(() => {
    if (currentEl === el && el.querySelector('.plat-grid') && !el.querySelector('.kernel-line')) paint();
  });
  // 抽屉开着时，页面心跳不重画（不然滚动位置和动画会被打断）；从别的页面回来时抽屉关上
  if (openId && el.querySelector('.drawer')) return;
  if (!el.querySelector('.plat-grid')) openId = null;
  if (!platforms) {
    el.innerHTML = lead('她能住进的地方', '读取中…');
    loading ||= ctx.fish.channelsList().then((list) => {
      platforms = list;
      if (currentEl === el && el.isConnected) paint();
    });
    return;
  }
  paint();
}

/** 开发用：预览将来的连接状态（连接中、已连接、出错、已关闭）。只改当前页面的显示，不保存。 */
window.__channelPreview = (id, state, detail, hint) => {
  if (!state) delete previews[id];
  else previews[id] = { state, detail, hint };
  paint();
};
window.__channelOpen = (id) => { if (platforms) open(id); };
