// 生物医学风格的图表：带参考范围的曲线、仪表、监护仪波形、器官示意、反馈环路、雷达图。
// 全部返回 HTML 字符串；会动的部分（监护仪波形、曲线上的悬停读数）由 mountCharts 接上。
// 颜色的含义全站一致：青色是数值，绿色带是参考范围，琥珀色是超出范围，并且总配文字。

import { esc, fmtClock } from '../util.js';

export const C = { cyan: '#4fd6ff', green: '#3ddc97', amber: '#f5c242', pink: '#ef6f8e', violet: '#a98bff', blue: '#7fb2ff', orange: '#f0a35e', dim: '#7d8ca6' };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const num = (x, d = 0) => (Number.isFinite(x) ? Number(x).toFixed(d) : '—');
let uid = 0;
const nextId = (p) => `${p}${++uid}`;

/** 历史采样里某一项的曲线点；旧存档没有的字段会被跳过 */
export const hist = (v, key) => (v.vitals || []).filter((p) => Number.isFinite(p[key])).map((p) => ({ t: p.t, v: p[key] }));

// ---------- 带参考范围的时间曲线 ----------

/**
 * @param {object} o
 * @param {{name:string,color?:string,pts:{t:number,v:number}[],cur?:number}[]} o.series
 * @param {{low:number,high:number}} [o.band]   参考范围（绿色带）
 * @param {{v:number,label:string}[]} [o.lines] 阈值线（虚线）
 * @param {{t:number,label:string,color?:string}[]} [o.marks] 事件竖线，比如吃饭
 */
export function timeChart(o) {
  const now = Date.now();
  let thin = false;
  const series = o.series.map((s, i) => {
    let pts = s.pts.filter((p) => Number.isFinite(p.v));
    if (pts.length < 2) {
      thin = true;
      const cur = Number.isFinite(s.cur) ? s.cur : pts[0]?.v ?? 0;
      pts = [{ t: now - 3600000, v: cur }, { t: now, v: cur }];
    }
    return { ...s, color: s.color || [C.cyan, C.violet, C.amber][i % 3], pts };
  });
  const all = series.flatMap((s) => s.pts);
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t), t0 + 1);
  const extra = [...(o.band ? [o.band.low, o.band.high] : []), ...(o.lines || []).map((l) => l.v)];
  let lo = Math.min(...all.map((p) => p.v), ...extra);
  let hi = Math.max(...all.map((p) => p.v), ...extra);
  const padY = (hi - lo || 1) * 0.12;
  lo = o.min ?? lo - padY;
  hi = o.max ?? hi + padY;
  const d = o.digits ?? 0;
  const X = (t) => ((t - t0) / (t1 - t0)) * 100;
  const Y = (v) => (1 - clamp01((v - lo) / (hi - lo))) * 100;
  const gid = nextId('cg');
  const first = series[0];
  const linePts = (s) => s.pts.map((p) => `${X(p.t).toFixed(2)},${Y(p.v).toFixed(2)}`).join(' L');
  const svg = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${first.color}" stop-opacity=".34"/><stop offset="1" stop-color="${first.color}" stop-opacity="0"/></linearGradient></defs>
    ${[25, 50, 75].map((y) => `<line x1="0" x2="100" y1="${y}" y2="${y}" class="ch-grid"/>`).join('')}
    ${[20, 40, 60, 80].map((x) => `<line y1="0" y2="100" x1="${x}" x2="${x}" class="ch-grid v"/>`).join('')}
    ${o.band ? `<rect x="0" width="100" y="${Y(o.band.high)}" height="${Math.max(0, Y(o.band.low) - Y(o.band.high))}" class="ch-band"/><line x1="0" x2="100" y1="${Y(o.band.high)}" y2="${Y(o.band.high)}" class="ch-bandline"/><line x1="0" x2="100" y1="${Y(o.band.low)}" y2="${Y(o.band.low)}" class="ch-bandline"/>` : ''}
    ${(o.lines || []).map((l) => `<line x1="0" x2="100" y1="${Y(l.v)}" y2="${Y(l.v)}" class="ch-thr"/>`).join('')}
    ${(o.marks || []).filter((m) => m.t >= t0 && m.t <= t1).map((m) => `<line y1="0" y2="100" x1="${X(m.t)}" x2="${X(m.t)}" class="ch-markline" style="stroke:${m.color || C.amber}"/>`).join('')}
    ${series.length === 1 ? `<path d="M${X(first.pts[0].t)},100 L${linePts(first)} L${X(first.pts[first.pts.length - 1].t)},100 Z" fill="url(#${gid})"/>` : ''}
    ${series.map((s) => `<path d="M${linePts(s)}" class="ch-line" style="stroke:${s.color}"/>`).join('')}
  </svg>`;
  const dots = series.map((s) => { const p = s.pts[s.pts.length - 1]; return `<i class="ch-dot" style="left:${X(p.t)}%;top:${Y(p.v)}%;--c:${s.color}"></i>`; }).join('');
  const marks = (o.marks || []).filter((m) => m.t >= t0 && m.t <= t1).map((m) => `<span class="ch-mark" style="left:${X(m.t)}%;color:${m.color || C.amber}">${esc(m.label)}</span>`).join('');
  const thr = (o.lines || []).map((l) => `<span class="ch-thrlabel" style="top:${Y(l.v)}%">${esc(l.label)}</span>`).join('');
  const band = o.band ? `<span class="ch-bandlabel" style="top:${Y(o.band.high)}%">参考 ${o.band.low}–${o.band.high}</span>` : '';
  const data = { t0, t1, d, u: o.unit || '', s: series.map((s) => ({ n: s.name, c: s.color, p: s.pts.map((p) => [p.t, p.v]) })) };
  const xt = [0, 1, 2, 3, 4].map((i) => `<span>${fmtClock(t0 + ((t1 - t0) * i) / 4)}</span>`).join('');
  const legend = series.length > 1 ? `<div class="ch-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)} <b>${num(s.pts[s.pts.length - 1].v, d)}</b></span>`).join('')}</div>` : '';
  return `<div class="ch" style="--h:${o.height || 150}px" data-ch="${esc(JSON.stringify(data))}">
    <div class="ch-y"><span>${num(hi, d)}</span><span>${num((hi + lo) / 2, d)}</span><span>${num(lo, d)}</span></div>
    <div class="ch-plot">${svg}${band}${thr}${marks}${dots}${thin ? '<span class="ch-thin">数据积累中</span>' : ''}<div class="ch-cross" hidden></div><div class="ch-tip" hidden></div></div>
    <div></div><div class="ch-x">${xt}</div></div>${legend}`;
}

