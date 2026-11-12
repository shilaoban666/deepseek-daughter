// 我们：回忆、黑话、关系、纪念日。纪念日页下面有一条时间轴，把你们一路走过的事按月归档。

import { esc, fmtClock, fmtTime } from '../util.js';
import { card, lead, li, nothing } from './ui.js';
import { C, bars, ring } from './charts.js';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const KINDS = {
  anniversary: { name: '纪念日', color: C.pink },
  days: { name: '在一起', color: C.cyan },
  memory: { name: '回忆', color: C.amber },
  growth: { name: '她的成长', color: C.violet },
  slang: { name: '你们的话', color: C.green },
};
let kindFilter = 'all';

/** 一条竖着的时间轴，按月分组，新的在上面 */
function timeline(items, { clock = false } = {}) {
  if (!items.length) return nothing('这里还是空的。');
  let month = '';
  return `<div class="tl">${items.map((x) => {
    const d = new Date(x.at);
    const m = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
    const head = m === month ? '' : `<div class="tl-month">${m}</div>`;
    month = m;
    const k = KINDS[x.kind] || KINDS.memory;
    return `${head}<div class="tl-item${x.big ? ' key' : ''}" style="--c:${k.color}"><i></i><time>${d.getMonth() + 1}月${d.getDate()}日${clock ? ` ${fmtClock(x.at)}` : ''}</time><div><b>${esc(x.title)}</b>${x.sub ? `<span>${esc(x.sub)}</span>` : ''}</div><em>${esc(k.name)}</em></div>`;
  }).join('')}</div>`;
}

function moments(el, { S }) {
  const list = (S.memory.records || []).filter((r) => !r.archived && r.layer === 'episodic' && r.source?.kind === 'owner' && r.importance >= 0.35).sort((a, b) => b.at - a.at).slice(0, 60);
  const day0 = new Date().setHours(0, 0, 0, 0);
  const weeks = Array.from({ length: 12 }, (_, i) => { const t = day0 - (11 - i) * 7 * DAY; const d = new Date(t); return { label: i % 2 ? '' : `${d.getMonth() + 1}/${d.getDate()}`, title: `${d.getMonth() + 1}月${d.getDate()}日起的一周`, value: list.filter((r) => r.at >= t && r.at < t + 7 * DAY).length, color: C.amber }; });
  el.innerHTML = lead(`你们认识第 ${S.vitals.days || 1} 天`, '一起经历的事') +
    (list.length ? card('最近 12 周', bars(weeks, { height: 80, unit: ' 件' }), `共 ${list.length} 件回忆`) : '') +
    card('回忆', list.length ? timeline(list.map((r) => ({ at: r.at, kind: 'memory', title: r.text, big: r.importance >= 0.7 })), { clock: true }) : nothing('多聊聊，这里会慢慢攒起你们的回忆。'));
}

function slang(el, ctx) {
  const list = (ctx.S.us?.slang || []).filter((x) => !x.archived).sort((a, b) => b.count - a.count);
  el.innerHTML = lead('你们之间的话', '聊天时持续学习，长期不用会慢慢淡忘') + card('黑话词典', list.length ? li(list.map((x) => `<b class="term">${esc(x.term)}</b><span class="dim">${esc(x.meaning)}</span><em>用过 ${x.count} 次 · ${esc(fmtTime(x.firstAt || x.lastAt))}学会 <button class="btn" data-del="${esc(x.term)}">删除</button></em>`)) : nothing('还没学到。睡觉整理记忆时，她会发现你们反复说的专属用语。'));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { ctx.S.us = await ctx.fish.removeSlang(b.dataset.del); slang(el, ctx); }));
}

function relation(el, { S }) {
  const r = S.us?.relation || { intimacy: 0, trust: 0, reliance: 0 };
  const word = r.intimacy > 70 ? '形影不离' : r.intimacy > 40 ? '越来越熟了' : '刚刚认识';
  const chats = (S.history || []).filter((m) => m.role === 'user').length;
  const mem = (S.memory.records || []).filter((x) => !x.archived).length;
  el.innerHTML = lead(word, `认识第 ${S.vitals.days || 1} 天`) + `<div class="g2">
    ${card('现在的关系', `<div class="rings">${ring({ label: '亲密', value: r.intimacy, sub: '聊天和陪伴带来的', color: C.pink })}${ring({ label: '信任', value: r.trust, sub: '相处时间和共同记忆', color: C.cyan })}${ring({ label: '依赖', value: r.reliance, sub: '她有多想找你', color: C.violet })}</div>`)}
    ${card('这些数是怎么来的', `<div class="stats"><div class="stat"><b>${S.vitals.days || 1}</b><span>相处天数</span></div><div class="stat"><b>${chats}${chats >= 200 ? '+' : ''}</b><span>最近你说的话</span></div><div class="stat"><b>${mem}</b><span>共同记忆</span></div></div><div class="cap">都由你们真实的聊天次数、相处天数、共同记忆和她主动找你的次数算出来，没有一项是随便写的。</div>`)}
  </div>`;
}

