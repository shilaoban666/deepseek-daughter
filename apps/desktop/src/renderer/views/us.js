// 我们：回忆、黑话、关系、纪念日。

import { esc, fmtTime } from '../util.js';
import { card, lead, level, li, nothing } from './ui.js';

function moments(el, { S }) {
  const list = (S.memory.records || []).filter((r) => !r.archived && r.layer === 'episodic' && r.source?.kind === 'owner' && r.importance >= 0.35).sort((a, b) => b.at - a.at).slice(0, 40);
  el.innerHTML = lead(`你们认识第 ${S.vitals.days || 1} 天`, '一起经历的事') + card('回忆', list.length ? li(list.map((r) => `<time class="w">${esc(fmtTime(r.at))}</time><span>${esc(r.text)}</span>`)) : nothing('多聊聊，这里会慢慢攒起你们的回忆。'));
}

function slang(el, ctx) {
  const list = (ctx.S.us?.slang || []).filter((x) => !x.archived).sort((a, b) => b.count - a.count);
  el.innerHTML = lead('你们之间的话', '聊天时持续学习，长期不用会慢慢淡忘') + card('黑话词典', list.length ? li(list.map((x) => `<b class="term">${esc(x.term)}</b><span class="dim">${esc(x.meaning)}</span><em>用过 ${x.count} 次 <button class="btn" data-del="${esc(x.term)}">删除</button></em>`)) : nothing('还没学到。睡觉整理记忆时，她会发现你们反复说的专属用语。'));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { ctx.S.us = await ctx.fish.removeSlang(b.dataset.del); slang(el, ctx); }));
}

function relation(el, { S }) {
  const r = S.us?.relation || { intimacy: 0, trust: 0, reliance: 0 };
  const word = r.intimacy > 70 ? '形影不离' : r.intimacy > 40 ? '越来越熟了' : '刚刚认识';
  el.innerHTML = lead(word, `认识第 ${S.vitals.days || 1} 天`) + `<div class="g2">
    ${card('现在的关系', level('亲密', r.intimacy, '聊天和陪伴带来的') + level('信任', r.trust, '相处时间和共同记忆带来的') + level('依赖', r.reliance, '她有多想找你'))}
    ${card('这些数是怎么来的', '<div class="dim">都由你们真实的聊天次数、相处天数、共同记忆和她主动找你的次数算出来。</div>')}
  </div>`;
}

function anniversary(el, ctx) {
  const list = ctx.S.us?.anniversaries || [];
  el.innerHTML = card('快到了', list.length ? li(list.map((x) => `<b class="term mono">${x.daysLeft === 0 ? '今天' : `还有 ${x.daysLeft} 天`}</b><span>${esc(x.title)}</span><em>${esc(x.date)}${x.auto ? ' · 自动' : ` <button class="btn" data-del="${esc(x.id)}">删除</button>`}</em>`)) : nothing('还没有纪念日。')) +
    `<div class="p bar-row"><input id="anTitle" placeholder="添加一个纪念日，比如：小明的生日" aria-label="纪念日名称"><input id="anDate" type="date" aria-label="日期"><button class="btn" id="anAdd">添加</button></div>`;
  el.querySelector('#anAdd').addEventListener('click', async () => {
    const title = el.querySelector('#anTitle').value.trim();
    const date = el.querySelector('#anDate').value;
    if (!title || !date) return ctx.toast('名称和日期都要填');
    ctx.S.us = await ctx.fish.addAnniversary({ title, date });
    anniversary(el, ctx);
  });
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { ctx.S.us = await ctx.fish.removeAnniversary(b.dataset.del); anniversary(el, ctx); }));
}

const TABS = { moments, slang, relation, anniversary };
export function render(el, tab, ctx) {
  TABS[tab](el, ctx);
}