// ---------- 仪表 ----------

const polar = (cx, cy, r, f) => { const a = ((200 - 220 * f) * Math.PI) / 180; return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
const arc = (cx, cy, r, f0, f1) => { const [x0, y0] = polar(cx, cy, r, f0); const [x1, y1] = polar(cx, cy, r, f1); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${(f1 - f0) * 220 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };

/** 半圆仪表：绿色弧是参考范围，指针是当前值 */
export function gauge({ label, value, min, max, low, high, unit = '', digits = 0, note = '' }) {
  const f = (x) => clamp01((x - min) / (max - min));
  const st = value < low ? ['偏低', 'warn'] : value > high ? ['偏高', 'warn'] : ['正常', 'ok'];
  const color = st[1] === 'ok' ? C.cyan : C.amber;
  const [nx, ny] = polar(70, 72, 52, f(value));
  const [ix, iy] = polar(70, 72, 36, f(value));
  const tick = (x) => { const [a, b] = polar(70, 72, 61, f(x)); const side = a < 62 ? 'end' : a > 78 ? 'start' : 'middle'; return `<text x="${a.toFixed(1)}" y="${(b + (side === 'middle' ? -1 : 2.5)).toFixed(1)}" text-anchor="${side}" class="ga-tick">${x}</text>`; };
  return `<div class="ga"><svg viewBox="0 0 140 96" role="img" aria-label="${esc(label)} ${num(value, digits)}${esc(unit)}，${st[0]}">
    <path d="${arc(70, 72, 52, 0, 1)}" class="ga-track"/>
    <path d="${arc(70, 72, 52, f(low), f(high))}" class="ga-band"/>
    <path d="${arc(70, 72, 52, 0, Math.max(0.004, f(value)))}" class="ga-val" style="stroke:${color}"/>
    <line x1="${ix.toFixed(2)}" y1="${iy.toFixed(2)}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" class="ga-needle"/>
    <circle cx="${nx.toFixed(2)}" cy="${ny.toFixed(2)}" r="3.4" fill="${color}" class="ga-knob"/>
    ${tick(low)}${tick(high)}
    <text x="70" y="70" class="ga-num">${num(value, digits)}</text><text x="70" y="84" class="ga-unit">${esc(unit)}</text>
  </svg><div class="ga-foot"><span>${esc(label)}</span><b class="${st[1]}">${st[1] === 'warn' ? '⚠ ' : ''}${st[0]}</b></div>${note ? `<div class="ga-note">${esc(note)}</div>` : ''}</div>`;
}

/** 小圆环：0–100 的水平 */
export function ring({ label, value, sub = '', color = C.cyan, text }) {
  const c = 2 * Math.PI * 25;
  return `<div class="rg"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="25" class="rg-track"/><circle cx="32" cy="32" r="25" class="rg-val" style="stroke:${color}" stroke-dasharray="${(c * clamp01(value / 100)).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/><text x="32" y="37" class="rg-num">${esc(text ?? Math.round(value))}</text></svg><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
}

/** 两种作用相反的量，从中间往两边画 */
export function balance(a, b) {
  const side = (x, cls) => `<div class="bal-side ${cls}"><div class="bal-bar"><i style="width:${clamp01(x.value / 100) * 100}%;background:${x.color}"></i></div><div class="bal-txt"><b>${Math.round(x.value)}</b> ${esc(x.name)}<small>${esc(x.note || '')}</small></div></div>`;
  return `<div class="bal">${side(a, 'l')}<div class="bal-mid"></div>${side(b, 'r')}</div>`;
}

/** 雷达图：每根轴 0–100 */
export function radar(items, { size = 250, color = C.cyan } = {}) {
  const cx = 150, cy = 122, R = 84, n = items.length;
  const pt = (i, r) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const poly = (r) => items.map((_, i) => pt(i, r).map((x) => x.toFixed(1)).join(',')).join(' ');
  const shape = items.map((x, i) => pt(i, R * clamp01(x.value / 100)).map((v) => v.toFixed(1)).join(',')).join(' ');
  return `<svg class="radar" viewBox="0 0 300 244" style="max-width:${size * 1.3}px" role="img" aria-label="${esc(items.map((x) => `${x.name} ${Math.round(x.value)}`).join('，'))}">
    ${[0.25, 0.5, 0.75, 1].map((k) => `<polygon points="${poly(R * k)}" class="rd-ring"/>`).join('')}
    ${items.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="rd-ring"/>`; }).join('')}
    ${items.some((x) => Number.isFinite(x.base)) ? `<polygon points="${items.map((x, i) => pt(i, R * clamp01((x.base ?? x.value) / 100)).map((v) => v.toFixed(1)).join(',')).join(' ')}" class="rd-base"/>` : ''}
    <polygon points="${shape}" class="rd-shape" style="fill:${color};stroke:${color}"/>
    ${items.map((x, i) => { const [a, b] = pt(i, R * clamp01(x.value / 100)); const [lx, ly] = pt(i, R + 17); const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
      return `<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="3" fill="${x.warn ? C.amber : color}"/><text x="${lx.toFixed(1)}" y="${(ly + 2).toFixed(1)}" text-anchor="${anchor}" class="rd-label${x.warn ? ' w' : ''}">${esc(x.name)}<tspan class="rd-v" dx="4">${Math.round(x.value)}</tspan></text>`; }).join('')}
  </svg>`;
}

/** 环形占比 */
export function donut(parts, center = '', sub = '') {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const c = 2 * Math.PI * 40;
  let acc = 0;
  const segs = parts.map((p) => { const len = (p.value / total) * c; const s = `<circle cx="60" cy="60" r="40" class="dn-seg" style="stroke:${p.color}" stroke-dasharray="${Math.max(0, len - 2).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-acc).toFixed(1)}" transform="rotate(-90 60 60)"/>`; acc += len; return s; }).join('');
  return `<div class="dn"><svg viewBox="0 0 120 120" aria-hidden="true">${segs}<text x="60" y="60" class="dn-num">${esc(center)}</text><text x="60" y="76" class="dn-sub">${esc(sub)}</text></svg>
    <div class="dn-legend">${parts.map((p) => `<div><i style="background:${p.color}"></i><span>${esc(p.name)}</span><b>${Math.round(p.value)}</b><em>${Math.round((p.value / total) * 100)}%</em></div>`).join('')}</div></div>`;
}

// ---------- 监护仪 ----------

/** 床旁监护仪：心电和呼吸两道波形，右边是读数 */
export function monitor({ hr, rr, nums = [], asleep = false }) {
  return `<div class="mon"><div class="mon-wave"><canvas data-mon data-hr="${hr}" data-rr="${rr}"></canvas><span class="mon-tag ecg">心电 II</span><span class="mon-tag resp">呼吸</span>${asleep ? '<span class="mon-tag sleep">睡眠中</span>' : ''}</div>
    <div class="mon-nums">${nums.map((x) => `<div style="--c:${x.color || C.green}"><span>${esc(x.name)}</span><b>${esc(x.value)}</b><small>${esc(x.unit || '')}</small>${x.ref ? `<em>${esc(x.ref)}</em>` : ''}</div>`).join('')}</div></div>`;
}

const g = (p, mu, sd) => Math.exp(-((p - mu) ** 2) / (2 * sd * sd));
/** 一次心跳里的心电波形：P 波、QRS 波群、T 波 */
export const ecgAt = (p) => 0.13 * g(p, 0.16, 0.026) - 0.13 * g(p, 0.262, 0.009) + 1.0 * g(p, 0.285, 0.0095) - 0.24 * g(p, 0.309, 0.01) + 0.3 * g(p, 0.52, 0.05);

function drawMonitor(c, tSec) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  // 心电图纸的网格
  x.lineWidth = 1;
  for (let i = 0; i * 12 < w; i++) { x.strokeStyle = i % 5 ? 'rgba(61,220,151,.045)' : 'rgba(61,220,151,.11)'; x.beginPath(); x.moveTo(i * 12 + 0.5, 0); x.lineTo(i * 12 + 0.5, h); x.stroke(); }
  for (let i = 0; i * 12 < h; i++) { x.strokeStyle = i % 5 ? 'rgba(61,220,151,.045)' : 'rgba(61,220,151,.11)'; x.beginPath(); x.moveTo(0, i * 12 + 0.5); x.lineTo(w, i * 12 + 0.5); x.stroke(); }
  const hr = Number(c.dataset.hr) || 70, rr = Number(c.dataset.rr) || 15;
  const speed = 110; // 每秒走多少像素
  const head = (tSec * speed) % w; // 扫描头的位置，像真的监护仪那样从左往右刷新
  const lane = (y0, amp, color, fn) => {
    x.strokeStyle = color; x.lineWidth = 1.7; x.lineJoin = 'round'; x.shadowColor = color; x.shadowBlur = 6;
    x.beginPath();
    let pen = false;
    for (let px = 0; px <= w; px += 1) {
      const age = (head - px + w) % w; // 这一列是多久以前画的
      if (age < 14 && px > head) { pen = false; continue; } // 扫描头前面留一小段空白
      const y = y0 - amp * fn(tSec - age / speed);
      if (!pen || px === Math.ceil(head)) { x.moveTo(px, y); pen = true; } else x.lineTo(px, y);
      if (Math.abs(px - head) < 1) pen = false;
    }
    x.stroke();
    x.shadowBlur = 0;
    x.fillStyle = '#fff'; x.beginPath(); x.arc(head, y0 - amp * fn(tSec), 2.2, 0, 7); x.fill();
  };
  lane(h * 0.5, h * 0.36, C.green, (t) => ecgAt((((t * hr) / 60) % 1 + 1) % 1));
  lane(h * 0.86, h * 0.09, C.cyan, (t) => Math.sin((t * rr * Math.PI * 2) / 60 - 1.2) ** 3 * 0.6 + Math.sin((t * rr * Math.PI * 2) / 60) * 0.5);
}

let loop = 0;
function tick() {
  const list = document.querySelectorAll('canvas[data-mon]');
  if (!list.length) { loop = 0; return; }
  const t = performance.now() / 1000;
  list.forEach((c) => drawMonitor(c, t));
  loop = requestAnimationFrame(tick);
}

/** 页面换了内容以后调用：让监护仪动起来，给曲线接上悬停读数 */
export function mountCharts(root) {
  mountEeg(root);
  const mons = root.querySelectorAll('canvas[data-mon]');
  if (mons.length) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    mons.forEach((c) => drawMonitor(c, still ? 3.2 : performance.now() / 1000));
    if (!still && !loop) loop = requestAnimationFrame(tick);
  }
  root.querySelectorAll('.ch[data-ch]').forEach((el) => {
    const plot = el.querySelector('.ch-plot');
    const cross = el.querySelector('.ch-cross');
    const tip = el.querySelector('.ch-tip');
    let data;
    plot.addEventListener('mousemove', (e) => {
      data = data || JSON.parse(el.dataset.ch);
      const r = plot.getBoundingClientRect();
      const k = clamp01((e.clientX - r.left) / r.width);
      const t = data.t0 + (data.t1 - data.t0) * k;
      const near = (pts) => pts.reduce((a, p) => (Math.abs(p[0] - t) < Math.abs(a[0] - t) ? p : a), pts[0]);
      cross.hidden = tip.hidden = false;
      cross.style.left = `${k * 100}%`;
      tip.style.left = `${k * 100}%`;
      tip.classList.toggle('flip', k > 0.7);
      tip.innerHTML = `<time>${fmtClock(t)}</time>${data.s.map((s) => `<div><i style="background:${s.c}"></i>${esc(s.n)} <b>${num(near(s.p)[1], data.d)}</b> ${esc(data.u)}</div>`).join('')}`;
    });
    plot.addEventListener('mouseleave', () => { cross.hidden = tip.hidden = true; });
  });
}

// ---------- 器官和液体 ----------

/** 一个装着液体的形状：shape 是 SVG 路径，box 是它的外框，level 是 0–1 的液面 */
export function liquid(shape, box, level, color) {
  const id = nextId('lq');
  const top = box.y + box.h * (1 - clamp01(level));
  let wave = `M${box.x - 40} ${top.toFixed(1)}`;
  for (let x = box.x - 40; x < box.x + box.w + 40; x += 20) wave += ` q5 ${(x / 20) % 2 ? 3 : -3} 10 0 t10 0`;
  wave += ` V${box.y + box.h + 4} H${box.x - 40} Z`;
  return `<defs><clipPath id="${id}"><path d="${shape}"/></clipPath><linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".95"/><stop offset="1" stop-color="${color}" stop-opacity=".35"/></linearGradient></defs>
    <path d="${shape}" class="lq-back"/><g clip-path="url(#${id})"><path d="${wave}" fill="url(#${id}g)" class="lq-wave"/></g><path d="${shape}" class="lq-glass" style="stroke:${color}"/>`;
}

const roundRect = (x, y, w, h, r) => `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;

const label = (x, y, name, value, note, warn) => `<text x="${x}" y="${y}" class="og-name">${esc(name)}</text><text x="${x}" y="${y + 21}" class="og-val${warn ? ' w' : ''}">${esc(value)}</text><text x="${x}" y="${y + 37}" class="og-note">${esc(note)}</text>`;
const flowArrow = (x0, x1, y, text) => `<path d="M${x0} ${y} H${x1}" class="og-flow"/><path d="M${x1 - 7} ${y - 5} L${x1} ${y} L${x1 - 7} ${y + 5}" class="og-head"/><text x="${(x0 + x1) / 2}" y="${y - 9}" class="og-step">${esc(text)}</text>`;

/** 消化通路：胃 → 小肠 → 血液 → 肝。每个器官里的液面就是它现在的量 */
export function digestTract({ stomach, intestine, glucose, glucoseText, glucoseWarn, glycogen, satiety }) {
  const st = 'M96 34 C96 22 114 22 114 36 L114 52 C150 50 188 70 186 112 C184 152 146 170 110 160 C92 155 80 160 70 176 L54 168 C62 148 60 130 60 110 C60 84 74 66 96 60 Z';
  const liver = 'M806 70 C840 50 900 52 940 66 C962 74 966 96 950 108 C920 130 880 150 846 156 C822 160 800 146 798 120 C796 100 796 80 806 70 Z';
  const gut = 'M262 64 H476 C506 64 506 104 476 104 H292 C262 104 262 144 292 144 H506';
  const len = 760;
  const fill = clamp01(intestine / 100) * len;
  const vessel = roundRect(586, 84, 150, 46, 23);
  return `<svg class="organ" viewBox="0 0 1000 232" role="img" aria-label="消化通路：胃 ${Math.round(stomach)}%，小肠 ${Math.round(intestine)}%，血糖 ${esc(glucoseText)}，肝糖原 ${Math.round(glycogen)}%">
    ${liquid(st, { x: 54, y: 22, w: 134, h: 156 }, stomach / 100, C.amber)}
    ${flowArrow(196, 244, 104, '排空')}
    <path d="${gut}" class="gut-back"/><path d="${gut}" class="gut-fill" stroke-dasharray="${fill.toFixed(0)} ${len}"/><path d="${gut}" class="gut-move"/>
    ${flowArrow(524, 578, 104, '吸收')}
    ${liquid(vessel, { x: 586, y: 84, w: 150, h: 46 }, 0.25 + clamp01(glucose / 100) * 0.7, C.pink)}
    ${[0, 1, 2, 3].map((i) => `<circle r="4.5" cy="107" class="rbc" style="animation-delay:${-i * 0.9}s"/>`).join('')}
    ${flowArrow(744, 792, 104, '储存')}
    ${liquid(liver, { x: 796, y: 52, w: 170, h: 108 }, glycogen / 100, C.violet)}
    ${label(120, 196, '胃', `${Math.round(stomach)}%`, stomach < 10 ? '空了' : stomach > 75 ? '很满' : '消化中', false)}
    ${label(384, 196, '小肠', `${Math.round(intestine)}%`, intestine < 5 ? '没有东西在吸收' : '正在吸收养分', false)}
    ${label(661, 196, '血糖', glucoseText, glucoseWarn || '可以直接用的能量', !!glucoseWarn)}
    ${label(880, 196, '肝糖原', `${Math.round(glycogen)}%`, '存起来的能量', false)}
    <text x="996" y="30" class="og-side">饱腹 <tspan class="og-sidev${satiety < 30 ? ' w' : ''}">${Math.round(satiety)}</tspan></text>
  </svg>`;
}

/** 细胞外液的三个部分，高度按升数画 */
export function fluidTanks({ plasma, tissue, lymph }) {
  const tank = (x, w, liters, cap, color, name, note) => `${liquid(roundRect(x, 30, w, 130, 14), { x, y: 30, w, h: 130 }, liters / cap, color)}<text x="${x + w / 2}" y="186" class="og-name">${esc(name)}</text><text x="${x + w / 2}" y="207" class="og-val">${liters.toFixed(1)} L</text><text x="${x + w / 2}" y="223" class="og-note">${esc(note)}</text>`;
  const ex = (x0, x1, y, text, both) => `<path d="M${x0} ${y} H${x1}" class="og-flow"/><path d="M${x1 - 7} ${y - 5} L${x1} ${y} L${x1 - 7} ${y + 5}" class="og-head"/>${both ? `<path d="M${x0 + 7} ${y - 5} L${x0} ${y} L${x0 + 7} ${y + 5}" class="og-head"/>` : ''}<text x="${(x0 + x1) / 2}" y="${y - 9}" class="og-step">${esc(text)}</text>`;
  return `<svg class="organ" viewBox="0 0 1000 232" role="img" aria-label="血浆 ${plasma.toFixed(1)} 升，组织液 ${tissue.toFixed(1)} 升，淋巴液 ${lymph.toFixed(1)} 升">
    ${tank(90, 150, plasma, 5, C.pink, '血浆', '在血管里')}${ex(256, 394, 86, '渗出 ⇄ 回流', true)}
    ${tank(410, 220, tissue, 14, C.cyan, '组织液', '细胞直接生活的环境')}${ex(646, 754, 86, '进入毛细淋巴管', false)}
    ${tank(770, 140, lymph, 4, C.green, '淋巴液', '经淋巴循环回到血浆')}
    <path d="M840 22 C840 6 700 6 500 6 C300 6 165 6 165 22" class="og-flow dash"/><path d="M160 14 L165 23 L171 14" class="og-head"/><text x="500" y="20" class="og-step">淋巴回流</text>
  </svg>`;
}

/** 膀胱 */
export function bladder(level) {
  const shape = 'M100 22 C150 22 176 60 170 104 C165 140 138 158 112 160 L112 184 L88 184 L88 160 C62 158 35 140 30 104 C24 60 50 22 100 22 Z';
  return `<svg class="organ sm" viewBox="0 0 200 196" role="img" aria-label="膀胱充盈 ${Math.round(level)}%">
    <path d="M62 0 C62 14 76 16 84 26 M138 0 C138 14 124 16 116 26" class="og-flow"/>
    ${liquid(shape, { x: 26, y: 22, w: 148, h: 162 }, 0.12 + clamp01(level / 100) * 0.8, level >= 80 ? C.amber : '#e8c860')}
    <text x="100" y="100" class="og-big">${Math.round(level)}%</text>
  </svg>`;
}

/** 分级调节和负反馈：上一级促进下一级，最后的激素反过来抑制前两级 */
export function axis(nodes, target) {
  const y = [22, 104, 186];
  const last = nodes[2].value;
  return `<svg class="axis" viewBox="0 0 250 262" role="img" aria-label="${esc(nodes.map((n) => `${n.organ}分泌${n.hormone} ${Math.round(n.value)}`).join('，'))}，负反馈">
    ${nodes.map((n, i) => `<rect x="20" y="${y[i]}" width="150" height="44" rx="9" class="ax-node"/><rect x="20" y="${y[i] + 41}" width="${150 * clamp01(n.value / 100)}" height="3" rx="1.5" fill="${n.color || C.cyan}"/>
      <text x="32" y="${y[i] + 19}" class="ax-organ">${esc(n.organ)}</text><text x="32" y="${y[i] + 34}" class="ax-h">${esc(n.hormone)}</text><text x="160" y="${y[i] + 29}" class="ax-v" style="fill:${n.color || C.cyan}">${Math.round(n.value)}</text>
      ${i < 2 ? `<path d="M95 ${y[i] + 46} V${y[i + 1] - 4}" class="ax-arrow"/><path d="M90 ${y[i + 1] - 10} L95 ${y[i + 1] - 3} L100 ${y[i + 1] - 10}" class="ax-head"/><text x="104" y="${y[i] + 66}" class="ax-plus">＋ 促进</text>` : ''}`).join('')}
    <path d="M170 208 H214 Q226 208 226 196 V56 Q226 44 214 44 H178" class="ax-fb" style="opacity:${0.4 + clamp01(last / 100) * 0.6}"/><path d="M185 39 L177 44 L185 49" class="ax-fbhead"/>
    <path d="M226 126 H178" class="ax-fb" style="opacity:${0.4 + clamp01(last / 100) * 0.6}"/><path d="M185 121 L177 126 L185 131" class="ax-fbhead"/>
    <text x="248" y="16" class="ax-minus">－ 负反馈（抑制）</text>
    <text x="95" y="254" class="ax-target">${esc(target)}</text>
  </svg>`;
}

/** 24 小时表盘：一圈是一天，点是今天发生的事 */
export function dial24(marks, now = Date.now(), center = '') {
  const ang = (t) => { const d = new Date(t); return ((d.getHours() + d.getMinutes() / 60) / 24) * Math.PI * 2 - Math.PI / 2; };
  const hourAng = (h) => (h / 24) * Math.PI * 2 - Math.PI / 2;
  const P = (a, r) => [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
  const seg = (h0, h1, cls) => { const [x0, y0] = P(hourAng(h0), 70); const [x1, y1] = P(hourAng(h1), 70); return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A70 70 0 ${((h1 - h0 + 24) % 24) > 12 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" class="${cls}"/>`; };
  const [hx, hy] = P(ang(now), 70);
  return `<svg class="dial" viewBox="0 0 200 200" role="img" aria-label="今天 24 小时里的 ${marks.length} 件事">
    <circle cx="100" cy="100" r="70" class="dl-track"/>${seg(23, 7, 'dl-night')}
    ${[...Array(24)].map((_, h) => { const [a, b] = P(hourAng(h), h % 6 ? 77 : 79); const [c, d] = P(hourAng(h), 83); return `<line x1="${a.toFixed(1)}" y1="${b.toFixed(1)}" x2="${c.toFixed(1)}" y2="${d.toFixed(1)}" class="dl-tick"/>`; }).join('')}
    ${[0, 6, 12, 18].map((h) => { const [a, b] = P(hourAng(h), 93); return `<text x="${a.toFixed(1)}" y="${(b + 3.5).toFixed(1)}" class="dl-h">${h}</text>`; }).join('')}
    ${marks.map((m) => { const [a, b] = P(ang(m.t), 70); return `<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="5" fill="${m.color || C.amber}" class="dl-dot"><title>${esc(fmtClock(m.t))} ${esc(m.label)}</title></circle>`; }).join('')}
    <line x1="100" y1="100" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" class="dl-hand"/><circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="3" fill="#fff"/>
    <text x="100" y="98" class="dl-now">${fmtClock(now)}</text><text x="100" y="114" class="dl-sub">${esc(center)}</text>
  </svg>`;
}

