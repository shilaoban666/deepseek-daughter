// 生命趋势：每项指标一个小图，有新数据才重画。

import { esc, fmtClock } from '../util.js';

const TRENDS = [
  { key: 'energy', name: '精力', warn: (x) => (x < 20 ? '有点累了' : '') },
  { key: 'satiety', name: '饱腹', warn: (x) => (x < 30 ? '饿了' : '') },
  { key: 'social', name: '陪伴', warn: (x) => (x < 25 ? '想有人陪' : '') },
  { key: 'mood', name: '愉悦', warn: (x) => (x < 35 ? '情绪低落' : '') },
  { key: 'cortisol', name: '皮质醇', warn: (x) => (x > 55 ? '压力偏高' : '') },
];
const WINDOW = 6 * 3600000;

function sparkPath(values) {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 14) {
    const mid = (hi + lo) / 2;
    lo = Math.max(0, mid - 7);
    hi = lo + 14;
  }
  const n = values.length;
  const pts = values.map((x, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(28 - ((x - lo) / (hi - lo)) * 25).toFixed(2)}`);
  return { line: `M${pts.join('L')}`, area: `M0,30L${pts.join('L')}L100,30Z` };
}

function dataOf(v) {
  const all = v.vitals || [];
  const t1 = all[all.length - 1]?.t ?? 0;
  return all.filter((p) => p.t >= t1 - WINDOW);
}

/** 单条折线，比如心率 */
export function sparkline(values) {
  if (values.length < 2) return '<div class="dim sm">数据积累中</div>';
  const p = sparkPath(values);
  return `<div class="trend-plot tall"><svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="${p.area}" class="a"/><path d="${p.line}" class="l"/></svg></div>`;
}

export function trendsHtml(v) {
  const data = dataOf(v);
  if (data.length < 2 || data[data.length - 1].t - data[0].t < 10 * 60000) return '<div class="dim">数据积累中，再过几分钟就能看到趋势。</div>';
  const rows = TRENDS.map((m) => {
    const values = data.map((p) => p[m.key] ?? 0);
    const cur = values[values.length - 1];
    return { ...m, values, cur, delta: Math.round(cur - values[0]), warning: m.warn(cur) };
  });
  const alerts = rows.filter((r) => r.warning);
  const big = [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const change = big.delta ? `变化最大：${big.name} ${big.delta > 0 ? '↑' : '↓'}${Math.abs(big.delta)}` : '这段时间很平稳';
  return `<div class="trend-sum">${alerts.length ? `<b class="warn">⚠ ${alerts.map((r) => esc(r.warning)).join('、')}</b>` : '<b>✓ 状态良好</b>'}<span>${esc(change)}</span></div>
    <div class="trend-grid">${rows.map((r) => {
      const p = sparkPath(r.values);
      return `<div class="trend" data-key="${r.key}"><div class="trend-top"><span>${esc(r.name)}</span>${r.warning ? '<i class="warn">⚠</i>' : ''}</div>
        <div class="trend-val"><b>${Math.round(r.cur)}</b><em>${r.delta === 0 ? '持平' : `${r.delta > 0 ? '↑' : '↓'}${Math.abs(r.delta)}`}</em></div>
        <div class="trend-plot"><svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="${p.area}" class="a"/><path d="${p.line}" class="l"/></svg><div class="cross" hidden></div></div></div>`;
    }).join('')}</div>`;
}

/** 悬停小图看任意时刻的值 */
export function bindTrends(root, v) {
  const data = dataOf(v);
  root.querySelectorAll('.trend').forEach((tile) => {
    const plot = tile.querySelector('.trend-plot');
    const val = tile.querySelector('.trend-val');
    const base = val.innerHTML;
    const cross = tile.querySelector('.cross');
    plot.addEventListener('mousemove', (e) => {
      const r = plot.getBoundingClientRect();
      const k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const p = data[Math.round(k * (data.length - 1))];
      cross.hidden = false;
      cross.style.left = `${k * 100}%`;
      val.innerHTML = `<b>${Math.round(p[tile.dataset.key] ?? 0)}</b><em>${fmtClock(p.t)}</em>`;
    });
    plot.addEventListener('mouseleave', () => { cross.hidden = true; val.innerHTML = base; });
  });
}
