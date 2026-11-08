// 神经活动：大脑3D、神经系统、神经递质。

import { esc, fmtClock } from '../util.js';
import { card, lead, level, li, nothing } from './ui.js';

const FUNCS = ['全部', '语言', '学习记忆', '情绪', '注意', '决策', '运动协调', '觉醒', '稳态'];
let filter = '全部';
let pick = 'prefrontal';

function brain(el, ctx) {
  const { S } = ctx;
  const fn = S.meta.regionFunctions;
  const acts = S.vitals.body.regions;
  const match = (id) => filter === '全部' || fn[id]?.functions.includes(filter);
  const r = S.meta.regions.find((x) => x.id === pick) || S.meta.regions[0];
  const conns = (S.meta.connections || []).filter(([a, b]) => a === r.id || b === r.id);
  const nameOf = (id) => S.meta.regions.find((x) => x.id === id)?.name || id;
  el.innerHTML = `<div>${FUNCS.map((x) => `<button class="chip ${x === filter ? 'on' : ''}" data-fn="${x}">${x}</button>`).join('')}</div>
    <div class="brain-layout">
      <div class="stage-host" data-stage></div>
      <div class="stage-side">
        <div class="p side-list">${S.meta.regions.map((x) => `<button class="reg ${x.id === r.id ? 'on' : ''} ${match(x.id) ? '' : 'off'}" data-reg="${x.id}"><span>${esc(x.name)}</span><span class="mono dim">${Math.round((acts[x.id] ?? 0) * 100)}%</span></button>`).join('')}</div>
        ${card(r.name, `<div>${esc(fn[r.id]?.consciousness || r.role)}</div><div class="dim sm mt">${esc(r.desc || '')}</div><div class="mt">${(fn[r.id]?.functions || []).map((x) => `<span class="chip">影响：${esc(x)}</span>`).join('')}</div><div class="dim sm">连接：${conns.map(([a, b]) => esc(nameOf(a === r.id ? b : a))).join('、') || '—'}</div>`, `激活 ${Math.round((acts[r.id] ?? 0) * 100)}%`)}
      </div>
    </div>`;
  ctx.gl.attachStage(el.querySelector('[data-stage]'), 'brain');
  ctx.gl.focusRegions(filter === '全部' ? null : S.meta.regions.filter((x) => match(x.id)).map((x) => x.id));
  el.querySelectorAll('[data-fn]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.fn; ctx.rerender(); }));
  el.querySelectorAll('[data-reg]').forEach((b) => b.addEventListener('click', () => { pick = b.dataset.reg; ctx.rerender(); }));
}

export const selectRegion = (id) => { pick = id; };

function system(el, { S }) {
  const ph = S.vitals.body.phys;
  const a = ph.autonomic;
  const reflexes = S.meta.reflexes || [];
  const cond = Object.entries(ph.reflex.conditioned || {});
  const recent = (ph.reflex.recent || []).slice(-3).reverse();
  el.innerHTML = lead(a.sympathetic > a.parasympathetic ? '交感占优，身体在紧张或兴奋' : '副交感占优，身体很放松', `心率 ${Math.round(ph.vitals.heartRate)} 次/分`) + `<div class="g2">
    ${card('分级调节', `<div class="level">大脑皮层 · 最高级中枢</div><div class="down">↓</div><div class="g3 tight"><div class="level">脑干</div><div class="level">小脑</div><div class="level">下丘脑</div></div><div class="down">↓</div><div class="level">脊髓 · 低级中枢</div><div class="down">↓</div><div class="level">外周神经 · 自主神经</div>`)}
    ${card('自主神经', level('交感神经', a.sympathetic * 100, '心跳加快，消化变慢') + level('副交感神经', a.parasympathetic * 100, '心跳变慢，消化加快'), '通常作用相反')}
  </div><div class="g2">
    ${card('非条件反射', li(reflexes.map((r) => `<span>${esc(r.label)}：${esc(r.response)}</span><em>${recent.some((x) => x.id === r.id) ? `刚刚 ${fmtClock(recent.find((x) => x.id === r.id).at)}` : '生来就有'}</em>`)))}
    ${card('条件反射', cond.length ? cond.map(([cue, r]) => level(`听到“${cue}”`, r.strength * 100, r.strength >= 0.5 ? '已经形成习惯' : '还在养成，不用会消退')).join('') : nothing('和她养成一些习惯，比如每天说晚安。'))}
  </div>`;
}

function transmitters(el, { S }) {
  const nt = S.vitals.body.nt;
  const list = S.meta.transmitters.filter((t) => t.kind === 'transmitter');
  const group = (effect) => list.filter((t) => t.effect === effect).map((t) => level(t.name, nt[t.id] ?? 0, t.role)).join('');
  el.innerHTML = lead('神经递质', '神经元之间传递信号的化学物质') +
    card('突触传递', `<div class="synapse"><div class="syn-a">突触前膜</div><div class="syn-gap"><i></i><i></i><i></i></div><div class="syn-b">突触后膜</div></div>`, '信号从前膜传到后膜') +
    `<div class="g3">${card('兴奋性', group('excite'))}${card('抑制性', group('inhibit'))}${card('调节性', group('modulate'))}</div><div class="dim sm">皮质醇、催产素、褪黑素是激素，在「代谢活动 · 内分泌系统」。</div>`;
}

const TABS = { brain, system, transmitters };
export function render(el, tab, ctx) {
  TABS[tab](el, ctx);
}