/** 把一路走过的事收成一条时间轴：见面、每个纪念日过了几次、在一起的整数天、重要的回忆、她的成长、学会的话 */
function archive(S) {
  const now = Date.now();
  const us = S.us || {};
  const first = us.firstAt || now;
  const out = [{ at: first, kind: 'anniversary', title: '第一次见面', sub: '一切从这天开始', big: true }];
  for (const n of [7, 30, 100, 200, 365, 500, 730, 1000]) {
    const at = new Date(first).setHours(0, 0, 0, 0) + (n - 1) * DAY;
    if (at <= now) out.push({ at, kind: 'days', title: `在一起第 ${n} 天`, big: n >= 100 });
  }
  for (const x of us.dates || []) {
    const [y, m, d] = String(x.date).split('-').map(Number);
    if (!y) continue;
    for (let year = x.auto ? y + 1 : y; year <= new Date(now).getFullYear(); year++) {
      const at = new Date(year, m - 1, Math.min(d, new Date(year, m, 0).getDate())).getTime();
      if (at > now) break;
      const k = year - y;
      out.push({ at, kind: 'anniversary', title: x.auto ? `认识 ${k} 周年` : x.title, sub: x.auto ? '' : k ? `第 ${k} 年` : at < new Date(first).setHours(0, 0, 0, 0) ? '认识她之前的日子' : '', big: true });
    }
  }
  const mems = (S.memory.records || []).filter((r) => !r.archived && r.layer === 'episodic' && r.source?.kind === 'owner' && r.importance >= 0.6).sort((a, b) => b.importance - a.importance).slice(0, 20);
  for (const r of mems) out.push({ at: r.at, kind: 'memory', title: r.text });
  for (const g of (S.profile?.growth || []).filter((x) => !x.undone && x.at)) out.push({ at: g.at, kind: 'growth', title: `${g.traitName} ${g.delta > 0 ? '+' : ''}${g.delta}`, sub: g.reason });
  for (const x of (us.slang || []).filter((s) => !s.archived && s.firstAt)) out.push({ at: x.firstAt, kind: 'slang', title: `学会了「${x.term}」`, sub: x.meaning });
  return out.sort((a, b) => b.at - a.at);
}

function anniversary(el, ctx) {
  const { S } = ctx;
  const list = S.us?.anniversaries || [];
  const all = archive(S);
  const shown = all.filter((x) => kindFilter === 'all' || x.kind === kindFilter);
  const count = (k) => all.filter((x) => x.kind === k).length;
  const next = list[0];
  el.innerHTML = lead(next ? (next.daysLeft === 0 ? `今天是「${next.title}」` : `离「${next.title}」还有 ${next.daysLeft} 天`) : '还没有纪念日', `认识第 ${S.vitals.days || 1} 天 · 归档了 ${all.length} 件事`) + `<div class="g2">
    ${card('快到了', list.length ? `<div class="cd">${list.slice(0, 4).map((x) => `<div class="cd-item"><b>${x.daysLeft === 0 ? '今天' : x.daysLeft}</b><small>${x.daysLeft === 0 ? '' : '天后'}</small><span>${esc(x.title)}${x.years > 0 ? ` · 第 ${x.years} 年` : ''}</span><em>${esc(x.date)}${x.auto ? ' · 自动' : ` <button class="btn" data-del="${esc(x.id)}">删除</button>`}</em></div>`).join('')}</div>` : nothing('还没有纪念日。'), '一年之内')}
    ${card('添加一个纪念日', `<div class="an-form"><input id="anTitle" placeholder="比如：小明的生日" aria-label="纪念日名称" maxlength="30"><input id="anDate" type="date" aria-label="日期" max="${ymd(Date.now() + 3650 * DAY)}"><button class="btn" id="anAdd">添加</button></div><div class="cap">填过去的日期也可以，比如生日、第一次一起看电影的那天。每年到了这一天她都会记得，过去的每一次也会出现在下面的时间轴上。</div>`)}
  </div>` +
    card('时间轴', `<div class="tl-filter"><button class="chip ${kindFilter === 'all' ? 'on' : ''}" data-kind="all">全部 ${all.length}</button>${Object.entries(KINDS).map(([k, v]) => `<button class="chip ${kindFilter === k ? 'on' : ''}" data-kind="${k}" style="--c:${v.color}"><i></i>${v.name} ${count(k)}</button>`).join('')}</div>${timeline(shown)}`, '按月归档，新的在上面');
  el.querySelector('#anAdd').addEventListener('click', async () => {
    const title = el.querySelector('#anTitle').value.trim();
    const date = el.querySelector('#anDate').value;
    if (!title || !date) return ctx.toast('名称和日期都要填');
    ctx.S.us = await ctx.fish.addAnniversary({ title, date });
    anniversary(el, ctx);
  });
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { ctx.S.us = await ctx.fish.removeAnniversary(b.dataset.del); anniversary(el, ctx); }));
  el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { kindFilter = b.dataset.kind; anniversary(el, ctx); }));
}

const TABS = { moments, slang, relation, anniversary };
export function render(el, tab, ctx) {
  TABS[tab](el, ctx);
}
