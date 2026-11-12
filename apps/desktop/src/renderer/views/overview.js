// 概览：第一眼看到她现在怎么样。这里只用人话，不出现参考范围。

import { esc, fmtClock } from '../util.js';
import { card, causeList, lead, nothing, status, word3 } from './ui.js';
import { trendsHtml, bindTrends } from './trends.js';
import { C, bars, dial24, hist, radar, ring, timeChart } from './charts.js';

const tile = (name, word, warn, value) => `<div class="p tile"><div><span>${esc(name)}${warn ? ' <b class="warn">⚠</b>' : ''}</span><div class="tile-word">${esc(word)}</div></div>${ring({ label: '', value, color: warn ? C.amber : C.cyan })}</div>`;

function conflictsHtml(S) {
  const list = (S.memory.conflicts || []).filter((c) => !c.resolved);
  if (!list.length) return '<div class="dim">没有需要你确认的事。</div>';
  return list.slice(0, 2).map((c) => {
    const a = S.memory.records.find((r) => r.id === c.id);
    const b = S.memory.records.find((r) => r.id === c.with);
    return `<div class="sm">两段记忆对不上：「${esc(a?.text || c.texts?.[0] || '')}」和「${esc(b?.text || c.texts?.[1] || '')}」</div>
      <div class="btns"><button class="btn" data-keep="${esc(c.id)}" data-vs="${esc(c.id)}">留前一条</button><button class="btn" data-keep="${esc(c.with)}" data-vs="${esc(c.id)}">留后一条</button></div>`;
  }).join('');
}

function now(el, ctx) {
  const { S } = ctx;
  const v = S.vitals;
  const { state: s, body: b, mind: m } = v;
  const r = m.report;
  const thought = (b.thoughts || []).slice(-1)[0];
  el.innerHTML = `
    <div class="p hero${ctx.gl.hasPet() ? ' hero-pet' : ''}">
      <div class="holo" data-whale></div>
      <div>
        <div class="verdict">${esc(r.verdict)}</div>
        <div class="dim">${s.asleep ? '在被窝里睡觉' : esc(s.activity)} · 心情${esc(m.pad.label)} · ${esc(m.thinking)}</div>
        ${r.needs.length ? `<div class="need">⚠ ${esc(r.needs.map((x) => x.text).join('，'))}</div>` : ''}
        <div class="whale-acts"><button data-pet-act="poke">摸摸她</button><button data-pet-act="dance">跳支舞</button><button data-pet-act="wallet">看钱包</button><button data-pet-act="next">换一个</button></div>
      </div>
    </div>
    <div class="g4">
      ${tile('肚子', word3(s.satiety, '好饿', '还行', '饱饱的'), s.satiety < 30, s.satiety)}
      ${tile('精力', word3(s.energy, '没力气', '有点累', '很有精神'), s.energy < 20, s.energy)}
      ${tile('陪伴', word3(s.social, '想你了', '还好', '很满足'), s.social < 25, s.social)}
      ${tile('身体', b.fever ? '发烧了' : '舒服', !!b.fever, b.immunity)}
    </div>
    ${card('八大生命系统', `<div class="sysgrid">${radar(r.systems.map((x) => ({ name: x.name, value: x.value, warn: x.status === 'warn' })))}<div class="sysbars">${r.systems.map((x) => `<div class="sysbar ${x.status === 'warn' ? 'sys-warn' : ''}" title="${esc(x.why || '')}"><div class="h"><b>${esc(x.name)}</b>${status(x)}</div><div class="tr"><i style="width:${Math.max(0, Math.min(100, x.value))}%"></i></div></div>`).join('')}</div></div>`, `${r.systems.filter((x) => x.status === 'ok').length} 项正常`)}
    <div class="g2">
      ${card('此刻在想', thought ? `<div class="quote">“${esc(thought.text)}”</div><div class="dim sm">${fmtClock(thought.at)}</div>` : '<div class="dim">脑子里空空的</div>')}
      ${card('为什么会这样', causeList(b))}
    </div>
    ${card('生命趋势', trendsHtml(v) + '<div class="mt"></div>' + timeChart({ series: [{ name: '精力', pts: hist(v, 'energy'), cur: s.energy, color: C.cyan }, { name: '饱腹', pts: hist(v, 'satiety'), cur: s.satiety, color: C.amber }, { name: '陪伴', pts: hist(v, 'social'), cur: s.social, color: C.pink }, { name: '愉悦', pts: hist(v, 'mood'), cur: m.pad.P * 50 + 50, color: C.green }], min: 0, max: 100, height: 160, marks: (b.intake || []).filter((x) => x.kind === '吃').map((x) => ({ t: x.at, label: x.note || x.item })) }), '最近 6 小时 · 竖线是吃饭')}
    ${card('待你确认', conflictsHtml(S))}`;
  ctx.gl.attachPet(el.querySelector('[data-whale]'));
  el.querySelectorAll('[data-pet-act]').forEach((x) => x.addEventListener('click', () => ctx.gl.petAct(x.dataset.petAct)));
  el.querySelectorAll('[data-keep]').forEach((x) => x.addEventListener('click', () => { ctx.fish.resolveConflict(x.dataset.vs, x.dataset.keep); ctx.toast('已经按你选的留下来'); }));
  bindTrends(el, v);
}

