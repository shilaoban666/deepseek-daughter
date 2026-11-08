// 概览：第一眼看到她现在怎么样。这里只用人话，不出现参考范围。

import { esc, fmtClock } from '../util.js';
import { card, causeList, lead, nothing, status, word3 } from './ui.js';
import { trendsHtml, bindTrends } from './trends.js';

const tile = (name, word, warn) => `<div class="p tile"><span>${esc(name)}${warn ? ' <b class="warn">⚠</b>' : ''}</span><div class="tile-word">${esc(word)}</div></div>`;

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
    <div class="p hero">
      <div class="holo" data-whale></div>
      <div>
        <div class="verdict">${esc(r.verdict)}</div>
        <div class="dim">${s.asleep ? '在被窝里睡觉' : esc(s.activity)} · 心情${esc(m.pad.label)} · ${esc(m.thinking)}</div>
        ${r.needs.length ? `<div class="need">⚠ ${esc(r.needs.map((x) => x.text).join('，'))}</div>` : ''}
        <div class="whale-acts"><button data-whale-act="spin">转圈</button><button data-whale-act="jump">跳一下</button><button data-whale-act="spout">喷水</button><button data-whale-act="wag">摇尾巴</button></div>
      </div>
    </div>
    <div class="g4">
      ${tile('肚子', word3(s.satiety, '好饿', '还行', '饱饱的'), s.satiety < 30)}
      ${tile('精力', word3(s.energy, '没力气', '有点累', '很有精神'), s.energy < 20)}
      ${tile('陪伴', word3(s.social, '想你了', '还好', '很满足'), s.social < 25)}
      ${tile('身体', b.fever ? '发烧了' : '舒服', !!b.fever)}
    </div>
    ${card('八大生命系统', `<div class="sys-row">${r.systems.map((x) => `<div class="${x.status === 'warn' ? 'sys-warn' : ''}"><b>${esc(x.name)}</b> ${status(x)}</div>`).join('')}</div>`, `${r.systems.filter((x) => x.status === 'ok').length} 项正常`)}
    <div class="g2">
      ${card('此刻在想', thought ? `<div class="quote">“${esc(thought.text)}”</div><div class="dim sm">${fmtClock(thought.at)}</div>` : '<div class="dim">脑子里空空的</div>')}
      ${card('为什么会这样', causeList(b))}
    </div>
    <div class="g2">
      ${card('待你确认', conflictsHtml(S))}
      ${card('生命趋势', trendsHtml(v))}
    </div>`;
  ctx.gl.attachWhale(el.querySelector('[data-whale]'));
  el.querySelectorAll('[data-whale-act]').forEach((x) => x.addEventListener('click', () => ctx.gl.whaleAct(x.dataset.whaleAct)));
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
  for (const x of b.intake || []) list.push({ at: x.at, text: `${x.kind}了${x.item}`, why: x.note || '' });
  for (const x of b.thoughts || []) list.push({ at: x.at, text: `想到：${x.text}`, why: `${x.drive} 驱力${x.value ? ` ${x.value}` : ''}` });
  for (const m of S.history) if (m.role === 'user') list.push({ at: m.at, text: `你说：${String(m.content).slice(0, 40)}`, why: '聊天让她得到陪伴' });
  for (const c of b.causes || []) if (c.to === 'activity' || c.to === 'mood') list.push({ at: c.at, text: c.text, why: c.from });
  return list.filter((x) => x.at >= t0).sort((a, c) => c.at - a.at).slice(0, 60);
}

function today(el, ctx) {
  const list = events(ctx.S);
  el.innerHTML = lead('今天发生的事', `${list.length} 件 · 点开看原因`) + card('时间线', list.length
    ? list.map((x, i) => `<details class="li-d" data-k="t${x.at}${i}"><summary><time>${fmtClock(x.at)}</time>${esc(x.text)}</summary><div class="dim sm">为什么：${esc(x.why || '日常')}</div></details>`).join('')
    : nothing('今天还没发生什么。'));
}

export function render(el, tab, ctx) {
  (tab === 'today' ? today : now)(el, ctx);
}