/** 三道防线：从外到内三圈，数字是每一道拦下的次数 */
export function shields(counts, fever) {
  const ringOf = (r, n, color, name, sub, y) => `<circle cx="130" cy="118" r="${r}" class="sh-ring" style="stroke:${color};stroke-width:${3 + Math.min(6, n)}"/><text x="130" y="${y}" class="sh-name" style="fill:${color}">${esc(name)} · ${n} 次</text>`;
  return `<svg class="shield" viewBox="0 0 260 232" role="img" aria-label="三道防线分别拦下 ${counts.join('、')} 次">
    ${ringOf(104, counts[0], C.blue, '第一道', '', 18)}${ringOf(74, counts[1], C.cyan, '第二道', '', 48)}${ringOf(44, counts[2], C.green, '第三道', '', 78)}
    <circle cx="130" cy="118" r="20" class="sh-core${fever ? ' hot' : ''}"/><text x="130" y="122" class="sh-her">${fever ? '战斗中' : '她'}</text>
  </svg>`;
}

/** 突触：前膜的囊泡放出递质，穿过间隙，和后膜上的受体结合 */
export function synapse() {
  return `<svg class="organ" viewBox="0 0 1000 170" role="img" aria-label="突触：神经递质从突触前膜释放，经突触间隙到达突触后膜的受体">
    <path d="M0 62 H300 C330 62 350 30 410 30 C470 30 470 140 410 140 C350 140 330 108 300 108 H0 Z" class="sy-pre"/>
    ${[[350, 70], [380, 52], [384, 96], [412, 72], [420, 112], [350, 104], [420, 46]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" class="sy-ves"/><circle cx="${x}" cy="${y}" r="3" class="sy-nt"/>`).join('')}
    ${[0, 1, 2, 3, 4, 5].map((i) => `<circle r="4" cx="462" cy="${46 + i * 16}" class="sy-fly" style="animation-delay:${-i * 0.37}s"/>`).join('')}
    <path d="M1000 40 H640 C590 40 574 60 574 85 C574 110 590 130 640 130 H1000 Z" class="sy-post"/>
    ${[48, 68, 88, 108].map((y) => `<path d="M578 ${y - 6} h-12 v12 h12" class="sy-rec"/>`).join('')}
    <path d="M40 85 H280" class="sy-ap"/><path d="M660 85 H960" class="sy-ap post"/>
    <text x="150" y="26" class="og-step">动作电位到达</text><text x="410" y="162" class="og-name">突触前膜 · 囊泡</text><text x="518" y="20" class="og-step">突触间隙</text><text x="760" y="162" class="og-name">突触后膜 · 受体</text><text x="820" y="26" class="og-step">产生新的电位</text>
  </svg>`;
}

// ---------- 意识、记忆、神经用的图 ----------

/** 竖条图：每条一个值，比如每天记住了几件事 */
export function bars(items, { height = 120, color = C.cyan, unit = '' } = {}) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return `<div class="bars" style="--h:${height}px" role="img" aria-label="${esc(items.map((x) => `${x.label} ${x.value}${unit}`).join('，'))}">${items.map((x) => `<div class="bar-c" title="${esc(x.title || `${x.label}：${x.value}${unit}`)}"><b>${x.value || ''}</b><i style="height:${(x.value / max) * 100}%;background:linear-gradient(180deg, ${x.color || color}, color-mix(in srgb, ${x.color || color} 25%, transparent))"></i><span>${esc(x.label)}</span></div>`).join('')}</div>`;
}

/** 带阈值线的横条：过了线就会去做 */
export function thresholdBars(items, threshold, note) {
  return `<div class="thb" style="--thr:${threshold}%">${items.map((x) => `<div class="thb-row${x.value >= threshold ? ' over' : ''}"><span>${esc(x.name)}</span><div class="thb-track"><i style="width:${clamp01(x.value / 100) * 100}%"></i></div><b>${Math.round(x.value)}</b></div>`).join('')}<div class="thb-note"><span style="left:${threshold}%">${esc(note)}</span></div></div>`;
}

/** 情绪平面：横轴是愉悦，纵轴是唤醒，点是她现在的位置，拖尾是最近走过的路 */
export function affectPlane({ P, A, label, trail = [] }) {
  const X = (p) => 110 + Math.max(-1, Math.min(1, p)) * 92, Y = (a) => 110 - Math.max(-1, Math.min(1, a)) * 92;
  const path = trail.length > 1 ? `<path d="M${trail.map((t) => `${X(t.P).toFixed(1)} ${Y(t.A).toFixed(1)}`).join(' L')}" class="af-trail"/>` : '';
  return `<svg class="affect" viewBox="0 0 220 220" role="img" aria-label="情绪：${esc(label)}，愉悦 ${P.toFixed(2)}，唤醒 ${A.toFixed(2)}">
    <rect x="18" y="18" width="184" height="184" rx="10" class="af-box"/>
    <circle cx="110" cy="110" r="46" class="af-ring"/><circle cx="110" cy="110" r="92" class="af-ring"/>
    <line x1="18" y1="110" x2="202" y2="110" class="af-axis"/><line x1="110" y1="18" x2="110" y2="202" class="af-axis"/>
    <text x="160" y="40" class="af-q">兴奋</text><text x="60" y="40" class="af-q">焦虑</text><text x="160" y="190" class="af-q">平静</text><text x="60" y="190" class="af-q">委屈</text>
    <text x="202" y="214" class="af-ax" text-anchor="end">愉悦 →</text><text x="18" y="12" class="af-ax">↑ 唤醒</text>
    ${path}<circle cx="${X(P).toFixed(1)}" cy="${Y(A).toFixed(1)}" r="13" class="af-halo"/><circle cx="${X(P).toFixed(1)}" cy="${Y(A).toFixed(1)}" r="5.5" class="af-dot"/>
    <text x="${X(P).toFixed(1)}" y="${(Y(A) - 17).toFixed(1)}" class="af-label">${esc(label)}</text>
  </svg>`;
}

/** 反射弧：感受器 → 传入神经 → 神经中枢 → 传出神经 → 效应器 */
export function reflexArc(active) {
  const nodes = [['感受器', '接受刺激', 60, 64], ['传入神经', '把信号送进去', 250, 37], ['神经中枢', '脊髓或脑', 500, 64], ['传出神经', '把指令送出来', 750, 91], ['效应器', '肌肉或腺体', 940, 64]];
  const d = 'M60 64 C160 20 360 20 500 64 C640 108 840 108 940 64';
  return `<svg class="organ" viewBox="0 0 1000 150" role="img" aria-label="反射弧：感受器、传入神经、神经中枢、传出神经、效应器">
    <path d="${d}" class="ra-path"/><path d="${d}" class="ra-pulse${active ? ' on' : ''}"/>
    ${nodes.map(([n, s, x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 2 ? 22 : 13}" class="ra-node${i === 2 ? ' mid' : ''}"/><text x="${x}" y="${i === 1 ? 14 : 126}" class="og-name">${n}</text><text x="${x}" y="${i === 1 ? 74 : 144}" class="og-note">${s}</text>`).join('')}
  </svg>`;
}

/** 脑电示意：睡着是慢而高的波，放松是 α 波，专注是快而低的 β 波 */
export function eeg({ asleep, arousal, band, hz, state }) {
  return `<div class="mon eeg"><div class="mon-wave"><canvas data-eeg data-asleep="${asleep ? 1 : 0}" data-arousal="${arousal.toFixed(2)}"></canvas><span class="mon-tag" style="top:8px;color:${C.violet}">额叶</span><span class="mon-tag" style="top:76px;color:${C.cyan}">顶叶</span><span class="mon-tag" style="top:144px;color:${C.green}">枕叶</span></div>
    <div class="mon-nums"><div style="--c:${C.violet}"><span>主要节律</span><b>${esc(band)}</b><small>${esc(hz)}</small></div><div style="--c:${C.cyan}"><span>状态</span><b>${esc(state)}</b></div></div></div>`;
}

function drawEeg(c, t) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const x = c.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  x.strokeStyle = 'rgba(127,178,255,.07)'; x.lineWidth = 1;
  for (let i = 0; i * 24 < w; i++) { x.beginPath(); x.moveTo(i * 24 + 0.5, 0); x.lineTo(i * 24 + 0.5, h); x.stroke(); }
  const asleep = c.dataset.asleep === '1', ar = Number(c.dataset.arousal) || 0;
  const beta = asleep ? 0.05 : clamp01(0.25 + ar * 0.6), alpha = asleep ? 0.15 : clamp01(0.75 - ar * 0.55), delta = asleep ? 1 : 0.08;
  const wave = (s, k) => delta * Math.sin(s * 2 * Math.PI * 2 + k) + alpha * 0.5 * Math.sin(s * 10 * Math.PI * 2 + k * 2) * (0.6 + 0.4 * Math.sin(s * 0.9 + k)) + beta * 0.22 * (Math.sin(s * 21 * Math.PI * 2 + k) + Math.sin(s * 27.3 * Math.PI * 2 + k * 3));
  const speed = 110, head = (t * speed) % w;
  [[C.violet, 0.2, 0], [C.cyan, 0.52, 1.7], [C.green, 0.84, 3.1]].forEach(([color, yk, k]) => {
    x.strokeStyle = color; x.lineWidth = 1.4; x.shadowColor = color; x.shadowBlur = 5;
    x.beginPath();
    let pen = false;
    for (let px = 0; px <= w; px += 1) {
      const age = (head - px + w) % w;
      if (px > head && age > w - 14) { pen = false; continue; }
      const y = h * yk - h * 0.12 * wave(t - age / speed, k);
      if (!pen) { x.moveTo(px, y); pen = true; } else x.lineTo(px, y);
      if (Math.abs(px - head) < 1) pen = false;
    }
    x.stroke(); x.shadowBlur = 0;
  });
}
let eegLoop = 0;
function eegTick() {
  const list = document.querySelectorAll('canvas[data-eeg]');
  if (!list.length) { eegLoop = 0; return; }
  list.forEach((c) => drawEeg(c, performance.now() / 1000));
  eegLoop = requestAnimationFrame(eegTick);
}
function mountEeg(root) {
  const list = root.querySelectorAll('canvas[data-eeg]');
  if (!list.length) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  list.forEach((c) => drawEeg(c, still ? 3.2 : performance.now() / 1000));
  if (!still && !eegLoop) eegLoop = requestAnimationFrame(eegTick);
}