function events(S) {
  const v = S.vitals;
  const b = v.body;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const list = [];
  for (const x of b.intake || []) list.push({ at: x.at, type: 'eat', text: `${x.kind}了${x.item}`, why: x.note || '' });
  for (const x of b.thoughts || []) list.push({ at: x.at, type: 'think', text: `想到：${x.text}`, why: `${x.drive} 驱力${x.value ? ` ${x.value}` : ''}` });
  for (const m of S.history) if (m.role === 'user') list.push({ at: m.at, type: 'chat', text: `你说：${String(m.content).slice(0, 40)}`, why: '聊天让她得到陪伴' });
  for (const c of b.causes || []) if (c.to === 'activity' || c.to === 'mood') list.push({ at: c.at, type: 'act', text: c.text, why: c.from });
  return list.filter((x) => x.at >= t0).sort((a, c) => c.at - a.at).slice(0, 60);
}

function today(el, ctx) {
  const list = events(ctx.S);
  const v = ctx.S.vitals;
  const t0 = new Date().setHours(0, 0, 0, 0);
  const KIND = { eat: ['吃喝', C.amber], chat: ['聊天', C.pink], think: ['念头', C.violet], act: ['活动和心情', C.cyan] };
  const count = (k) => list.filter((x) => x.type === k).length;
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: h % 3 ? '' : String(h), title: `${h} 点`, value: list.filter((x) => new Date(x.at).getHours() === h).length }));
  const today = (key) => hist(v, key).filter((p) => p.t >= t0);
  el.innerHTML = lead('今天发生的事', `${list.length} 件 · 点开看原因`) + `<div class="g3 wide1">
    ${card('一天的分布', `<div class="split">${dial24(list.map((x) => ({ t: x.at, label: x.text, color: KIND[x.type]?.[1] })), Date.now(), `${list.length} 件事`)}<div class="stats">${Object.entries(KIND).map(([k, [n, c]]) => `<div class="stat"><b style="color:${c}">${count(k)}</b><span>${n}</span></div>`).join('')}</div></div>`, '一圈是 24 小时')}
    ${card('哪个钟点最忙', bars(hours, { height: 110, unit: ' 件' }), '按小时')}
    ${card('今天的状态', timeChart({ series: [{ name: '精力', pts: today('energy'), cur: v.state.energy, color: C.cyan }, { name: '愉悦', pts: today('mood'), cur: v.mind.pad.P * 50 + 50, color: C.green }], min: 0, max: 100, height: 110 }), '从零点到现在')}
  </div>` + card('时间线', list.length
    ? list.map((x, i) => `<details class="li-d" data-k="t${x.at}${i}"><summary><time>${fmtClock(x.at)}</time>${esc(x.text)}</summary><div class="dim sm">为什么：${esc(x.why || '日常')}</div></details>`).join('')
    : nothing('今天还没发生什么。'));
}

export function render(el, tab, ctx) {
  (tab === 'today' ? today : now)(el, ctx);
}
