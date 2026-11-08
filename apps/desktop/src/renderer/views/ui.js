// 各板块共用的小组件。红黄绿只表示状态，并且配文字。

import { esc } from '../util.js';

export const clamp = (x, a = 0, z = 100) => Math.max(a, Math.min(z, x));

/** 有参考范围的指标 */
export function metric(name, value, ref, min, max, note = '') {
  const pct = (x) => ((x - min) / (max - min)) * 100;
  const st = value < ref.low ? ['偏低', 'warn'] : value > ref.high ? ['偏高', 'warn'] : ['正常', 'ok'];
  return `<div class="m"><div class="h"><span>${esc(name)}</span><span><b>${value}</b><small>${esc(ref.unit)}</small> <span class="${st[1]} sm">${st[1] === 'warn' ? '⚠ ' : ''}${st[0]}</span></span></div>
    <div class="range"><u style="left:${pct(ref.low)}%;width:${pct(ref.high) - pct(ref.low)}%"></u><i style="left:${clamp(pct(value))}%"></i></div>
    <div class="f"><span>参考 ${ref.low}–${ref.high}</span><span>${esc(note)}</span></div></div>`;
}

export const level = (name, v, note = '') =>
  `<div class="m"><div class="h"><span>${esc(name)}</span><b>${Math.round(v)}</b></div><div class="tr"><i style="width:${clamp(v)}%"></i></div>${note ? `<div class="f"><span>${esc(note)}</span></div>` : ''}</div>`;

export const lead = (b, s = '') => `<div class="lead"><b>${esc(b)}</b><span>${esc(s)}</span></div>`;
export const card = (title, body, right = '', cls = '') => `<div class="p ${cls}"><div class="t"><span>${esc(title)}</span><span>${esc(right)}</span></div>${body}</div>`;
export const li = (arr) => arr.map((r) => `<div class="li">${r}</div>`).join('');
export const nothing = (text) => `<div class="empty">${esc(text)}</div>`;
export const flow = (items) => `<div class="flow">${items.map(([n, v], i) => `${i ? '<i>→</i>' : ''}<div>${esc(n)}<b>${Math.round(v)}</b></div>`).join('')}</div>`;

/** 最近的因果，默认取影响心情、活动和身体的 */
export function causeList(b, n = 4, to = null) {
  const list = (b.causes || []).filter((c) => (to ? c.to === to : true)).slice(-n).reverse();
  if (!list.length) return '<div class="dim">最近一切平稳。</div>';
  return `<div class="chain-list">${list.map((c) => `<div><span>${esc(c.from)}</span><i>→</i><span>${esc(c.text)}</span></div>`).join('')}</div>`;
}

export const word3 = (v, low, mid, high) => (v < 30 ? low : v < 60 ? mid : high);
export const status = (sys) => `<span class="${sys.status === 'warn' ? 'warn' : 'dim'} sm">${sys.status === 'warn' ? '⚠ ' : ''}${esc(sys.word)}</span>`;
